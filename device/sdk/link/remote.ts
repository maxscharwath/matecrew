/**
 * Remote management whatever the way to the device: the same calls over Bluetooth
 * (`BleDevice`) or over a server that relays them (`HttpRemote`), so a console can switch
 * between "nearby" and "from anywhere" without changing its code.
 */
import { encodeCommand, fail, ok, type DeviceEvent, type LinkError, type RemoteCommand, type Result } from "./protocol";

export interface DeviceRemote {
  /** "ble", "http", or a custom transport's name. */
  readonly transport: string;
  /** What the device says about itself; the shape depends on the transport. */
  info(): Promise<Result<unknown>>;
  send(command: RemoteCommand): Promise<Result<void>>;
  /** Live events, for transports that stream them (Bluetooth does, plain HTTP does not). */
  onEvent?(listener: (event: DeviceEvent) => void): () => void;
}

/** Shorthands over `send`, for any transport. */
export const commands = {
  press: (remote: DeviceRemote, side: "left" | "right") => remote.send({ cmd: "key", side }),
  both: (remote: DeviceRemote) => remote.send({ cmd: "both" }),
  badge: (remote: DeviceRemote, uid: string) => remote.send({ cmd: "badge", uid }),
  sync: (remote: DeviceRemote) => remote.send({ cmd: "sync" }),
  restart: (remote: DeviceRemote) => remote.send({ cmd: "restart" }),
  notify: (remote: DeviceRemote, text: string) => remote.send({ cmd: "notify", text }),
};

export type HttpRemoteOptions = {
  /**
   * The device's endpoint on the server: `GET {baseUrl}/info` answers its info as JSON,
   * `POST {baseUrl}/commands` takes a command as JSON (the same as over Bluetooth).
   */
  baseUrl: string;
  /** Sent with every request, e.g. `{ authorization: "Bearer …" }`; cookies go as `credentials`. */
  headers?: Record<string, string>;
  credentials?: "omit" | "same-origin" | "include";
  /** Defaults to the global `fetch`. */
  fetch?: (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string; credentials?: "omit" | "same-origin" | "include" }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
};

/** An HTTP status as one of the module's errors. */
function statusError(status: number, body: string): LinkError {
  let message = body || `HTTP ${status}`;
  try {
    const parsed = JSON.parse(body) as { error?: string; message?: string };
    message = parsed.message ?? parsed.error ?? message;
  } catch {
    // Plain text body: keep it.
  }
  if (status === 401 || status === 403) return { code: "refused", message };
  if (status === 404) return { code: "not-found", message };
  if (status === 400 || status === 422) return { code: "invalid", message };
  if (status === 501) return { code: "unsupported", message };
  if (status === 504 || status === 408) return { code: "timeout", message };
  return { code: "transport", message };
}

/** A device reached through a server (the server queues commands for it). */
export class HttpRemote implements DeviceRemote {
  readonly transport = "http";

  constructor(private readonly options: HttpRemoteOptions) {}

  private async request(path: string, init: { method: string; body?: string }): Promise<Result<string>> {
    const run = this.options.fetch ?? (globalThis as { fetch?: HttpRemoteOptions["fetch"] }).fetch;
    if (!run) return fail("unsupported", "no fetch here");
    try {
      const response = await run(`${this.options.baseUrl.replace(/\/$/, "")}${path}`, {
        method: init.method,
        body: init.body,
        credentials: this.options.credentials ?? "same-origin",
        headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...this.options.headers },
      });
      const text = await response.text();
      return response.ok ? ok(text) : { ok: false, error: statusError(response.status, text) };
    } catch (error) {
      return fail("transport", (error as Error)?.message ?? String(error));
    }
  }

  async info(): Promise<Result<unknown>> {
    const text = await this.request("/info", { method: "GET" });
    if (!text.ok) return text;
    try {
      return ok(JSON.parse(text.value) as unknown);
    } catch {
      return fail("transport", "the server sent unreadable info");
    }
  }

  async send(command: RemoteCommand): Promise<Result<void>> {
    const bytes = encodeCommand(command);
    if (!bytes.ok) return bytes;
    const sent = await this.request("/commands", { method: "POST", body: new TextDecoder().decode(bytes.value) });
    return sent.ok ? ok(undefined) : sent;
  }
}
