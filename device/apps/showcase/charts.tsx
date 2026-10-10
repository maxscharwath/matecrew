/** @jsxImportSource @matecrew/device-ui */
import {
  HStack,
  VStack,
  Surface,
  Small,
  Label,
  Card,
  Stat,
  StatLabel,
  StatValue,
  Spark,
  LineChart,
  Line,
  BarChart,
  Bar,
} from "@matecrew/device-ui";
import { history } from "./data";
import { Page } from "./shared";

/** Flex lines: how children share a row. Every box here sizes itself; no coordinate anywhere. */
export function LayoutPage() {
  const box = (label: string, width: "hug" | "fill" | { fill: number } | `${number}%` = "hug") => (
    <Surface variant="tint" radius={10} padding={[8, 16]} width={width} align="center">
      <Small align="center">{label}</Small>
    </Surface>
  );
  return (
    <Page name="layout" gap={6}>
      {(["start", "center", "between", "evenly"] as const).map((justify) => (
        <HStack gap={8} justify={justify} width="fill">
          {box(justify)}
          {box("B")}
          {box("C")}
        </HStack>
      ))}
      <Label>fill · poids · %</Label>
      <HStack gap={8} width="fill">
        {box("hug")}
        {box("fill", "fill")}
        {box("fill ×2", { fill: 2 })}
      </HStack>
      <HStack gap={8} width="fill">
        {box("25 %", "25%")}
        {box("75 %", "75%")}
      </HStack>
    </Page>
  );
}

/** Lines, bars and areas: 2 px strokes, dithered fills, labelled axes. */
export function Charts() {
  const taken = history.map((day) => day.taken);
  return (
    <Page name="charts" direction="row" gap={20}>
      <Card width={{ fill: 3 }} height="fill" padding={20}>
        <LineChart data={history} xKey="day">
          <Line dataKey="taken" name="Prises" />
          <Line dataKey="returned" name="Retours" stroke="dashed" />
        </LineChart>
      </Card>
      <VStack gap={16} width={{ fill: 2 }}>
        <Card variant="sunken" height="fill" padding={16}>
          <BarChart data={history} xKey="day" legend={false}>
            <Bar dataKey="taken" />
            <Bar dataKey="returned" stroke="dotted" />
          </BarChart>
        </Card>
        <HStack gap={16}>
          <Stat>
            <StatLabel>Prises</StatLabel>
            <StatValue size="md">122</StatValue>
          </Stat>
          <VStack width="fill">
            <Spark value={taken} max={32} height={56} />
          </VStack>
        </HStack>
      </VStack>
    </Page>
  );
}

