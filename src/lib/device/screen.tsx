/**
 * The terminal's main screen, written in React and rendered on the server.
 *
 * Like the screens the device draws itself (device/ui), it is 1-bit pixel art
 * on a 200 x 120 canvas: next/og renders the JSX with pixel fonts, the result
 * is thresholded, then every pixel becomes a 4 x 4 block of the 800 x 480
 * panel. Output format: rows top to bottom, 8 pixels per byte, most
 * significant bit first, 1 = ink.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";

export const SCREEN_WIDTH = 800;
export const SCREEN_HEIGHT = 480;
const SCALE = 4;
const W = SCREEN_WIDTH / SCALE;
const H = SCREEN_HEIGHT / SCALE;
/** Key centres on the canvas, from the enclosure model in device/hardware. */
const KEY_X = { left: 32, right: 168 };
const STATUS_H = 12;
const TAB_H = 14;
const INK = "#000";
const PAPER = "#fff";

export type ScreenData = {
  officeName: string;
  /** When the screen was rendered, "20:25". */
  time: string;
  /** 0 to 3, null until the device reports its signal. */
  wifiBars: number | null;
  /** 0 to 100, null until the device reports its battery. */
  batteryPercent: number | null;
  batteryLowLabel: string | null;
  items: { name: string; stock: number; caption: string; low: boolean }[];
  leftLabel: string;
  rightLabel: string;
};

type Font = { name: string; data: Buffer; weight: 400 | 700 };
let fonts: Promise<Font[]> | null = null;

function loadFonts() {
  fonts ??= Promise.all(
    ([
      ["Silkscreen", "Silkscreen-Regular.woff", 400],
      ["Silkscreen", "Silkscreen-Bold.woff", 700],
      ["Pixelify", "PixelifySans-Bold.woff", 700],
    ] as const).map(async ([name, file, weight]) => ({
      name,
      data: await readFile(join(process.cwd(), "assets/fonts", file)),
      weight,
    })),
  );
  return fonts;
}

/** A bitmap from rows of "#" and ".", one rect per pixel. */
function Bitmap({ rows, color = INK }: { rows: string[]; color?: string }) {
  const width = rows[0].length;
  return (
    <svg width={width} height={rows.length} viewBox={`0 0 ${width} ${rows.length}`}>
      {rows.flatMap((row, y) =>
        [...row].map((c, x) => (c === "#" ? <rect key={`${x}.${y}`} x={x} y={y} width="1" height="1" fill={color} /> : null)),
      )}
    </svg>
  );
}

const ARROW_DOWN = ["#####", ".###.", "..#.."];

function WifiIcon({ bars }: { bars: number }) {
  return (
    <svg width="8" height="7" viewBox="0 0 8 7">
      {[3, 5, 7].map((h, i) =>
        i < bars ? (
          <rect key={i} x={i * 3} y={7 - h} width="2" height={h} fill={INK} />
        ) : (
          <rect key={i} x={i * 3} y="6" width="2" height="1" fill={INK} />
        ),
      )}
    </svg>
  );
}

function BatteryIcon({ percent }: { percent: number }) {
  const fill = Math.round((Math.min(100, Math.max(0, percent)) / 100) * 8);
  return (
    <svg width="14" height="7" viewBox="0 0 14 7">
      <path d="M0 0h12v7H0z M1 1v5h10V1z" fill={INK} fillRule="evenodd" />
      <rect x="12" y="2" width="2" height="3" fill={INK} />
      <rect x="2" y="2" width={fill} height="3" fill={INK} />
    </svg>
  );
}

function DottedRule({ top }: { top: number }) {
  return (
    <div style={{ display: "flex", position: "absolute", top, left: 0, width: W, height: 1, gap: 1 }}>
      {Array.from({ length: W / 2 }, (_, i) => (
        <div key={i} style={{ display: "flex", width: 1, height: 1, background: INK }} />
      ))}
    </div>
  );
}

function StatusBar({ data }: { data: ScreenData }) {
  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        top: 0,
        left: 3,
        width: W - 6,
        height: STATUS_H,
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", fontFamily: "Silkscreen", fontWeight: 700, fontSize: 8 }}>{data.officeName}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {data.batteryLowLabel ? (
          <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 8, padding: "0 2px", background: INK, color: PAPER }}>
            {data.batteryLowLabel}
          </div>
        ) : (
          <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 8 }}>{data.time}</div>
        )}
        {data.wifiBars !== null && <WifiIcon bars={data.wifiBars} />}
        {data.batteryPercent !== null && <BatteryIcon percent={data.batteryPercent} />}
      </div>
    </div>
  );
}

/** Silkscreen at 8 px: glyphs are about 7 px wide, lines 9 px apart. */
const GLYPH_W = 7;
const LINE_H = 9;

/** Wraps `text` on words into at most `max` lines of `width` pixels, cutting what is left over. */
function wrap(text: string, width: number, max: number): string[] {
  const perLine = Math.floor(width / GLYPH_W);
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + 1 + word.length <= perLine) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines.slice(0, max).map((line) => line.slice(0, perLine));
}

type CardLayout = { width: number; nameLines: number; numberSize: number };

const nameWidth = (cardWidth: number) => cardWidth - 6;

