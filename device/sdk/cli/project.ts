/** Locate `device.config.ts`, then compile its apps in memory. Nothing is written here. */
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AppConfig, DeviceConfig } from "../config";
import { compileScreen, encodeScene, pack, rustScreenManifest } from "../compiler";
import type { Element, Node, SceneDefinition } from "../runtime/types";

export type Project = { root: string; config: DeviceConfig };
export type Artifact = {
  app: string;
  screen?: string;
  paths: string[];
  /** What ships: DUIZ when compression pays, else DUI1. */
  bytes: Uint8Array;
  /** DUI1 size before compression. */
  raw: number;
  nodes: number;
};
export type Output = { path: string; data: Uint8Array | string };

const CONFIG = "device.config.ts";

export async function loadProject(cwd = process.cwd()): Promise<Project> {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    for (const candidate of [join(dir, CONFIG), join(dir, "device", CONFIG)]) {
      if (!existsSync(candidate)) continue;
      const config = (await import(pathToFileURL(candidate).href))
        .default as DeviceConfig;
      if (!config?.apps) throw new Error(`${candidate}: export default defineConfig({ apps })`);
      return { root: dirname(candidate), config };
    }
    if (dirname(dir) === dir)
      throw new Error(`No ${CONFIG} found from ${cwd} upwards`);
  }
}

export function appNames(project: Project, requested: string[]): string[] {
  const known = Object.keys(project.config.apps);
  for (const name of requested)
    if (!known.includes(name))
      throw new Error(`Unknown app "${name}" (known: ${known.join(", ")})`);
  return requested.length ? requested : known;
}

/** Compile one app; every screen succeeds before anything is returned, so a failure never leaves a partial build. */
export async function compileApp(
  project: Project,
  name: string,
): Promise<{ artifacts: Artifact[]; outputs: Output[] }> {
  const app = project.config.apps[name];
  const entry = resolve(project.root, app.entry);
  const exports = await import(pathToFileURL(entry).href);
  const outs = (Array.isArray(app.out) ? app.out : [app.out]).map((out) =>
    resolve(project.root, out),
  );
  const compile = (screen: string | undefined, component: unknown) => {
    const label = screen ? `${name}/${screen}` : name;
    if (typeof component !== "function")
      throw new Error(`${label}: export a component function`);
    try {
      const scene = compileScreen(component as () => Element);
      const raw = encodeScene(scene);
      return { bytes: pack(raw), raw: raw.length, nodes: countNodes(scene) };
    } catch (error) {
      throw new Error(
        `${label}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  };
  if (!app.screens) {
    const { bytes, raw, nodes } = compile(undefined, exports.default);
    return {
      artifacts: [{ app: name, paths: outs, bytes, raw, nodes }],
      outputs: outs.map((path) => ({ path, data: bytes })),
    };
  }
  const artifacts = Object.entries(exports)
    .filter(([key]) => key !== "default")
    .map(([screen, component]) => ({
      app: name,
      screen,
      paths: outs.map((dir) => join(dir, `${screen}.dui`)),
      ...compile(screen, component),
    }));
  const outputs: Output[] = artifacts.flatMap((artifact) =>
    artifact.paths.map((path) => ({ path, data: artifact.bytes })),
  );
  if (app.rust) outputs.push(rustOutput(project, app, outs[0], artifacts));
  return { artifacts, outputs };
}

function rustOutput(
  project: Project,
  app: AppConfig,
  dir: string,
  artifacts: Artifact[],
): Output {
  const path = resolve(project.root, app.rust!);
  return {
    path,
    data: rustScreenManifest(
      artifacts.map((artifact) => artifact.screen!),
      {
        source: relative(project.root, resolve(project.root, app.entry)),
        includeDir: relative(dirname(path), dir),
      },
    ),
  };
}

function countNodes(scene: SceneDefinition): number {
  let count = 0;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const node = value as Partial<Node> & Record<string, unknown>;
    if (typeof node.kind === "string" && node.rect) count++;
    for (const [key, child] of Object.entries(node))
      if (key === "children" || key === "child" || key === "routes" || key === "root")
        visit(child);
  };
  visit(scene.root);
  return count;
}
