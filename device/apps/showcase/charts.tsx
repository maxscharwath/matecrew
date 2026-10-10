/** @jsxImportSource ../../authoring */
import {
  Card,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
} from "../../authoring";
import { history } from "../../screens/kit-demo";
import { Page } from "./shared";
export function Charts() {
  return (
    <Page name="charts" title="Courbes & barres">
      <Card x={8} y={40} width={252} height={156}>
        <LineChart
          x={8}
          y={10}
          width={236}
          height={136}
          data={history}
          xKey="day"
        >
          <Line dataKey="taken" name="Prises" />
          <Line dataKey="returned" name="Retours" stroke="dashed" />
        </LineChart>
      </Card>
      <Card x={270} y={40} width={122} height={156}>
        <BarChart
          x={8}
          y={10}
          width={106}
          height={136}
          data={history}
          axes={false}
        >
          <Bar dataKey="taken" name="Activité" />
        </BarChart>
      </Card>
    </Page>
  );
}
export function Areas() {
  return (
    <Page name="area" title="Aires & tendances">
      <Card x={8} y={40} width={384} height={156}>
        <AreaChart
          x={10}
          y={10}
          width={364}
          height={136}
          data={history}
          xKey="day"
        >
          <Area dataKey="taken" name="Cette semaine" />
          <Line dataKey="returned" name="Précédente" stroke="dashed" />
        </AreaChart>
      </Card>
    </Page>
  );
}
