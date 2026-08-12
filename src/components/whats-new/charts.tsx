/**
 * Chart primitives for release-note articles.
 *
 * Server-rendered HTML and inline SVG rather than Chart.js: an article is static
 * content, so shipping a charting runtime to draw six bars would be waste, and
 * these inherit the theme tokens so they restyle with the brand and follow dark
 * mode without a second palette.
 *
 * Horizontal bars are built from HTML, not SVG, because category labels then get
 * real text layout (wrapping, font metrics, translation length) instead of
 * hand-positioned <text>. SVG is used only where geometry genuinely needs it.
 *
 * Colours come from --chart-1..5, which are validated for CVD separation,
 * chroma and contrast against both surfaces. Every series here is also labelled,
 * so identity is never carried by colour alone.
 */

const SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

interface Datum {
  readonly label: string;
  readonly value: number;
  /** Optional override, e.g. to keep one product's colour stable across charts. */
  readonly series?: number;
}

function Figure({
  title,
  caption,
  children,
}: {
  readonly title?: string;
  readonly caption?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <figure className="mb-4 rounded-xl border bg-card p-4">
      {title && (
        <figcaption className="mb-3 text-sm font-medium">{title}</figcaption>
      )}
      {children}
      {caption && (
        <figcaption className="mt-3 text-xs text-muted-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * Horizontal bars for magnitude across a handful of named things.
 *
 * Single series, so there is no legend: the title names what is measured. Values
 * are labelled directly, which is also what makes the two adjacent hues legal
 * under the CVD floor.
 */
export function BarChart({
  title,
  caption,
  unit = "",
  data,
}: {
  readonly title?: string;
  readonly caption?: string;
  readonly unit?: string;
  readonly data: readonly Datum[];
}) {
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <Figure title={title} caption={caption}>
      <div className="space-y-2">
        {data.map((d, i) => (
          <div key={d.label} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3">
            <span className="truncate text-xs text-muted-foreground">
              {d.label}
            </span>
            {/* The track keeps every row the same length, so bar lengths stay
                comparable even when the label column wraps. */}
            <span className="h-2.5 w-full rounded-full bg-muted">
              <span
                className="block h-2.5 rounded-full"
                style={{
                  width: `${Math.max((d.value / max) * 100, 2)}%`,
                  background: SERIES[(d.series ?? i) % SERIES.length],
                }}
              />
            </span>
            <span className="text-xs font-medium tabular-nums">
              {d.value}
              {unit}
            </span>
          </div>
        ))}
      </div>
    </Figure>
  );
}

/**
 * A short run of values over time, as an area plus line.
 *
 * Only the first and last points are labelled: a number on every point is noise
 * at this size, and the shape is the message.
 */
export function TrendChart({
  title,
  caption,
  unit = "",
  data,
}: {
  readonly title?: string;
  readonly caption?: string;
  readonly unit?: string;
  readonly data: readonly Datum[];
}) {
  const width = 640;
  const height = 168;
  // Top padding leaves room for the value label above the highest point, which
  // sits at y=0 of the plot area and would otherwise be clipped by the viewBox.
  const pad = { top: 26, right: 16, bottom: 22, left: 16 };
  const max = Math.max(...data.map((d) => d.value), 1);
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const x = (i: number) =>
    pad.left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;

  const line = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const area = `${pad.left},${pad.top + innerH} ${line} ${pad.left + innerW},${pad.top + innerH}`;

  return (
    <Figure title={title} caption={caption}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-40 w-full"
        role="img"
        aria-label={title ?? "Trend"}
      >
        {/* Recessive baseline only: no grid, the values are labelled. */}
        <line
          x1={pad.left}
          y1={pad.top + innerH}
          x2={pad.left + innerW}
          y2={pad.top + innerH}
          stroke="var(--border)"
          strokeWidth="1"
        />
        <polygon points={area} fill="var(--chart-1)" fillOpacity="0.14" />
        <polyline
          points={line}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {data.map((d, i) => {
          const isEdge = i === 0 || i === data.length - 1;
          if (!isEdge) return null;
          return (
            <g key={d.label}>
              {/* 2px surface ring so the marker stays readable over the area. */}
              <circle
                cx={x(i)}
                cy={y(d.value)}
                r="4.5"
                fill="var(--chart-1)"
                stroke="var(--card)"
                strokeWidth="2"
              />
              <text
                x={x(i)}
                y={y(d.value) - 10}
                textAnchor={i === 0 ? "start" : "end"}
                className="fill-foreground text-[11px] font-medium"
              >
                {d.value}
                {unit}
              </text>
            </g>
          );
        })}
        {data.map((d, i) =>
          i === 0 || i === data.length - 1 ? (
            <text
              key={`${d.label}-x`}
              x={x(i)}
              y={height - 6}
              textAnchor={i === 0 ? "start" : "end"}
              className="fill-muted-foreground text-[10px]"
            >
              {d.label}
            </text>
          ) : null,
        )}
      </svg>
    </Figure>
  );
}

/**
 * A value against a reference range, for the health figures.
 *
 * Not a chart but a meter: one number compared to two published thresholds. The
 * state is named in text as well as positioned, so it never depends on colour.
 */
export function Meter({
  label,
  value,
  unit,
  ideal,
  max,
  state,
}: {
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly ideal: number;
  readonly max: number;
  readonly state: string;
}) {
  const scale = Math.max(max * 1.25, value * 1.1);
  const pct = (n: number) => `${Math.min((n / scale) * 100, 100)}%`;
  // Amber below the ideal line, coral past the max: the same steps the stats
  // screen uses for its risk ratings.
  const fill =
    value <= ideal ? SERIES[0] : value <= max ? SERIES[1] : SERIES[3];

  return (
    <div className="mb-3 rounded-lg border p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">
            {value}
            {unit}
          </span>{" "}
          · {state}
        </span>
      </div>
      <div className="relative h-2.5 w-full rounded-full bg-muted">
        <div
          className="h-2.5 rounded-full"
          style={{ width: pct(value), background: fill }}
        />
        {/* Reference lines, drawn over the fill so they stay visible. */}
        {[
          { at: ideal, title: `ideal ${ideal}${unit}` },
          { at: max, title: `max ${max}${unit}` },
        ].map((ref) => (
          <span
            key={ref.at}
            title={ref.title}
            className="absolute top-[-3px] h-[17px] w-px bg-foreground/35"
            style={{ left: pct(ref.at) }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>0</span>
        <span>
          ideal {ideal}
          {unit} · max {max}
          {unit}
        </span>
      </div>
    </div>
  );
}

/** A row of headline numbers, for when the answer is not a chart at all. */
export function StatTiles({
  items,
}: {
  readonly items: readonly {
    readonly label: string;
    readonly value: string;
    readonly hint?: string;
  }[];
}) {
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border bg-card p-3">
          <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
            {item.label}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {item.value}
          </p>
          {item.hint && (
            <p className="mt-0.5 text-xs text-muted-foreground">{item.hint}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * A stacked split showing how one total divides, with a 2px surface gap between
 * segments so adjacent fills never touch.
 */
export function SplitBar({
  title,
  caption,
  data,
  unit = "",
}: {
  readonly title?: string;
  readonly caption?: string;
  readonly data: readonly Datum[];
  readonly unit?: string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;

  return (
    <Figure title={title} caption={caption}>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
        {data.map((d, i) => (
          <span
            key={d.label}
            className="h-3 first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${(d.value / total) * 100}%`,
              background: SERIES[(d.series ?? i) % SERIES.length],
            }}
          />
        ))}
      </div>
      {/* Legend: more than one series, so identity needs a key as well as position. */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-1.5 text-xs">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-sm"
              style={{ background: SERIES[(d.series ?? i) % SERIES.length] }}
            />
            <span className="text-muted-foreground">{d.label}</span>
            <span className="font-medium tabular-nums">
              {d.value}
              {unit}
            </span>
          </li>
        ))}
      </ul>
    </Figure>
  );
}

/** A terminal transcript, for setup instructions inside an article. */
export function Terminal({
  lines,
}: {
  readonly lines: readonly { readonly cmd: string; readonly out?: string }[];
}) {
  return (
    <div className="mb-4 overflow-hidden rounded-xl border bg-foreground/[0.04]">
      <div className="flex items-center gap-1.5 border-b px-3 py-2">
        {["bg-chart-4", "bg-chart-2", "bg-chart-1"].map((c) => (
          <span key={c} className={`size-2.5 rounded-full ${c} opacity-70`} />
        ))}
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        {lines.map((line) => (
          <span key={line.cmd} className="block">
            <span className="text-muted-foreground select-none">$ </span>
            <span className="font-medium">{line.cmd}</span>
            {line.out && (
              <span className="block text-muted-foreground">{line.out}</span>
            )}
          </span>
        ))}
      </pre>
    </div>
  );
}
