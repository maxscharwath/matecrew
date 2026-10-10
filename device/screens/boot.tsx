/** @jsxImportSource ../authoring */
import { Screen, Card, Text, Progress, bind } from "../authoring";
import { ComputersDevicesElectronicsVintageMacIcon } from "../authoring/icons/streamline-pixel";

/** The host advances a few meaningful boot stages; no continuous display refresh. */
export default function BootScreen() {
  return (
    <Screen width={400} height={240} theme="flipper">
      <Card
        x={171}
        y={41}
        width={58}
        height={58}
        radius={6}
        borderWidth={1}
        background="paper"
        shadow={{ x: 2, y: 2, opacity: 35 }}
      />
      <ComputersDevicesElectronicsVintageMacIcon x={179} y={49} size={42} />
      <Text
        x={32}
        y={115}
        width={336}
        height={28}
        fontSize={18}
        fontWeight="bold"
        fontFamily="pixel"
        align="center"
        value={bind("boot.title", "Device OS")}
      />
      <Text
        x={52}
        y={151}
        width={296}
        height={20}
        fontSize={12}
        fontFamily="pixel"
        align="center"
        value={bind("boot.stage", "Préparation de votre espace")}
      />
      <Progress
        x={96}
        y={183}
        width={208}
        height={6}
        value={bind("boot.progress", 0)}
      />
      <Text
        x={96}
        y={199}
        width={208}
        height={14}
        font="caption"
        align="center"
        value={bind("boot.step", "01 / 04")}
      />
    </Screen>
  );
}
