/** @jsxImportSource ../authoring */
import {
  Screen,
  Card,
  Column,
  Text,
  Chart,
  Button,
  useDeviceData,
  useDeviceState,
} from "../authoring/jsx-runtime";

/** This app compiles to data. API hooks and local state run in Rust on the device. */
export default function App() {
  const api = useDeviceData("stock", "/api/device/state", {
    refreshMs: 120_000,
    onWake: true,
  });
  const [notice, setNotice] = useDeviceState("notice", "Pose ton badge");
  return (
    <Screen width={400} height={240}>
      <Text
        x={8}
        y={0}
        width={384}
        height={32}
        font="title"
        value={api("office.name", "matécrew")}
      />
      <Card x={8} y={40} width={384} height={106}>
        <Column x={12} y={8} width={360} height={90} gap={4}>
          <Text
            width={360}
            height={36}
            font="title"
            value={api("items.0.name", "Stock")}
          />
          <Text
            width={360}
            height={44}
            font="display"
            value={api("items.0.stock", 0)}
          />
        </Column>
      </Card>
      <Chart
        x={16}
        y={156}
        width={224}
        height={44}
        value={api("screen.chart.series.0", [])}
        max={api("screen.chart.max", 1)}
      />
      <Text
        x={250}
        y={156}
        width={142}
        height={44}
        font="caption"
        maxLines={2}
        value={notice}
      />
      <Button
        x={8}
        y={208}
        width={168}
        height={32}
        label="Prendre"
        onPress={{ kind: "emit", name: "take" }}
      />
      <Button
        x={224}
        y={208}
        width={168}
        height={32}
        label="Aide"
        onPress={setNotice("Choisis, puis badge")}
      />
    </Screen>
  );
}
