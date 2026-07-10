"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
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
  name: string;
  color: string;
}

interface StockChartProps {
  // One row per day; each row carries `date` plus a numeric value per series key.
  data: Record<string, string | number>[];
  series: StockSeries[];
  officeName: string;
}

export function StockChart({ data, series, officeName }: StockChartProps) {
  const t = useTranslations();
  const locale = useLocale();

  const chartConfig = Object.fromEntries(
    series.map((s) => [s.key, { label: s.name, color: s.color }]),
  ) satisfies ChartConfig;

  const multi = series.length > 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('stock.chartTitle', { office: officeName })}</CardTitle>
        <CardDescription>{t('stock.chartSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="aspect-[3/1] w-full">
          <AreaChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
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
                stackId={undefined}
              />
            ))}
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
