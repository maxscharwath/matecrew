import { DurableObject } from "cloudflare:workers";
import {
  COMMAND_TTL_MS,
  FRAME_BYTES,
  HISTORY,
  INPUT_TTL_MS,
  PANEL_HEIGHT,
  PING,
  PING_EVERY_MS,
  PING_GRACE_MS,
  PONG,
  SUBPROTOCOL,
  TERMINAL_HEADER,
  applyPatch,
  command as parseCommand,
  isInput,
  parse,
  readPatch,
  tones as parseTones,
  writePatch,
  type Command,
  type CommandEntry,
  type CommandStatus,
  type FromConsole,
  type FromTerminal,
  type Presence,
  type TerminalStatus,
  type ToConsole,
  type ToTerminal,
} from "./protocol";

export interface RelayEnv {
  /** The site's D1 database: terminals are authenticated by the hash of their token. */
  readonly DB: D1Database;
  readonly TERMINALS: DurableObjectNamespace<Terminal>;
}

/** Kept on each socket, so it survives hibernation. */
type Attachment =
  | { role: "device"; since: number }
  /** `screen`: the console wants the screen from here (not while it has it over Bluetooth). */
  | { role: "console"; user: string; screen: boolean };

/** A command waiting for the terminal to connect, until `until`. */
type Pending = { command: Command; until: number };

/** How long a console ticket (`ticket`) can be used, once. */
const TICKET_TTL_MS = 60_000;
/** While consoles are open, how often the relay looks whether the terminal still pings. */
const CHECK_EVERY_MS = PING_EVERY_MS / 2;
const LOG_LINE_MAX = 512;
const LOG_TARGET_MAX = 64;
const LEVELS = new Set(["E", "W", "I", "D", "V"]);

function attachment(socket: WebSocket): Attachment | null {
  return (socket.deserializeAttachment() as Attachment | null) ?? null;
}

