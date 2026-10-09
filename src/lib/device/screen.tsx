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
/** The stock chart's bitmap, drawn by state.ts at this size. */
export const CHART_WIDTH = 176;
export const CHART_HEIGHT = 34;
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
  /** Up to three, each with its picture and the line style it has on the chart (PNG data URLs). */
  items: { name: string; stock: number; low: boolean; image: string; pattern: string }[];
  /** Only with three items or fewer. */
  chart: { image: string; max: number; days: number } | null;
  /** After a session's cutoff, what to take out of the fridge and for whom; replaces the stock. */
  preparation: {
    title: string;
    total: string;
    items: { name: string; count: number; names: string; image: string }[];
  } | null;
  lowLabel: string;
  /** "autres", after the count of items that do not fit. */
  moreLabel: string;
  chartLabel: string;
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
function wrap(text: string, width: number, max: number, glyph = GLYPH_W): string[] {
  const perLine = Math.floor(width / glyph);
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + 1 + word.length <= perLine) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines.slice(0, max).map((line) => line.slice(0, perLine));
}

const text = (size: 8 | 16 | 24, bold = false) =>
  size === 8
    ? { fontFamily: "Silkscreen", fontWeight: bold ? 700 : 400, fontSize: 8, lineHeight: `${LINE_H}px` }
    : { fontFamily: "Pixelify", fontWeight: 700, fontSize: size, lineHeight: 1 };

// eslint-disable-next-line @next/next/no-img-element -- rendered by next/og, not by a browser
const Picture = ({ src, size }: { src: string; size: number }) => <img src={src} width={size} height={size} alt="" />;

/**
 * Names short enough for a tile: "Maté Classic", "Maté Zero" and "Maté
 * Ginger" become "Classic", "Zero" and "Ginger" when they all start alike.
 */
function tileNames(names: string[]): string[] {
  const split = names.map((n) => n.split(/\s+/));
  const firsts = split.map((words) => words[0]);
  return split.map((words) =>
    words.length > 1 && firsts.filter((f) => f === words[0]).length > 1 ? words.slice(1).join(" ") : words.join(" "),
  );
}

/** One item: its picture, its stock, and its name under it, inverted when stock is low. */
function ItemTile({ item, width, lowLabel }: { item: ScreenData["items"][number]; width: number; lowLabel: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width,
        height: 38,
        border: `1px solid ${INK}`,
        borderRadius: 3,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "2px 3px 0" }}>
        <Picture src={item.image} size={24} />
        <div style={{ display: "flex", flex: 1, justifyContent: "center", ...text(item.stock >= 100 ? 16 : 24) }}>
          {item.stock}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 3,
          marginTop: "auto",
          height: 10,
          padding: "0 3px",
          background: item.low ? INK : PAPER,
          color: item.low ? PAPER : INK,
          ...text(8),
        }}
      >
        {!item.low && (
          // eslint-disable-next-line @next/next/no-img-element -- rendered by next/og
          <img src={item.pattern} width={8} height={2} alt="" />
        )}
        {wrap(item.low ? `${item.name} ${lowLabel}` : item.name, width - (item.low ? 8 : 16), 1, 6)[0]}
      </div>
    </div>
  );
}

/** Stock over the last days, one line style per item, scale on the left. */
function Chart({ data, chart }: { data: ScreenData; chart: NonNullable<ScreenData["chart"]> }) {
  return (
    <div style={{ display: "flex", position: "absolute", top: 56, left: 2, width: W - 4, height: 48 }}>
      <div style={{ display: "flex", position: "absolute", top: 0, left: 20, ...text(8, true) }}>{data.chartLabel}</div>
      <div style={{ display: "flex", position: "absolute", top: 9, left: 0, width: 16, justifyContent: "flex-end", ...text(8) }}>
        {chart.max}
      </div>
      <div style={{ display: "flex", position: "absolute", top: 38, left: 0, width: 16, justifyContent: "flex-end", ...text(8) }}>0</div>
      <div style={{ display: "flex", position: "absolute", top: 11, left: 19 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- rendered by next/og */}
        <img src={chart.image} width={CHART_WIDTH} height={CHART_HEIGHT} alt="" />
      </div>
    </div>
  );
}

/** What to take out of the fridge for the session that just closed, and for whom. */
function Preparation({ prep }: { prep: NonNullable<ScreenData["preparation"]> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", position: "absolute", top: STATUS_H + 3, left: 4, width: W - 8 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          height: 11,
          padding: "1px 4px 0",
          background: INK,
          color: PAPER,
          borderRadius: 3,
          ...text(8, true),
        }}
      >
        <span>{prep.title}</span>
        <span>{prep.total}</span>
      </div>
      {prep.items.length > 3 ? (
        <PreparationList prep={prep} />
      ) : (
        prep.items.map((item) => (
        <div key={item.name} style={{ display: "flex", alignItems: "center", gap: 5, height: 26, marginTop: 1 }}>
          <Picture src={item.image} size={24} />
          <div style={{ display: "flex", width: 26, justifyContent: "center", ...text(16) }}>{`×${item.count}`}</div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ display: "flex", ...text(8, true) }}>{wrap(item.name, 130, 1)[0]}</div>
            {wrap(item.names, 136, 2).map((line) => (
              <div key={line} style={{ display: "flex", ...text(8) }}>
                {line}
              </div>
            ))}
          </div>
        </div>
        ))
      )}
    </div>
  );
}

