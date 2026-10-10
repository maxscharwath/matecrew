/**
 * The few Workers runtime types the relay uses, declared here rather than pulling in
 * `@cloudflare/workers-types` (see https://developers.cloudflare.com/workers/runtime-apis/).
 */
declare module "cloudflare:workers" {
  export abstract class DurableObject<Env = unknown> {
    protected ctx: DurableObjectState;
    protected env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}

interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
}

interface DurableObjectState {
  readonly storage: DurableObjectStorage;
  acceptWebSocket(socket: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
  getTags(socket: WebSocket): string[];
}

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

interface ResponseInit {
  /** Workers: the client end of an accepted WebSocket, with status 101. */
  webSocket?: WebSocket;
}