function randomTicket(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return `mct_${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
}

/**
 * One terminal's relay: its socket, the consoles watching it, the commands waiting for it, its
 * last status and screen. Sockets hibernate (`acceptWebSocket`) and the terminal's heartbeat is
 * answered without waking the object, so a connected, idle terminal costs nothing.
 *
 * The site calls the public methods over RPC (src/platform/cloudflare/realtime.ts): a console
 * ticket, a command, "what it shows changed", its presence, its last screen.
 */
export class Terminal extends DurableObject<RelayEnv> {
  /** The last screen, read from storage on first use (the object may have slept since). */
  private frame: Uint8Array | null | undefined;

  constructor(ctx: DurableObjectState, env: RelayEnv) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  // --- RPC from the site -------------------------------------------------------------------------

  /** A one-time ticket for `user`'s console to open its socket within a minute. */
  async ticket(user: string): Promise<string> {
    const ticket = randomTicket();
    await this.ctx.storage.put(`ticket:${ticket}`, { user, until: Date.now() + TICKET_TTL_MS });
    await this.schedule();
    return ticket;
  }

  /** Runs `command` on the terminal now, or keeps it until it connects; consoles see it listed. */
  async command(command: Command, by: string | null): Promise<CommandStatus> {
    const valid = parseCommand(command);
    if (!valid) throw new Error("invalid command");
    return this.deliver(valid, by);
  }

  /** What the terminal shows changed at `at`: it syncs now. False when it is not connected. */
  async changed(at: number): Promise<boolean> {
    const terminal = this.terminal();
    if (!terminal) return false;
    this.send([terminal], { t: "sync", at });
    return true;
  }

  async presence(): Promise<Presence> {
    const terminal = this.terminal();
    const [status, statusAt, drawnAt] = await Promise.all([
      this.ctx.storage.get<TerminalStatus>("status"),
      this.ctx.storage.get<number>("statusAt"),
      this.ctx.storage.get<number>("drawnAt"),
    ]);
    const since = terminal ? (attachment(terminal) as { since: number }).since : null;
    return { online: !!terminal, since, status: status ?? null, statusAt: statusAt ?? null, drawnAt: drawnAt ?? null };
  }

  /** The last screen the terminal sent, packed 1 bit (`FRAME_BYTES`), and when. */
  async screen(): Promise<{ bits: Uint8Array; drawnAt: number } | null> {
    const [bits, drawnAt] = await Promise.all([this.loadFrame(), this.ctx.storage.get<number>("drawnAt")]);
    return bits && drawnAt ? { bits, drawnAt } : null;
  }

  // --- Sockets -----------------------------------------------------------------------------------

  /** Called by the relay's Worker once it has authenticated the caller (src/index.ts). */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response(null, { status: 426 });
    const role = request.headers.get("x-role");
    let joining: Attachment;
    if (role === "device") {
      joining = { role: "device", since: Date.now() };
    } else if (role === "console") {
      const key = `ticket:${request.headers.get("x-ticket") ?? ""}`;
      const ticket = await this.ctx.storage.get<{ user: string; until: number }>(key);
      await this.ctx.storage.delete(key);
      if (!ticket || ticket.until < Date.now()) return new Response(null, { status: 401 });
      joining = { role: "console", user: ticket.user, screen: true };
    } else {
      return new Response(null, { status: 400 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    if (joining.role === "device") {
      // One terminal: a new connection (after a restart, a Wi-Fi drop) replaces the old one.
      for (const old of this.ctx.getWebSockets("device")) old.close(4000, "replaced");
    }
    this.ctx.acceptWebSocket(server, [joining.role]);
    server.serializeAttachment(joining);
    if (joining.role === "device") await this.terminalJoined(server);
    else await this.consoleJoined(server);
    const headers = request.headers.get("x-subprotocol") ? { "sec-websocket-protocol": SUBPROTOCOL } : undefined;
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const joined = attachment(socket);
    if (joined?.role === "device") await this.fromTerminal(message);
    else if (joined?.role === "console" && typeof message === "string") await this.fromConsole(socket, joined, message);
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string) {
    this.left(socket);
    try {
      // 1005 and 1006 say no code came; they cannot be sent back.
      socket.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // Already closed.
    }
  }

  async webSocketError(socket: WebSocket) {
    this.left(socket);
  }

  /** Looks whether the terminal still pings while consoles watch; drops expired commands and tickets. */
  async alarm() {
    const now = Date.now();
    const terminal = this.ctx.getWebSockets("device")[0];
    if (terminal && !this.alive(terminal, now)) {
      // Gone without closing (power cut, Wi-Fi lost): say so now rather than when TCP notices.
      terminal.close(4001, "silent");
      this.toConsoles({ t: "online", online: false, since: null });
    }
    const pending = (await this.ctx.storage.get<Pending[]>("pending")) ?? [];
    const kept = pending.filter((p) => p.until > now);
    if (kept.length !== pending.length) {
      await this.ctx.storage.put("pending", kept);
      for (const { command } of pending.filter((p) => p.until <= now)) await this.setStatus(command.id, "dropped");
    }
    const tickets = await this.ctx.storage.list<{ until: number }>({ prefix: "ticket:" });
    const expired = [...tickets].filter(([, ticket]) => ticket.until <= now).map(([key]) => key);
    if (expired.length > 0) await this.ctx.storage.delete(expired);
    await this.schedule();
  }

  // --- Terminal ----------------------------------------------------------------------------------

  /** The connected terminal, if it still pings. */
  private terminal(): WebSocket | null {
    const socket = this.ctx.getWebSockets("device")[0];
    return socket && this.alive(socket, Date.now()) ? socket : null;
  }

  private alive(socket: WebSocket, now: number): boolean {
    const joined = attachment(socket);
    const pinged = this.ctx.getWebSocketAutoResponseTimestamp(socket)?.getTime() ?? 0;
    const since = joined?.role === "device" ? joined.since : 0;
    return now - Math.max(pinged, since) < PING_EVERY_MS + PING_GRACE_MS;
  }

  /** The commands kept for it, whether a console watches; consoles hear it is online. */
  private async terminalJoined(socket: WebSocket) {
    const now = Date.now();
    const pending = ((await this.ctx.storage.get<Pending[]>("pending")) ?? []).filter((p) => p.until > now);
    await this.ctx.storage.delete("pending");
    for (const { command } of pending) {
      this.send([socket], { t: "command", command });
      await this.setStatus(command.id, "sent");
    }
    this.send([socket], { t: "live", watching: this.watching() });
    this.toConsoles({ t: "online", online: true, since: now });
  }

  private async fromTerminal(message: string | ArrayBuffer) {
    if (typeof message !== "string") return this.screenPatch(message);
    const sent = parse<FromTerminal>(message, ["hello", "status", "ack", "log", "beep"]);
    switch (sent?.t) {
      case "hello":
      case "status":
        return this.report(sent);
      case "ack":
        if (typeof sent.id === "string") await this.setStatus(sent.id, "delivered");
        return;
      case "log":
        // As over Bluetooth: level, target, message.
        if (!LEVELS.has(sent.level)) return;
        return this.toConsoles({
          t: "log",
          level: sent.level,
          target: String(sent.target).slice(0, LOG_TARGET_MAX),
          msg: String(sent.msg).slice(0, LOG_LINE_MAX),
          at: Date.now(),
        });
      case "beep": {
        const tones = parseTones(sent.tones);
        if (tones) this.toConsoles({ t: "beep", tones, at: Date.now() });
        return;
      }
    }
  }

  /** The rows of its screen that changed: to the consoles watching it, then kept. */
  private async screenPatch(message: ArrayBuffer) {
    const patch = readPatch(message, TERMINAL_HEADER);
    if (!patch) return;
    const drawnAt = Date.now();
    // Consoles first: storing waits for nothing they need.
    const out = writePatch(patch, drawnAt);
    for (const socket of this.screenConsoles()) this.trySend(socket, out);
    const frame = (await this.loadFrame()) ?? new Uint8Array(FRAME_BYTES);
    applyPatch(frame, patch);
    this.frame = frame;
    await this.ctx.storage.put({ frame, drawnAt }, { allowUnconfirmed: true });
  }

  /** What the terminal says about itself: whole on connecting (`hello`), what changed after. */
  private async report(sent: Extract<FromTerminal, { t: "hello" | "status" }>) {
    if (typeof sent.status !== "object" || sent.status === null) return;
    const at = Date.now();
    const previous = sent.t === "status" ? ((await this.ctx.storage.get<TerminalStatus>("status")) ?? {}) : {};
    const status = { ...previous, ...sent.status };
    this.toConsoles({ t: "status", status, at });
    await this.ctx.storage.put({ status, statusAt: at }, { allowUnconfirmed: true });
  }

  // --- Consoles ----------------------------------------------------------------------------------

  /** A console catches up: online since when, status, recent commands, last screen. */
  private async consoleJoined(socket: WebSocket) {
    const terminal = this.terminal();
    const since = terminal ? (attachment(terminal) as { since: number }).since : null;
    this.send([socket], { t: "online", online: !!terminal, since });
    const [status, statusAt, history] = await Promise.all([
      this.ctx.storage.get<TerminalStatus>("status"),
      this.ctx.storage.get<number>("statusAt"),
      this.ctx.storage.get<CommandEntry[]>("history"),
    ]);
    if (status) this.send([socket], { t: "status", status, at: statusAt ?? 0 });
    this.send([socket], { t: "commands", entries: history ?? [] });
    await this.sendScreen(socket);
    this.live();
    await this.schedule();
  }

  private async fromConsole(socket: WebSocket, joined: Extract<Attachment, { role: "console" }>, message: string) {
    const sent = parse<FromConsole>(message, ["command", "watch"]);
    if (sent?.t === "command") {
      const valid = parseCommand(sent.command);
      if (valid) await this.deliver(valid, joined.user);
    } else if (sent?.t === "watch" && typeof sent.screen === "boolean" && sent.screen !== joined.screen) {
      socket.serializeAttachment({ ...joined, screen: sent.screen });
      if (sent.screen) await this.sendScreen(socket);
      this.live();
    }
  }

  private async sendScreen(socket: WebSocket) {
    const shown = await this.screen();
    if (shown) this.trySend(socket, writePatch({ y: 0, rows: PANEL_HEIGHT, bits: shown.bits }, shown.drawnAt));
  }

  private screenConsoles(except?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets("console").filter((socket) => {
      const joined = attachment(socket);
      return socket !== except && joined?.role === "console" && joined.screen;
    });
  }

  /** Whether a console wants the screen: the terminal sends it only then. */
  private watching(except?: WebSocket): boolean {
    return this.screenConsoles(except).length > 0;
  }

  /** Tells the terminal whether a console watches (`leaving` is going). */
  private live(leaving?: WebSocket) {
    const terminal = this.ctx.getWebSockets("device")[0];
    if (terminal) this.send([terminal], { t: "live", watching: this.watching(leaving) });
  }

  private left(socket: WebSocket) {
    const joined = attachment(socket);
    if (joined?.role === "device") {
      if (this.ctx.getWebSockets("device").every((s) => s === socket)) {
        this.toConsoles({ t: "online", online: false, since: null });
      }
    } else if (joined?.role === "console") {
      this.live(socket);
    }
  }

  // --- Commands ----------------------------------------------------------------------------------

  private async deliver(command: Command, by: string | null): Promise<CommandStatus> {
    const history = (await this.ctx.storage.get<CommandEntry[]>("history")) ?? [];
    const known = history.find((entry) => entry.id === command.id);
    // The same command twice (a console sending again after a reconnection): once is enough.
    if (known) return known.status;
    const now = Date.now();
    const terminal = this.terminal();
    let status: CommandStatus = "sent";
    if (terminal) {
      this.send([terminal], { t: "command", command });
    } else {
      const pending = ((await this.ctx.storage.get<Pending[]>("pending")) ?? []).filter((p) => p.until > now);
      pending.push({ command, until: now + (isInput(command) ? INPUT_TTL_MS : COMMAND_TTL_MS) });
      await this.ctx.storage.put("pending", pending);
      status = "waiting";
    }
    const entry: CommandEntry = { id: command.id, command, at: now, by, status };
    await this.ctx.storage.put("history", [...history, entry].slice(-HISTORY));
    this.toConsoles({ t: "command", entry });
    if (status === "waiting") await this.schedule();
    return status;
  }

  private async setStatus(id: string, status: CommandStatus) {
    const history = (await this.ctx.storage.get<CommandEntry[]>("history")) ?? [];
    const entry = history.find((e) => e.id === id);
    if (!entry || entry.status === status) return;
    entry.status = status;
    await this.ctx.storage.put("history", history);
    this.toConsoles({ t: "command", entry });
  }

  // --- Plumbing ----------------------------------------------------------------------------------

  /** The next alarm: soon while consoles watch, at the first expiry otherwise, none when idle. */
  private async schedule() {
    const now = Date.now();
    const times: number[] = [];
    if (this.ctx.getWebSockets("console").length > 0) times.push(now + CHECK_EVERY_MS);
    const pending = (await this.ctx.storage.get<Pending[]>("pending")) ?? [];
    times.push(...pending.map((p) => p.until));
    const tickets = await this.ctx.storage.list<{ until: number }>({ prefix: "ticket:" });
    times.push(...[...tickets.values()].map((t) => t.until));
    if (times.length === 0) return this.ctx.storage.deleteAlarm();
    const next = Math.max(now + 1_000, Math.min(...times));
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > next || current < now) await this.ctx.storage.setAlarm(next);
  }

  private async loadFrame(): Promise<Uint8Array | null> {
    if (this.frame === undefined) this.frame = (await this.ctx.storage.get<Uint8Array>("frame")) ?? null;
    return this.frame;
  }

  private toConsoles(message: ToConsole) {
    this.send(this.ctx.getWebSockets("console"), message);
  }

  private send(sockets: WebSocket[], message: ToConsole | ToTerminal) {
    const text = JSON.stringify(message);
    for (const socket of sockets) this.trySend(socket, text);
  }

  private trySend(socket: WebSocket, data: string | Uint8Array) {
    try {
      socket.send(data);
    } catch {
      // Closing meanwhile: its close event cleans up.
    }
  }
}
