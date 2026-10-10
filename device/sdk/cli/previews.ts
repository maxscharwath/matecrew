/** Draw every preview of an app with the engine wasm. Shared by `dui render`, `dui test` and `dui dev`. */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Preview, Previews } from "../preview";
import { Engine, type Frame } from "../preview/engine";
import { compileApp, type Artifact, type Project } from "./project";
import { decorate } from "../emulator/status";

export type Drawn = {
  app: string;
  name: string;
  screen?: string;
  description?: string;
  frame: Frame;
};

let engine: Promise<Engine> | undefined;
export function loadEngine(): Promise<Engine> {
  engine ??= readFile(new URL("../engine.wasm", import.meta.url)).then(
    (bytes) => Engine.fromBytes(bytes),
    (error) => {
      if (error?.code === "ENOENT")
        throw new Error("sdk/engine.wasm is missing: build it with `just engine` (from device/)");
      throw error;
    },
  );
  return engine;
}

export async function loadPreviews(
  project: Project,
  app: string,
  artifacts: Artifact[],
): Promise<Previews> {
  const path = project.config.apps[app].previews;
  if (!path)
    return Object.fromEntries(
      artifacts.map((artifact) => [
        artifact.screen ?? "default",
        artifact.screen ? { screen: artifact.screen } : {},
      ]),
    );
  const file = resolve(project.root, path);
  const previews: Previews = file.endsWith(".json")
    ? JSON.parse(await readFile(file, "utf8"))
    : (await import(pathToFileURL(file).href)).previews;
  if (!previews) throw new Error(`${path}: export const previews = definePreviews({...})`);
  return Object.fromEntries(
    await Promise.all(
      Object.entries(previews).map(async ([name, raw]) => [name, await resolvePreview(raw, dirname(file))] as const),
    ),
  );
}

/**
 * Image files are relative to the previews file; the engine receives their bytes.
 * Raw device readings get the status sprites the terminal host would add.
 */
async function resolvePreview(raw: Preview, dir: string): Promise<Preview> {
  const preview = raw.device && !raw.device.status ? { ...raw, device: decorate(raw.device) } : raw;
  if (!preview.images) return preview;
  const images = await Promise.all(
    Object.entries(preview.images).map(async ([src, png]) => [
      src,
      (await readFile(resolve(dir, png))).toString("base64"),
    ]),
  );
  return { ...preview, images: Object.fromEntries(images) };
}

export async function drawApp(
  project: Project,
  app: string,
  filter?: (name: string) => boolean,
): Promise<Drawn[]> {
  const { artifacts } = await compileApp(project, app);
  const previews = await loadPreviews(project, app, artifacts);
  const wasm = await loadEngine();
  return Object.entries(previews)
    .filter(([name]) => !filter || filter(name))
    .map(([name, preview]) => draw(wasm, app, name, preview, artifacts));
}

function draw(
  wasm: Engine,
  app: string,
  name: string,
  { screen, description, ...spec }: Preview,
  artifacts: Artifact[],
): Drawn {
  const artifact = artifactFor(artifacts, screen);
  if (!artifact) {
    const reason = screen ? `unknown screen "${screen}"` : "name a screen for this multi-screen app";
    throw new Error(`${app}/${name}: ${reason}`);
  }
  try {
    return { app, name, screen, description, frame: wasm.render(artifact.bytes, spec) };
  } catch (error) {
    throw new Error(`${app}/${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The screen a preview names; a single-screen app needs none. */
function artifactFor(artifacts: Artifact[], screen: string | undefined): Artifact | undefined {
  if (screen) return artifacts.find((candidate) => candidate.screen === screen);
  return artifacts.length === 1 ? artifacts[0] : undefined;
}

/** Snapshots live next to the app's entry, in `__snapshots__/`. */
export function snapshotDir(project: Project, app: string): string {
  return resolve(project.root, dirname(project.config.apps[app].entry), "__snapshots__");
}
