/** @jsxImportSource ../authoring */
import {
  Screen,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Image,
  Text,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
} from "../authoring";

export const history = [
  { day: "Lun", taken: 12, returned: 6 },
  { day: "Mar", taken: 18, returned: 9 },
  { day: "Mer", taken: 13, returned: 5 },
  { day: "Jeu", taken: 26, returned: 14 },
  { day: "Ven", taken: 21, returned: 11 },
  { day: "Sam", taken: 32, returned: 17 },
];

export default function KitDemo() {
  return (
    <Screen width={400} height={240} theme="macos">
      <Card x={6} y={6} width={248} height={228}>
        <CardHeader x={14} y={10} width={220} height={56}>
          <CardTitle width={220} value="Cette semaine" />
          <CardDescription width={220} value="122 prises · +18 %" />
        </CardHeader>
        <CardContent x={10} y={78} width={228} height={138}>
          <LineChart width={228} height={138} data={history} xKey="day">
            <Line dataKey="taken" name="Prises" />
            <Line dataKey="returned" name="Retours" stroke="dashed" />
          </LineChart>
        </CardContent>
      </Card>
      <Card x={262} y={6} width={132} height={108}>
        <Image
          x={6}
          y={6}
          width={120}
          height={64}
          src="/device/streamline-coffee.png"
          fit="contain"
        />
        <Text
          x={10}
          y={74}
          width={112}
          height={24}
          font="caption"
          value="Évasion"
        />
      </Card>
      <Card x={262} y={122} width={132} height={112}>
        <Text
          x={10}
          y={6}
          width={112}
          height={24}
          font="caption"
          value="Activité"
        />
        <BarChart
          x={8}
          y={38}
          width={116}
          height={62}
          data={history}
          axes={false}
          legend={false}
        >
          <Bar dataKey="taken" />
        </BarChart>
      </Card>
    </Screen>
  );
}

export function AreaDemo() {
  return (
    <Screen width={400} height={240} theme="macos">
      <Card x={6} y={6} width={388} height={228}>
        <CardHeader x={16} y={10} width={356} height={56}>
          <CardTitle width={356} value="Consommation" />
          <CardDescription
            width={356}
            value="Une vue claire, sur votre appareil"
          />
        </CardHeader>
        <AreaChart
          x={14}
          y={78}
          width={360}
          height={136}
          data={history}
          xKey="day"
        >
          <Area dataKey="taken" name="Cette semaine" />
          <Line dataKey="returned" name="Précédente" stroke="dashed" />
        </AreaChart>
      </Card>
    </Screen>
  );
}
