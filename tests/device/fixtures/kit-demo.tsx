/** @jsxImportSource @matecrew/device-ui */
import {
  Screen,
  Main,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  VStack,
  Label,
  Small,
  Image,
  LineChart,
  Line,
  BarChart,
  Bar,
} from "@matecrew/device-ui";

import { history } from "../../../device/apps/showcase/data";

/** A downloadable app built from the kit: charts, a web image, cards, laid out by flex. */
export default function KitDemo() {
  return (
    <Screen>
      <Main direction="row" gap={16}>
        <Card width={{ fill: 2 }} height="fill">
          <CardHeader>
            <CardTitle>Cette semaine</CardTitle>
            <CardDescription>122 prises · +18 %</CardDescription>
          </CardHeader>
          <CardContent>
            <LineChart data={history} xKey="day">
              <Line dataKey="taken" name="Prises" />
              <Line dataKey="returned" name="Retours" stroke="dashed" />
            </LineChart>
          </CardContent>
        </Card>
        <VStack gap={16} width="fill">
          <Card variant="sunken" align="center">
            <Image width={200} height={120} src="/device/streamline-coffee.png" fit="contain" />
            <Small>Évasion</Small>
          </Card>
          <Card height="fill">
            <Label>Activité</Label>
            <BarChart data={history} axes={false} legend={false}>
              <Bar dataKey="taken" />
            </BarChart>
          </Card>
        </VStack>
      </Main>
    </Screen>
  );
}
