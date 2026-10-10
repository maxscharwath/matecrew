/** `dui test [app...] [--update]`: compare every preview with its golden PNG in `__snapshots__/`. */
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { framePng, indexedPng, readFramePng, INK, PAPER } from "../preview/png";
import type { Frame } from "../preview/engine";
import { appNames, loadProject, type Project } from "./project";
import { drawApp, snapshotDir } from "./previews";

export async function test(args: string[]): Promise<void> {
  const update = args.includes("--update");
  const project = await loadProject();
  const apps = appNames(project, args.filter((arg) => !arg.startsWith("-")));
  const results = await Promise.all(apps.map((app) => testApp(project, app, update)));
  for (const line of results.flatMap((result) => result.log)) console.log(line);
  const failures = results.flatMap((result) => result.failures);
  const checked = results.reduce((sum, result) => sum + result.checked, 0);
  if (failures.length) {
    console.error(`${failures.length} of ${checked} previews changed:\n  ${failures.join("\n  ")}\nReview the diffs, then run \`dui test --update\`.`);
    process.exitCode = 1;
  } else console.log(`${checked} previews match their snapshots`);
}

/** What one app's check found: written or removed snapshots in `log`, mismatches in `failures`. */
type Result = { checked: number; log: string[]; failures: string[] };
/** A frame as a PNG snapshot reads back. */
type Bitmap = Pick<Frame, "width" | "height" | "bits">;

async function testApp(project: Project, app: string, update: boolean): Promise<Result> {
  const dir = snapshotDir(project, app);
  await mkdir(dir, { recursive: true });
  const drawn = await drawApp(project, app);
  const outcomes = await Promise.all(drawn.map(({ name, frame }) => compare(project, app, dir, name, frame, update)));
  const names = new Set(drawn.map(({ name }) => `${name}.png`));
  const orphans = (await readdir(dir)).filter((file) => file.endsWith(".png") && !names.has(file));
  const result: Result = {
    checked: drawn.length,
    log: outcomes.flatMap((outcome) => outcome.log ?? []),
    failures: outcomes.flatMap((outcome) => outcome.failure ?? []),
  };
  if (!update) {
    result.failures.push(...orphans.map((file) => `${app}/${file}: snapshot without a preview (run --update)`));
    return result;
  }
  await Promise.all(orphans.map((file) => unlink(join(dir, file))));
  result.log.push(...orphans.map((file) => `removed: ${relative(process.cwd(), join(dir, file))}`));
  return result;
}

/** One preview against its golden PNG: written when new or updating, else a diff image on mismatch. */
async function compare(
  project: Project,
  app: string,
  dir: string,
  name: string,
  frame: Frame,
  update: boolean,
): Promise<{ log?: string; failure?: string }> {
  const path = join(dir, `${name}.png`);
  const golden = await readFile(path).catch(() => null);
  if (!golden || update) {
    if (golden && equal(readFramePng(golden), frame)) return {};
    await writeFile(path, framePng(frame));
    return { log: `${golden ? "updated" : "new"}: ${relative(process.cwd(), path)}` };
  }
  const before = readFramePng(golden);
  if (equal(before, frame)) return {};
  const out = join(project.root, "out", app);
  await mkdir(out, { recursive: true });
  const diff = join(out, `${name}.diff.png`);
  await writeFile(diff, diffPng(before, frame));
  return { failure: `${app}/${name} differs → ${relative(process.cwd(), diff)}` };
}

function equal(a: Bitmap, b: Frame): boolean {
  return a.width === b.width && a.height === b.height && Buffer.from(a.bits).equals(Buffer.from(b.bits));
}

/** Unchanged pixels as on paper; removed ink in red, new ink in blue. */
function diffPng(before: Bitmap, after: Frame): Uint8Array {
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const at = (frame: Bitmap, x: number, y: number) =>
    x < frame.width && y < frame.height &&
    (frame.bits[y * Math.ceil(frame.width / 8) + (x >> 3)] & (128 >> (x & 7))) !== 0;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) pixels[y * width + x] = diffColour(at(before, x, y), at(after, x, y));
  return indexedPng(width, height, [PAPER, INK, [0xe0, 0x30, 0x30], [0x20, 0x60, 0xe0]], pixels);
}

/** Palette index of a pixel that `was` and `is` inked: paper, ink, removed ink, new ink. */
function diffColour(was: boolean, is: boolean): number {
  if (was === is) return Number(is);
  return was ? 2 : 3;
}
