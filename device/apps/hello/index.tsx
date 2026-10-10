/** @jsxImportSource @matecrew/device-ui */
import {
  Screen,
  StatusBar,
  Main,
  Keys,
  Key,
  VStack,
  Stat,
  StatLabel,
  StatValue,
  H3,
  Spark,
  Alert,
  AlertDescription,
  useDeviceData,
  useDeviceState,
} from "@matecrew/device-ui";
import { InfoIcon } from "@matecrew/device-ui/icons/lucide";

/** This app compiles to data. API hooks and local state run in Rust on the device. */
export default function App() {
  const api = useDeviceData("stock", "/api/device/state", {
    refreshMs: 120_000,
    onWake: true,
  });
  const [notice, setNotice] = useDeviceState("notice", "Pose ton badge");
  return (
    <Screen>
      <StatusBar>{api("office.name", "matécrew")}</StatusBar>
      <Main direction="row" gap={32}>
        <VStack gap={8} width="fill">
          <Stat>
            <StatLabel>En stock</StatLabel>
            <StatValue size="2xl">{api("items.0.stock", 0)}</StatValue>
          </Stat>
          <H3>{api("items.0.name", "Stock")}</H3>
        </VStack>
        <VStack gap={16} width="fill">
          <Spark value={api("screen.chart.series.0", [])} max={api("screen.chart.max", 1)} height={120} />
          <Alert>
            <InfoIcon size={24} />
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        </VStack>
      </Main>
      {/* The keys under the panel, also tappable from the console. */}
      <Keys>
        <Key side="left" primary onPress={{ kind: "emit", name: "take" }}>Prendre</Key>
        <Key side="right" onPress={setNotice("Choisis, puis badge")}>Aide</Key>
      </Keys>
    </Screen>
  );
}
