/**
 * The virtual terminal's live channel, as the firmware's (device/core/src/live.rs): one WebSocket
 * to its relay (realtime/), so console commands, "what you show changed" and its screen go at
 * once instead of being polled. The browser cannot set headers on a WebSocket: the token goes as
 * a second subprotocol.
 */
import {
  PANEL_HEIGHT,
  PING,
  PING_EVERY_MS,
  PONG,
  SUBPROTOCOL,
  changedRows,
  parse,
  writePatch,
  type Command,
  type FromTerminal,
  type LogLevel,
  type Patch,
  type ToTerminal,
} from "../../../../realtime/src/protocol";

/** A ping unanswered this long: the connection is dead (as `PONG_WITHIN_MS` in live.rs). */
const PONG_WITHIN_MS = 10_000;
/** Reconnections back off from half a second up to this. */
const MAX_RETRY_MS = 10_000;

/** Whether a change at `at` (ms) is news to a terminal whose state the site built at `serverTime`, read to the second as the firmware does. */
export function isNews(at: number, serverTime: string | null | undefined): boolean {
  const built = serverTime ? Date.parse(serverTime) : Number.NaN;
  return Number.isNaN(built) || at > Math.floor(built / 1000) * 1000;
}

/** What goes for a new panel: all of it when `whole`, else the rows that changed since `sent`; null when none did. */
export function screenPatch(sent: Uint8Array | null, frame: Uint8Array, whole: boolean): Patch | null {
  return whole || !sent ? { y: 0, rows: PANEL_HEIGHT, bits: frame } : changedRows(sent, frame);
}

/** Before reconnection attempt `attempt` (from 0). */
export function retryDelay(attempt: number): number {
  return Math.min(MAX_RETRY_MS, 500 * 2 ** attempt);
}

export type RelayEvents = {
  /** The socket is open: say hello. */
  opened(): void;
  /** It closed, or never opened (`refused`, the first time in a row): poll the site meanwhile. */
  closed(refused: boolean): void;
  command(command: Command): void;
  /** Whether a console wants the screen. */
  live(watching: boolean): void;
  /** What the terminal shows changed on the site at `at`. */
  sync(at: number): void;
};

export class RelayLink {
  private socket: WebSocket | null = null;
  private stopped = true;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setTimeout> | undefined;
  private pongTimer: ReturnType<typeof setTimeout> | undefined;
  /** The screen the relay has, for the next patch; null sends it whole. */
  private sent: Uint8Array | null = null;
  private closedOnce: Promise<void> = Promise.resolve();
  private settle: () => void = () => {};
  /** A console wants the screen and the log. */
  watching = false;

  constructor(
    readonly url: string,
    private readonly token: string,
    private readonly events: RelayEvents,
  ) {}

  get open(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** Resolves when the open socket closes (at once when none is open). */
  get closed(): Promise<void> {
    return this.closedOnce;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    const socket = this.socket;
    if (socket) this.drop(socket, 1000, "stopped");
  }

  send(message: FromTerminal): boolean {
    if (!this.open) return false;
    this.socket?.send(JSON.stringify(message));
    return true;
  }

  /** A log line, only while a console watches; as over Bluetooth: level, target, message. */
  log(level: LogLevel, target: string, msg: string): void {
    if (this.watching) this.send({ t: "log", level, target, msg });
  }

  /** The panel as it is now, while a console watches: the rows that changed since the last one. */
  screen(frame: Uint8Array | null): void {
    if (!frame || !this.open || !this.watching) return;
    const patch = screenPatch(this.sent, frame, false);
    if (!patch) return;
    this.socket?.send(writePatch(patch));
    this.sent = frame.slice();
  }

  private connect(): void {
    if (this.stopped) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url, [SUBPROTOCOL, this.token]);
    } catch {
      this.retry(true);
      return;
    }
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    let opened = false;
    this.closedOnce = new Promise((resolve) => (this.settle = resolve));
    socket.onopen = () => {
      opened = true;
      this.attempt = 0;
      this.sent = null;
      this.heartbeat();
      this.events.opened();
    };
    socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => this.receive(event.data);
    socket.onclose = () => {
      if (this.socket === socket) this.closedNow(!opened);
    };
  }

  private receive(data: string | ArrayBuffer): void {
    if (typeof data !== "string") return;
    if (data === PONG) {
      clearTimeout(this.pongTimer);
      return;
    }
    const message = parse<ToTerminal>(data, ["command", "live", "sync"]);
    switch (message?.t) {
      case "command":
        this.events.command(message.command);
        break;
      case "live":
        this.watching = message.watching === true;
        // A console that starts watching gets the whole screen.
        if (this.watching) this.sent = null;
        this.events.live(this.watching);
        break;
      case "sync":
        if (typeof message.at === "number") this.events.sync(message.at);
        break;
    }
  }

  /** Pings every PING_EVERY_MS; a ping left unanswered drops the socket. */
  private heartbeat(): void {
    clearTimeout(this.pingTimer);
    this.pingTimer = setTimeout(() => {
      const socket = this.socket;
      if (!socket || !this.open) return;
      socket.send(PING);
      clearTimeout(this.pongTimer);
      this.pongTimer = setTimeout(() => this.drop(socket, 4002, "no pong"), PONG_WITHIN_MS);
      this.heartbeat();
    }, PING_EVERY_MS);
  }

  /** Closes `socket` and goes on at once, without waiting for a dead peer's goodbye. */
  private drop(socket: WebSocket, code: number, reason: string): void {
    socket.onclose = null;
    socket.onmessage = null;
    try {
      socket.close(code, reason);
    } catch {
      // Already closed.
    }
    if (this.socket === socket) this.closedNow(false);
  }

  private closedNow(refused: boolean): void {
    this.socket = null;
    this.watching = false;
    clearTimeout(this.pingTimer);
    clearTimeout(this.pongTimer);
    this.settle();
    if (this.stopped) return;
    this.events.closed(refused && this.attempt === 0);
    this.retry(false);
  }

  private retry(refused: boolean): void {
    if (this.stopped) return;
    if (refused) this.events.closed(this.attempt === 0);
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), retryDelay(this.attempt));
    this.attempt += 1;
  }
}
