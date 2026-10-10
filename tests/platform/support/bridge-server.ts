import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../../..");
const WRANGLER = path.join(ROOT, "node_modules/.bin/wrangler");
const STARTUP_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 10_000;

/** A local bridge: `wrangler dev` serving tests/platform/fixtures/bridge-worker.ts. */
export interface BridgeServer {
  readonly origin: string;
  readonly secret: string;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function exited(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once("exit", () => resolve());
  });
}

async function waitUntilServing(origin: string, child: ChildProcess, output: () => string): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited (${child.exitCode}):\n${output()}`);
    try {
      await fetch(origin);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`wrangler dev did not start within ${STARTUP_TIMEOUT_MS} ms:\n${output()}`);
}

/**
 * Starts the bridge in workerd on fresh local D1 (every migration applied),
 * R2 and Queue state, under the OS temporary directory, with a random secret.
 * Nothing leaves this machine.
 */
export async function startBridgeServer(): Promise<BridgeServer> {
  const dir = mkdtempSync(path.join(tmpdir(), "matecrew-bridge-"));
  const state = path.join(dir, "state");
  const configPath = path.join(dir, "wrangler.json");
  const secret = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  writeFileSync(
    configPath,
    JSON.stringify({
      name: "matecrew-bridge-test",
      main: path.join(ROOT, "tests/platform/fixtures/bridge-worker.ts"),
      compatibility_date: "2026-10-01",
      compatibility_flags: ["nodejs_compat"],
      d1_databases: [
        {
          binding: "DB",
          database_name: "matecrew-bridge-test",
          database_id: "00000000-0000-0000-0000-000000000000",
          migrations_dir: path.join(ROOT, "migrations"),
        },
      ],
      r2_buckets: [{ binding: "FILES", bucket_name: "matecrew-bridge-test" }],
      queues: { producers: [{ binding: "JOBS", queue: "matecrew-bridge-test" }] },
      vars: { PLATFORM_BRIDGE_SECRET: secret },
    }),
  );
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1", CI: "1" };

  const migrate = spawnSync(WRANGLER, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", state, "-c", configPath], {
    cwd: dir,
    env,
    encoding: "utf8",
  });
  if (migrate.status !== 0) throw new Error(`wrangler d1 migrations apply failed:\n${migrate.stdout}${migrate.stderr}`);

  const port = await freePort();
  const inspectorPort = await freePort();
  const args = ["dev", "-c", configPath, "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(inspectorPort)];
  // Its own process group: wrangler's launcher does not pass signals on to the runtime it starts.
  const child = spawn(WRANGLER, [...args, "--persist-to", state, "--log-level", "warn"], {
    cwd: dir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const signal = (name: NodeJS.Signals) => {
    if (child.pid !== undefined && child.exitCode === null) process.kill(-child.pid, name);
  };
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));

  const origin = `http://127.0.0.1:${port}`;
  try {
    await waitUntilServing(origin, child, () => output);
  } catch (error) {
    signal("SIGKILL");
    throw error;
  }

  return {
    origin,
    secret,
    async stop() {
      const done = exited(child);
      signal("SIGTERM");
      const timer = setTimeout(() => signal("SIGKILL"), STOP_TIMEOUT_MS);
      await done;
      clearTimeout(timer);
    },
  };
}
