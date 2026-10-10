/**
 * `dui dev [app...] [--port <n>]`: the studio. A browser page with the emulated terminal (panel,
 * touch keys, buzzer, pins) and every preview, rebuilt on each save:
 * - TSX in apps/ or sdk/ → the app is recompiled in a fresh process and pushed to the page;
 * - Rust in engine/, board/ or engine-wasm/ → the engine wasm is rebuilt with Cargo first.
 */
import { copyFile } from "node:fs/promises";
import { existsSync, watch } from "node:fs";
import { join, relative } from "node:path";
import { appNames, loadProject } from "./project";

const RUST = /^(engine|board|engine-wasm)\/(src|Cargo\.toml)/;
const SOURCES = /^(apps|sdk)\/.*\.(tsx?|json|png)$/;
const IGNORED = /(^|\/)(node_modules|target|out|dist|__snapshots__|studio)\//;

export async function dev(args: string[]): Promise<void> {
  let port = 4321;
  const requested: string[] = [];
  for (let i = 0; i < args.length; i++)
    if (args[i] === "--port") port = Number(args[++i]);
    else requested.push(args[i]);
  const project = await loadProject();
  const apps = appNames(project, requested);
  const cli = join(import.meta.dir, "index.ts");
  const wasm = join(import.meta.dir, "..", "engine.wasm");
  const bundles = new Map<string, { json?: string; error?: string }>();
  const clients = new Set<ReadableStreamDefaultController<string>>();
  let version = 0;

  const send = (event: string, data: unknown) => {
    for (const client of clients) client.enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  async function rebuild(app: string): Promise<void> {
    const started = performance.now();
    const child = Bun.spawn([process.execPath, cli, "bundle", app], {
      cwd: project.root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [json, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const error = code === 0 ? undefined : stderr.trim().replace(/^dui bundle: /, "") || `exit ${code}`;
    bundles.set(app, error ? { error } : { json });
    version++;
    send("bundle", { app, version, error });
    const ms = Math.round(performance.now() - started);
    console.log(error ? `✗ ${app}: ${error}` : `✓ ${app} (${ms} ms)`);
  }

  /** Cargo into sdk/engine.wasm, as `just engine` does; the error output on failure. */
  async function buildEngine(): Promise<string | undefined> {
    console.log("… engine wasm");
    const crate = join(project.root, "engine-wasm");
    const cargo = Bun.spawn(
      ["cargo", "build", "--release", "--target", "wasm32-unknown-unknown", "-q"],
      { cwd: crate, stdout: "inherit", stderr: "pipe" },
    );
    const [stderr, code] = await Promise.all([new Response(cargo.stderr).text(), cargo.exited]);
    if (code !== 0) {
      console.log(`✗ engine wasm:\n${stderr}`);
      return stderr.trim() || `cargo exit ${code}`;
    }
    // The target directory may be shared between crates (CARGO_TARGET_DIR, .cargo/config.toml).
    const metadata = Bun.spawnSync(["cargo", "metadata", "--format-version", "1", "--no-deps"], { cwd: crate });
    const target: string = JSON.parse(metadata.stdout.toString()).target_directory;
    await copyFile(join(target, "wasm32-unknown-unknown/release/device_engine_wasm.wasm"), wasm);
    console.log("✓ engine wasm");
  }

  async function rebuildEngine(): Promise<void> {
    const error = await buildEngine();
    if (error) return send("engine", { error });
    send("engine", { version: ++version });
    await Promise.all(apps.map(rebuild));
  }

  if (!existsSync(wasm)) {
    const error = await buildEngine();
    if (error) throw new Error("could not build sdk/engine.wasm (see above)");
  }
  await Promise.all(apps.map(rebuild));

  let timer: ReturnType<typeof setTimeout> | undefined;
  let engineChanged = false;
  watch(project.root, { recursive: true }, (_, file) => {
    if (!file || IGNORED.test(file)) return;
    const path = file.replaceAll("\\", "/");
    if (RUST.test(path)) engineChanged = true;
    else if (!SOURCES.test(path)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const engine = engineChanged;
      engineChanged = false;
      void (engine ? rebuildEngine() : Promise.all(apps.map(rebuild)));
    }, 60);
  });

  const { default: studio } = await import("../studio/index.html");
  const server = Bun.serve({
    port,
    development: true,
    idleTimeout: 0,
    routes: {
      "/": studio,
      "/engine.wasm": () => new Response(Bun.file(wasm), { headers: { "Cache-Control": "no-store" } }),
      "/api/apps": () => Response.json(apps),
      "/api/bundle/:app": (request) => {
        const bundle = bundles.get(request.params.app);
        if (bundle?.json)
          return new Response(bundle.json, { headers: { "Content-Type": "application/json" } });
        return Response.json({ error: bundle?.error ?? "unknown app" }, { status: 422 });
      },
      "/events": () => {
        let self: ReadableStreamDefaultController<string>;
        return new Response(
          new ReadableStream<string>({
            start(controller) {
              self = controller;
              clients.add(controller);
              controller.enqueue(": connected\n\n");
            },
            cancel() {
              clients.delete(self);
            },
          }),
          { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } },
        );
      },
    },
  });
  console.log(`\ndui dev → ${server.url}  (${apps.join(", ")}; watching ${relative(process.cwd(), project.root) || "."})\n`);
  await new Promise(() => {});
}