function ItemCard({ item, layout }: { item: ScreenData["items"][number]; layout: CardLayout }) {
  const { width, nameLines, numberSize } = layout;
  return (
    <div
      style={{
        display: "flex",
        width,
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        border: `1px solid ${INK}`,
        borderRadius: 3,
        padding: "3px 2px 4px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: LINE_H * nameLines,
          fontFamily: "Silkscreen",
          fontWeight: 700,
          fontSize: 8,
          lineHeight: `${LINE_H}px`,
        }}
      >
        {wrap(item.name, nameWidth(width), 2).map((line) => (
          <div key={line} style={{ display: "flex", whiteSpace: "nowrap" }}>
            {line}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", fontFamily: "Pixelify", fontWeight: 700, fontSize: numberSize, lineHeight: 1 }}>
        {item.stock}
      </div>
      <div
        style={{
          display: "flex",
          fontFamily: "Silkscreen",
          fontSize: 8,
          padding: "0 2px",
          background: item.low ? INK : PAPER,
          color: item.low ? PAPER : INK,
        }}
      >
        {item.caption}
      </div>
    </div>
  );
}

/**
 * The action of a touch key: the verb in a black tab against the bottom edge,
 * right above the key, and what it applies to just over the tab, running
 * towards the middle of the screen. Default labels read "Verb · Item".
 */
function KeyHint({ side, label }: { side: "left" | "right"; label: string }) {
  const [verb, ...rest] = label.split(" · ");
  const x = KEY_X[side];
  const reach = Math.min(x, W - x);
  return (
    <>
      {rest.length > 0 && (
        <div
          style={{
            display: "flex",
            position: "absolute",
            bottom: TAB_H + 2,
            left: side === "left" ? 2 : W / 2,
            width: W / 2 - 2,
            justifyContent: side === "left" ? "flex-start" : "flex-end",
            whiteSpace: "nowrap",
            fontFamily: "Silkscreen",
            fontSize: 8,
          }}
        >
          {wrap(rest.join(" · "), W / 2 - 6, 1)[0]}
        </div>
      )}
      <div
        style={{
          display: "flex",
          position: "absolute",
          bottom: 0,
          left: x - reach,
          width: reach * 2,
          justifyContent: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            height: TAB_H,
            alignItems: "center",
            gap: 2,
            padding: "0 4px",
            background: INK,
            color: PAPER,
            borderRadius: "3px 3px 0 0",
          }}
        >
          <div style={{ display: "flex", fontFamily: "Silkscreen", fontWeight: 700, fontSize: 8 }}>{verb}</div>
          <Bitmap rows={ARROW_DOWN} color={PAPER} />
        </div>
      </div>
    </>
  );
}

function MainScreen({ data }: { data: ScreenData }) {
  const items = data.items.slice(0, 3);
  const gap = 4;
  const width = Math.floor((W - 8 - gap * (items.length - 1)) / Math.max(1, items.length));
  const nameLines = Math.max(1, ...items.map((item) => wrap(item.name, nameWidth(width), 2).length));
  // The card is 70 px tall: what the names and the caption leave goes to the number.
  const layout = { width, nameLines, numberSize: nameLines === 1 ? 40 : 32 };
  return (
    <div style={{ display: "flex", position: "relative", width: W, height: H, background: PAPER, color: INK }}>
      <StatusBar data={data} />
      <DottedRule top={STATUS_H} />
      <div
        style={{
          display: "flex",
          position: "absolute",
          top: STATUS_H + 5,
          left: 4,
          width: W - 8,
          height: 70,
          gap,
        }}
      >
        {items.map((item) => (
          <ItemCard key={item.name} item={item} layout={layout} />
        ))}
      </div>
      <KeyHint side="left" label={data.leftLabel} />
      <KeyHint side="right" label={data.rightLabel} />
    </div>
  );
}

export async function renderScreenPng(data: ScreenData): Promise<Buffer> {
  const image = new ImageResponse(<MainScreen data={data} />, {
    width: W,
    height: H,
    fonts: await loadFonts(),
  });
  return Buffer.from(await image.arrayBuffer());
}

/** Thresholds the 200 x 120 render and scales it x4 into the panel's packed format. */
export async function renderScreenBits(data: ScreenData): Promise<Buffer> {
  const { data: gray } = await sharp(await renderScreenPng(data))
    .flatten({ background: PAPER })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bits = Buffer.alloc((SCREEN_WIDTH * SCREEN_HEIGHT) / 8);
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      if (gray[Math.floor(y / SCALE) * W + Math.floor(x / SCALE)] < 128) {
        const i = y * SCREEN_WIDTH + x;
        bits[i >> 3] |= 0x80 >> (i & 7);
      }
    }
  }
  return bits;
}

/** PNG of exactly what the panel will show, for the admin preview. */
export async function bitsToPng(bits: Buffer): Promise<Buffer> {
  const gray = Buffer.alloc(SCREEN_WIDTH * SCREEN_HEIGHT);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = bits[i >> 3] & (0x80 >> (i & 7)) ? 0 : 255;
  }
  return sharp(gray, { raw: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT, channels: 1 } })
    .png()
    .toBuffer();
}
