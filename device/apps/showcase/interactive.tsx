/** @jsxImportSource ../../authoring */
import {
  Button,
  Card,
  Text,
  Progress,
  useDeviceState,
  useDeviceData,
  useBuzzer,
  useDeviceInfo,
  useToast,
  useDialog,
  type Action,
} from "../../authoring";
import { Page } from "./shared";
export function Themes({
  change,
}: {
  change: (name: "flipper" | "macos" | "dark") => Action;
}) {
  return (
    <Page name="themes" title="Votre style">
      <Card x={8} y={40} width={384} height={90}>
        <Text
          x={14}
          y={10}
          width={356}
          height={32}
          font="title"
          value="À votre image."
        />
        <Text
          x={14}
          y={50}
          width={356}
          height={24}
          font="caption"
          value="Choisissez directement sur la console."
        />
      </Card>
      <Button
        x={8}
        y={150}
        width={120}
        height={40}
        label="Flipper"
        onPress={() => change("flipper")}
      />
      <Button
        x={140}
        y={150}
        width={120}
        height={40}
        label="macOS"
        onPress={() => change("macos")}
      />
      <Button
        x={272}
        y={150}
        width={120}
        height={40}
        label="Dark"
        onPress={() => change("dark")}
      />
    </Page>
  );
}
export function State() {
  const [progress, setProgress] = useDeviceState("showcaseProgress", 35);
  const data = useDeviceData("showcase", "/api/device/state", {
    refreshMs: 120000,
    onWake: true,
  });
  return (
    <Page name="state" title="État & données">
      <Card x={8} y={40} width={384} height={90}>
        <Text
          x={14}
          y={8}
          width={356}
          height={28}
          font="title"
          value={data("office.name", "Données hors ligne")}
        />
        <Progress x={14} y={52} width={356} height={20} value={progress} />
      </Card>
      <Button
        x={8}
        y={150}
        width={120}
        height={40}
        label="25 %"
        onPress={() => setProgress(25)}
      />
      <Button
        x={140}
        y={150}
        width={120}
        height={40}
        label="80 %"
        onPress={() => setProgress(80)}
      />
      <Button
        x={272}
        y={150}
        width={120}
        height={40}
        label="API"
        onPress={{ kind: "fetch", resource: "showcase" }}
      />
    </Page>
  );
}
export function Hardware() {
  const buzzer = useBuzzer();
  const toast = useToast();
  const dialog = useDialog();
  const info = useDeviceInfo();
  return (
    <Page name="hardware" title="Matériel & actions">
      <Text
        x={16}
        y={40}
        width={368}
        height={24}
        font="title"
        value={info("board.name", "Votre appareil")}
      />
      <Text
        x={16}
        y={66}
        width={368}
        height={18}
        font="caption"
        value="Entrées physiques et sons du système"
      />
      <Text
        x={16}
        y={94}
        width={110}
        height={18}
        font="caption"
        value="Piézo · GPIO"
      />
      <Text
        x={96}
        y={94}
        width={40}
        height={18}
        font="caption"
        value={info("pins.buzzer", "—")}
      />
      <Text
        x={224}
        y={94}
        width={70}
        height={18}
        font="caption"
        value="Wi-Fi · dBm"
      />
      <Text
        x={316}
        y={94}
        width={68}
        height={18}
        font="caption"
        align="right"
        value={info("wifi.rssi", "—")}
      />
      <Text
        x={16}
        y={120}
        width={368}
        height={16}
        font="caption"
        value="Tester un son"
      />
      <Button
        x={8}
        y={140}
        width={120}
        height={28}
        label="Clic"
        onPress={() => buzzer.beep("key")}
      />
      <Button
        x={140}
        y={140}
        width={120}
        height={28}
        label="Succès"
        onPress={() => buzzer.beep("success")}
      />
      <Button
        x={272}
        y={140}
        width={120}
        height={28}
        label="Erreur"
        onPress={() => buzzer.beep("error")}
      />
      <Button
        x={8}
        y={182}
        width={184}
        height={26}
        label="Notification"
        onPress={() => toast.show("Votre appareil est à jour.")}
      />
      <Button
        x={208}
        y={182}
        width={184}
        height={26}
        label="Dialogue"
        onPress={() =>
          dialog.confirm({
            title: "Jouer un son ?",
            message: "Le buzzer jouera le motif de confirmation.",
            confirmLabel: "Jouer",
            onConfirm: () => buzzer.beep("success"),
          })
        }
      />
    </Page>
  );
}
