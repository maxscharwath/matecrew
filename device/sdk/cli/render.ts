/** `dui render [app...] [--only <text>] [--out <dir>] [--scale <n>]`: every preview to PNG, plus a contact sheet and an HTML index. */
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { Screen, Text, compileScreen } from "../runtime/jsx-runtime";
import { encodeScene } from "../compiler";
import { framePng, indexedPng, INK, PAPER, type Rgb } from "../preview/png";
import type { Frame } from "../preview/engine";
import { appNames, loadProject } from "./project";
import { drawApp, loadEngine, type Drawn } from "./previews";

export async function render(args: string[]): Promise<void> {
  const options = parse(args);
  const project = await loadProject();
  const out = resolve(options.out ?? join(project.root, "out"));
  const started = performance.now();
  let count = 0;
  for (const app of appNames(project, options.apps)) {
    const drawn = await drawApp(project, app, (name) =>
      options.only ? name.includes(options.only) : true,
    );
    if (!drawn.length) continue;
    const dir = join(out, app);
    await mkdir(dir, { recursive: true });
    for (const { name, frame } of drawn)
      await writeFile(join(dir, `${name}.png`), framePng(frame, { scale: options.scale }));
    await writeFile(join(dir, "sheet.png"), await sheet(drawn));
    await writeFile(join(dir, "index.html"), html(app, drawn));
    count += drawn.length;
    console.log(`${app}: ${drawn.length} previews → ${relative(process.cwd(), dir)}/`);
  }
  console.log(`${count} frames in ${Math.round(performance.now() - started)} ms`);
}

function parse(args: string[]) {
  const options: { apps: string[]; only?: string; out?: string; scale: number } = {
    apps: [],
    scale: 1,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--only") options.only = args[++i];
    else if (arg === "--out") options.out = args[++i];
    else if (arg === "--scale") options.scale = Number(args[++i]);
    else if (arg.startsWith("-")) throw new Error(`Unknown option ${arg}`);
    else options.apps.push(arg);
  }
  if (!Number.isInteger(options.scale) || options.scale < 1 || options.scale > 8)
    throw new Error("--scale takes an integer from 1 to 8");
  return options;
}

const BACKDROP: Rgb = [0xc9, 0xc5, 0xbc];
const LABEL = 22;
const GAP = 24;

/** All previews on one image, labelled with the engine's own caption font. */
async function sheet(drawn: Drawn[]): Promise<Uint8Array> {
  const columns = Math.min(3, drawn.length);
  const cellWidth = Math.max(...drawn.map((d) => d.frame.width));
  const cellHeight = Math.max(...drawn.map((d) => d.frame.height)) + LABEL;
  const rows = Math.ceil(drawn.length / columns);
  const width = GAP + columns * (cellWidth + GAP);
  const height = GAP + rows * (cellHeight + GAP);
  const pixels = new Uint8Array(width * height); // 0 backdrop, 1 paper, 2 ink
  const engine = await loadEngine();
  const blit = (frame: Frame, left: number, top: number, background: number) => {
    const row = Math.ceil(frame.width / 8);
    for (let y = 0; y < frame.height; y++)
      for (let x = 0; x < frame.width; x++) {
        const on = frame.bits[y * row + (x >> 3)] & (128 >> (x & 7));
        if (on || background) pixels[(top + y) * width + left + x] = on ? 2 : background;
      }
  };
  drawn.forEach(({ name, frame }, i) => {
    const left = GAP + (i % columns) * (cellWidth + GAP);
    const top = GAP + Math.floor(i / columns) * (cellHeight + GAP);
    blit(label(engine, name, frame.width), left, top, 0);
    blit(frame, left, top + LABEL, 1);
  });
  return indexedPng(width, height, [BACKDROP, PAPER, INK], pixels);
}

function label(engine: Awaited<ReturnType<typeof loadEngine>>, name: string, width: number): Frame {
  const bytes = encodeScene(
    compileScreen(() =>
      Screen({
        width,
        height: LABEL,
        children: Text({ x: 0, y: 2, width, height: LABEL - 2, value: name, font: "body" }),
      }),
    ),
  );
  return engine.render(bytes, { panel: [width, LABEL] });
}

function html(app: string, drawn: Drawn[]): string {
  const escape = (text: string) =>
    text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const cards = drawn
    .map(
      ({ name, description, frame }) => `<figure>
  <img src="${encodeURIComponent(name)}.png" width="${frame.width}" height="${frame.height}" alt="${escape(name)}">
  <figcaption><b>${escape(name)}</b>${description ? ` · ${escape(description)}` : ""}</figcaption>
</figure>`,
    )
    .join("\n");
  return `<!doctype html>
<meta charset="utf-8">
<title>${escape(app)} previews</title>
<style>
  body { margin: 24px; background: #2b2a27; color: #eae6dd; font: 13px ui-monospace, monospace; }
  main { display: flex; flex-wrap: wrap; gap: 24px; }
  figure { margin: 0; }
  img { display: block; image-rendering: pixelated; max-width: 100%; height: auto; }
  figcaption { padding-top: 6px; }
</style>
<h1>${escape(app)}</h1>
<main>
${cards}
</main>
`;
}
