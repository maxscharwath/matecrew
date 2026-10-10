/** `dui test [app...] [--update]`: compare every preview with its golden PNG in `__snapshots__/`. */
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { framePng, indexedPng, readFramePng, INK, PAPER } from "../preview/png";
import type { Frame } from "../preview/engine";
import { appNames, loadProject } from "./project";
import { drawApp, snapshotDir } from "./previews";

export async function test(args: string[]): Promise<void> {
  const update = args.includes("--update");
  const project = await loadProject();
  const failures: string[] = [];
  let checked = 0;
  for (const app of appNames(project, args.filter((arg) => !arg.startsWith("-")))) {
    const dir = snapshotDir(project, app);
    await mkdir(dir, { recursive: true });
    const drawn = await drawApp(project, app);
    const names = new Set(drawn.map(({ name }) => `${name}.png`));
    for (const { name, frame } of drawn) {
      checked++;
      const path = join(dir, `${name}.png`);
      const golden = await readFile(path).catch(() => null);
      const same = golden && equal(readFramePng(golden), frame);
      if (same) continue;
      if (update || !golden) {
        await writeFile(path, framePng(frame));
        console.log(`${golden ? "updated" : "new"}: ${relative(process.cwd(), path)}`);
        continue;
      }
      const diff = join(project.root, "out", app, `${name}.diff.png`);
      await mkdir(join(project.root, "out", app), { recursive: true });
      await writeFile(diff, diffPng(readFramePng(golden), frame));
      failures.push(`${app}/${name} differs → ${relative(process.cwd(), diff)}`);
    }
    for (const file of await readdir(dir))
      if (file.endsWith(".png") && !names.has(file)) {
        if (update) {
          await unlink(join(dir, file));
          console.log(`removed: ${relative(process.cwd(), join(dir, file))}`);
        } else failures.push(`${app}/${file}: snapshot without a preview (run --update)`);
      }
  }
  if (failures.length) {
    console.error(`${failures.length} of ${checked} previews changed:\n  ${failures.join("\n  ")}\nReview the diffs, then run \`dui test --update\`.`);
    process.exitCode = 1;
  } else console.log(`${checked} previews match their snapshots`);
}

function equal(a: Pick<Frame, "width" | "height" | "bits">, b: Frame): boolean {
  return a.width === b.width && a.height === b.height && Buffer.from(a.bits).equals(Buffer.from(b.bits));
}

/** Unchanged pixels as on paper; removed ink in red, new ink in blue. */
function diffPng(before: Pick<Frame, "width" | "height" | "bits">, after: Frame): Uint8Array {
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const at = (frame: Pick<Frame, "width" | "height" | "bits">, x: number, y: number) =>
    x < frame.width && y < frame.height &&
    (frame.bits[y * Math.ceil(frame.width / 8) + (x >> 3)] & (128 >> (x & 7))) !== 0;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const was = at(before, x, y);
      const is = at(after, x, y);
      pixels[y * width + x] = was === is ? (is ? 1 : 0) : was ? 2 : 3;
    }
  return indexedPng(width, height, [PAPER, INK, [0xe0, 0x30, 0x30], [0x20, 0x60, 0xe0]], pixels);
}