/** Many items to prepare: one line each, the count, the item, whose. */
function PreparationList({ prep }: { prep: NonNullable<ScreenData["preparation"]> }) {
  const rows = 7;
  const shown = prep.items.length > rows ? prep.items.slice(0, rows - 1) : prep.items;
  const rest = prep.items.length - shown.length;
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 2 }}>
      {shown.map((item) => (
        <div key={item.name} style={{ display: "flex", alignItems: "center", gap: 4, height: LINE_H + 2 }}>
          <div style={{ display: "flex", width: 22, justifyContent: "flex-end", ...text(8, true) }}>{`×${item.count}`}</div>
          <div style={{ display: "flex", width: 64, ...text(8, true) }}>{wrap(item.name, 64, 1, 7)[0]}</div>
          <div style={{ display: "flex", flex: 1, ...text(8) }}>{wrap(item.names, 98, 1, 6)[0]}</div>
        </div>
      ))}
      {rest > 0 && <div style={{ display: "flex", paddingLeft: 26, ...text(8) }}>{`+${rest}`}</div>}
    </div>
  );
}

/** A black tab against the bottom edge, as close as it fits above its touch key. */
function KeyTab({ side, label }: { side: "left" | "right"; label: string }) {
  const box = 80;
  const left = Math.min(Math.max(KEY_X[side] - box / 2, 0), W - box);
  return (
    <div style={{ display: "flex", position: "absolute", bottom: 0, left, width: box, justifyContent: "center" }}>
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
          whiteSpace: "nowrap",
          ...text(8, true),
        }}
      >
        {label}
        <Bitmap rows={ARROW_DOWN} color={PAPER} />
      </div>
    </div>
  );
}

/** Up to fourteen items, in two columns, when tiles no longer fit. */
function ItemList({ data, names }: { data: ScreenData; names: string[] }) {
  const perColumn = 7;
  const fits = perColumn * 2;
  const shown = data.items.length > fits ? data.items.slice(0, fits - 1) : data.items;
  const rest = data.items.length - shown.length;
  const columns = [shown.slice(0, perColumn), shown.slice(perColumn)];
  const width = (W - 8 - 6) / 2;
  return (
    <div style={{ display: "flex", position: "absolute", top: STATUS_H + 3, left: 4, width: W - 8, gap: 6 }}>
      {columns.map((column, c) => (
        <div key={c} style={{ display: "flex", flexDirection: "column", width }}>
          {column.map((item, i) => (
            <div
              key={item.name}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                height: LINE_H + 2,
                padding: "0 3px",
                background: item.low ? INK : PAPER,
                color: item.low ? PAPER : INK,
                borderBottom: item.low ? "none" : `1px dashed ${INK}`,
              }}
            >
              <span style={{ display: "flex", ...text(8) }}>{wrap(names[c * perColumn + i], width - 26, 1, 6)[0]}</span>
              <span style={{ display: "flex", ...text(8, true) }}>{item.stock}</span>
            </div>
          ))}
          {c === 1 && rest > 0 && (
            <div style={{ display: "flex", height: LINE_H + 2, padding: "0 3px", ...text(8) }}>
              {`+${rest} ${data.moreLabel}`}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The stock, laid out for how many items there are: one row of tiles and
 * the chart up to three, two rows of tiles up to six, a two-column list beyond.
 */
function Stock({ data }: { data: ScreenData }) {
  const names = tileNames(data.items.map((item) => item.name));
  const count = data.items.length;
  if (count > 6) return <ItemList data={data} names={names} />;
  const gap = 4;
  const perRow = Math.min(3, Math.max(1, count));
  const width = Math.floor((W - 8 - gap * (perRow - 1)) / perRow);
  const rows = [data.items.slice(0, perRow), data.items.slice(perRow)].filter((row) => row.length > 0);
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", position: "absolute", top: STATUS_H + 3, left: 4, width: W - 8, gap }}>
        {rows.map((row, r) => (
          <div key={r} style={{ display: "flex", gap }}>
            {row.map((item, i) => (
              <ItemTile key={item.name} item={{ ...item, name: names[r * perRow + i] }} width={width} lowLabel={data.lowLabel} />
            ))}
          </div>
        ))}
      </div>
      {data.chart && <Chart data={data} chart={data.chart} />}
    </>
  );
}

function MainScreen({ data }: { data: ScreenData }) {
  return (
    <div style={{ display: "flex", position: "relative", width: W, height: H, background: PAPER, color: INK }}>
      <StatusBar data={data} />
      <DottedRule top={STATUS_H} />
      {data.preparation ? <Preparation prep={data.preparation} /> : <Stock data={data} />}
      <KeyTab side="left" label={data.leftLabel} />
      <KeyTab side="right" label={data.rightLabel} />
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
