import { DurableObject } from "cloudflare:workers";
import {
  COMMAND_TTL_MS,
  FRAME_BYTES,
  command as parseCommand,
  parse,
  type Command,
  type CommandStatus,
  type FromConsole,
  type FromTerminal,
  type ToConsole,
  type ToTerminal,
} from "./protocol";
import type { Env } from "./index";
import type { Role } from "./token";

/** A command waiting for the terminal to connect, with when it stops waiting. */
type Pending = { command: Command; until: number };

/**
 * One terminal's relay: its socket, the consoles watching it, the commands waiting for it and
 * its last screen. Sockets hibernate (`acceptWebSocket`), so an idle terminal costs nothing.
 */
export class Terminal extends DurableObject<Env> {
  private sockets(role: Role): WebSocket[] {
    return this.ctx.getWebSockets(role);
  }

  private send(sockets: WebSocket[], message: ToConsole | ToTerminal | ArrayBuffer) {
    const data = message instanceof ArrayBuffer ? message : JSON.stringify(message);
    for (const socket of sockets) {
      try {
        socket.send(data);
      } catch {
        // A socket closing meanwhile: its close event cleans up.
      }
    }
  }

  private toConsoles(message: ToConsole | ArrayBuffer) {
    this.send(this.sockets("console"), message);
  }

  /** Tells the terminal whether a console watches it (`closing` is leaving): it mirrors its
   * screen only then. */
  private live(closing?: WebSocket) {
    const watching = this.sockets("console").some((socket) => socket !== closing);
    this.send(this.sockets("device"), { t: "live", watching });
  }

  /** Sends `command` to the terminal now, or keeps it for `COMMAND_TTL_MS`. */
  private async deliver(command: Command) {
    const [terminal] = this.sockets("device");
    let status: CommandStatus = "sent";
    if (terminal) {
      this.send([terminal], { t: "command", command });
    } else {
      const pending = ((await this.ctx.storage.get<Pending[]>("pending")) ?? []).filter((p) => p.until > Date.now());
      pending.push({ command, until: Date.now() + COMMAND_TTL_MS });
      await this.ctx.storage.put("pending", pending);
      status = "waiting";
    }
    this.toConsoles({ t: "commandStatus", id: command.id, status });
  }

  async fetch(request: Request): Promise<Response> {
    const role = request.headers.get("x-role") as Role | null;
    if (request.headers.get("upgrade") === "websocket" && (role === "device" || role === "console")) {
      return this.open(role);
    }
    if (request.method === "POST" && role === "site") {
      const parsed = parseCommand(await request.json().catch(() => null));
      if (!parsed) return Response.json({ error: "invalid_command" }, { status: 400 });
      await this.deliver(parsed);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 400 });
  }

  /** A hibernating WebSocket for the terminal or a console. */
  private async open(role: "device" | "console"): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair();
    if (role === "device") {
      // One terminal: a new connection replaces the old one.
      for (const old of this.sockets("device")) old.close(4000, "replaced");
    }
    this.ctx.acceptWebSocket(server, [role]);
    if (role === "device") await this.terminalJoined(server);
    else await this.consoleJoined(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** The terminal is online: the commands kept for it, whether a console watches; consoles hear of it. */
  private async terminalJoined(server: WebSocket) {
    await this.ctx.storage.put("onlineSince", Date.now());
    const pending = ((await this.ctx.storage.get<Pending[]>("pending")) ?? []).filter((p) => p.until > Date.now());
    await this.ctx.storage.delete("pending");
    for (const { command } of pending) this.send([server], { t: "command", command });
    this.send([server], { t: "live", watching: this.sockets("console").length > 0 });
    this.toConsoles({ t: "online", online: true, since: Date.now() });
  }

  /** A console catches up (online since when, last status, last screen); the terminal starts mirroring. */
  private async consoleJoined(server: WebSocket) {
    const since = this.sockets("device").length > 0 ? ((await this.ctx.storage.get<number>("onlineSince")) ?? null) : null;
    this.send([server], { t: "online", online: since !== null, since });
    const status = await this.ctx.storage.get<Record<string, unknown>>("status");
    if (status) this.send([server], { t: "status", status });
    const frame = await this.ctx.storage.get<ArrayBuffer>("frame");
    if (frame) this.send([server], frame);
    this.live();
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const [role] = this.ctx.getTags(socket) as Role[];
    if (role === "device") {
      if (typeof message !== "string") {
        if (message.byteLength !== FRAME_BYTES) return;
        await this.ctx.storage.put("frame", message);
        this.toConsoles(message);
        return;
      }
      const sent = parse<FromTerminal>(message, ["hello", "status", "log", "ack"]);
      if (!sent) return;
      switch (sent.t) {
        case "hello":
        case "status": {
          const status: Record<string, unknown> = { ...sent };
          delete status.t;
          await this.ctx.storage.put("status", status);
          this.toConsoles({ t: "status", status });
          break;
        }
        case "log":
          this.toConsoles({ t: "log", line: String(sent.line).slice(0, 512), at: Date.now() });
          break;
        case "ack":
          this.toConsoles({ t: "commandStatus", id: sent.id, status: "delivered" });
          break;
      }
    } else if (role === "console" && typeof message === "string") {
      const sent = parse<FromConsole>(message, ["command"]);
      const valid = sent && parseCommand(sent.command);
      if (valid) await this.deliver(valid);
    }
  }

  webSocketClose(socket: WebSocket, code: number, reason: string) {
    const [role] = this.ctx.getTags(socket) as Role[];
    if (role === "device" && this.sockets("device").every((s) => s === socket)) {
      this.toConsoles({ t: "online", online: false, since: null });
    } else if (role === "console") {
      this.live(socket);
    }
    try {
      // Completes the closing handshake.
      socket.close(code === 1005 ? 1000 : code, reason);
    } catch {
      // Already closed.
    }
  }
}
