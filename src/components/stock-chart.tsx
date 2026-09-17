"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslations, useLocale } from "next-intl";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface StockSeries {
  key: string;
  /** Companion key holding the projected half of the same item's curve. */
  forecastKey: string;
  name: string;
  color: string;
}

interface StockChartProps {
  // One row per day; each row carries `date` plus a value per series key —
  // null on the side of today the key does not cover.
  data: Record<string, string | number | null>[];
  series: StockSeries[];
  officeName: string;
  historyDays: number;
  /** 0 when nothing is moving and there is no projection worth drawing. */
  forecastDays: number;
  /** ISO day the solid lines stop and the dashed ones take over. */
  todayDate?: string;
}

export function StockChart({
  data,
  series,
  officeName,
  historyDays,
  forecastDays,
  todayDate,
}: StockChartProps) {
  const t = useTranslations();
  const locale = useLocale();

  const chartConfig = Object.fromEntries(
    series.flatMap((s) => [
      [s.key, { label: s.name, color: s.color }],
      [
        s.forecastKey,
        { label: t("stock.forecastSeries", { name: s.name }), color: s.color },
      ],
    ]),
  ) satisfies ChartConfig;

  const multi = series.length > 1;
  const hasForecast = forecastDays > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("stock.chartTitle", { office: officeName })}</CardTitle>
        <CardDescription>
          {hasForecast
            ? t("stock.chartSubtitleWithForecast", {
                history: historyDays,
                forecast: forecastDays,
              })
            : t("stock.chartSubtitle", { history: historyDays })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="aspect-[3/1] w-full">
          <ComposedChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
            <defs>
              {series.map((s) => (
                <linearGradient
                  key={s.key}
                  id={`fill-${s.key}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="5%"
                    stopColor={`var(--color-${s.key})`}
                    stopOpacity={multi ? 0.3 : 0.4}
                  />
                  <stop
                    offset="95%"
                    stopColor={`var(--color-${s.key})`}
                    stopOpacity={0.02}
                  />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(v: string) => {
                const d = new Date(v + "T00:00:00Z");
                return d.toLocaleDateString(locale, {
                  day: "numeric",
                  month: "short",
                  timeZone: "UTC",
                });
              }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              allowDecimals={false}
            />
            <ChartTooltip
              cursor={{ strokeDasharray: "4 4" }}
              content={<ChartTooltipContent indicator="line" />}
            />
            {multi && <ChartLegend content={<ChartLegendContent />} />}
            {series.map((s) => (
              <Area
                key={s.key}
                dataKey={s.key}
                name={s.name}
                type="monotone"
                fill={`url(#fill-${s.key})`}
                stroke={`var(--color-${s.key})`}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
                connectNulls={false}
                stackId={undefined}
              />
            ))}
            {/* The projection rides on the same hue, dashed and unfilled: it is
                the same item, but a guess rather than a reading. */}
            {hasForecast &&
              series.map((s) => (
                <Line
                  key={s.forecastKey}
                  dataKey={s.forecastKey}
                  name={t("stock.forecastSeries", { name: s.name })}
                  type="monotone"
                  stroke={`var(--color-${s.key})`}
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  strokeOpacity={0.85}
                  dot={false}
                  activeDot={{ r: 3 }}
                  connectNulls={false}
                  legendType="none"
                />
              ))}
            {hasForecast && todayDate && (
              <ReferenceLine
                x={todayDate}
                stroke="var(--muted-foreground)"
                strokeDasharray="3 3"
                label={{
                  value: t("stock.chartToday"),
                  position: "insideTopLeft",
                  fill: "var(--muted-foreground)",
                  fontSize: 11,
                }}
              />
            )}
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
