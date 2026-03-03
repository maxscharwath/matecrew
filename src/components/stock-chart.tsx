"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
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

interface StockChartProps {
  data: { date: string; qty: number }[];
  officeName: string;
}

const chartConfig = {
  qty: {
    label: "Stock",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

export function StockChart({ data, officeName }: StockChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock Level — {officeName}</CardTitle>
        <CardDescription>Last 30 days</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="aspect-[3/1] w-full">
          <AreaChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(v: string) => {
                const d = new Date(v + "T00:00:00Z");
                return d.toLocaleDateString("fr-CH", {
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
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area
              dataKey="qty"
              type="monotone"
              fill="var(--color-qty)"
              fillOpacity={0.2}
              stroke="var(--color-qty)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
