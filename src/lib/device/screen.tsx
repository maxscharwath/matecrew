/**
 * The terminal's main screen, written in React and rendered on the server.
 *
 * next/og turns the JSX into a PNG; the PNG is thresholded into the panel's
 * 1-bit format: 800 x 480, rows top to bottom, 8 pixels per byte, most
 * significant bit first, 1 = ink. The terminal draws the bytes as they come.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";

export const SCREEN_WIDTH = 800;
export const SCREEN_HEIGHT = 480;
/** Key centres on the panel, from the enclosure model in device/hardware. */
const KEY_X = { left: 130, right: 670 };
const FOOTER_TOP = 400;

export type ScreenData = {
  officeName: string;
  updatedLabel: string;
  batteryLowLabel: string | null;
  items: { name: string; stock: number; caption: string; low: boolean }[];
  leftLabel: string;
  rightLabel: string;
};

let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 700 | 800 }[]> | null = null;

function loadFonts() {
  fonts ??= Promise.all(
    ([
      ["Inter-Regular.woff", 400],
      ["Inter-Bold.woff", 700],
      ["Inter-ExtraBold.woff", 800],
    ] as const).map(async ([file, weight]) => ({
      name: "Inter",
      data: await readFile(join(process.cwd(), "assets/fonts", file)),
      weight,
    })),
  );
  return fonts;
}

/** Default labels read "Verb · Item": the verb goes on its own line so both fit above the key. */
function KeyLabel({ x, label }: { x: number; label: string }) {
  const [first, ...rest] = label.split(" · ");
  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        top: FOOTER_TOP + 8,
        left: x - 125,
        width: 250,
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div style={{ display: "flex", fontSize: 24, fontWeight: 800 }}>{first}</div>
      {rest.length > 0 && <div style={{ display: "flex", fontSize: 20 }}>{rest.join(" · ")}</div>}
      <svg width="22" height="12" viewBox="0 0 22 12" style={{ marginTop: 4 }}>
        <path d="M0 0 L22 0 L11 12 Z" fill="#000" />
      </svg>
    </div>
  );
}

function MainScreen({ data }: { data: ScreenData }) {
  const big = data.items.length <= 2 ? 150 : data.items.length === 3 ? 110 : 80;
  return (
    <div
      style={{
        display: "flex",
        width: SCREEN_WIDTH,
        height: SCREEN_HEIGHT,
        flexDirection: "column",
        position: "relative",
        background: "#fff",
        color: "#000",
        fontFamily: "Inter",
        padding: "26px 30px 0",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ display: "flex", fontSize: 34, fontWeight: 800 }}>{data.officeName}</div>
        <div style={{ display: "flex", fontSize: 22 }}>{data.batteryLowLabel ?? data.updatedLabel}</div>
      </div>
      <div style={{ display: "flex", height: 3, background: "#000", marginTop: 14 }} />

      <div style={{ display: "flex", flex: 1, justifyContent: "space-around", alignItems: "center", paddingBottom: 100 }}>
        {data.items.slice(0, 4).map((item) => (
          <div key={item.name} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ display: "flex", fontSize: 28, fontWeight: 700 }}>{item.name}</div>
            <div style={{ display: "flex", fontSize: big, fontWeight: 800, lineHeight: 1 }}>{item.stock}</div>
            <div
              style={{
                display: "flex",
                fontSize: 22,
                marginTop: 6,
                padding: item.low ? "2px 10px" : 0,
                background: item.low ? "#000" : "#fff",
                color: item.low ? "#fff" : "#000",
              }}
            >
              {item.caption}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", position: "absolute", top: FOOTER_TOP, left: 30, width: SCREEN_WIDTH - 60, height: 2, background: "#000" }} />
      <KeyLabel x={KEY_X.left} label={data.leftLabel} />
      <KeyLabel x={KEY_X.right} label={data.rightLabel} />
    </div>
  );
}

export async function renderScreenPng(data: ScreenData): Promise<Buffer> {
  const image = new ImageResponse(<MainScreen data={data} />, {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    fonts: await loadFonts(),
  });
  return Buffer.from(await image.arrayBuffer());
}

/** Thresholds the rendered PNG into the panel's packed 1-bit format. */
export async function renderScreenBits(data: ScreenData): Promise<Buffer> {
  const { data: gray } = await sharp(await renderScreenPng(data))
    .flatten({ background: "#ffffff" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bits = Buffer.alloc((SCREEN_WIDTH * SCREEN_HEIGHT) / 8);
  for (let i = 0; i < SCREEN_WIDTH * SCREEN_HEIGHT; i++) {
    if (gray[i] < 128) bits[i >> 3] |= 0x80 >> (i & 7);
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
