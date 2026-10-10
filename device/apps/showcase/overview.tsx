/** @jsxImportSource ../../authoring */
import {
  Card,
  MenuItem,
  Text,
  Button,
  Progress,
  useRouter,
} from "../../authoring";
import { ComputersDevicesElectronicsVintageMacIcon } from "../../authoring/icons/streamline-pixel";
import {
  DeviceLaptopIcon,
  ChartIcon,
  ImageIcon,
  SlidersIcon,
  DatabaseIcon,
  CpuIcon,
} from "../../authoring/icons/system";
import { Page, type Page as PageName } from "./shared";

/** The studio opens as a compact workstation, with one illustration and one menu. */
export function Home() {
  const router = useRouter<PageName>();
  const tools = [
    ["Interface", "components", DeviceLaptopIcon],
    ["Graphiques", "charts", ChartIcon],
    ["Médias", "media", ImageIcon],
    ["Apparence", "themes", SlidersIcon],
    ["Données", "state", DatabaseIcon],
  ] as const;
  return (
    <Page name="home" title="Device Studio">
      <Card
        x={72} y={44} width={60} height={60}
        radius={6} borderWidth={1} background="paper"
        shadow={{ x: 2, y: 2, opacity: 35 }}
      />
      <ComputersDevicesElectronicsVintageMacIcon x={81} y={54} size={42} />
      <Text
        x={16}
        y={112}
        width={172}
        height={22}
        font="title"
        align="center"
        value="À vous"
      />
      <Text
        x={16}
        y={135}
        width={172}
        height={22}
        font="title"
        align="center"
        value="de jouer."
      />
      <Text
        x={16}
        y={165}
        width={172}
        height={14}
        font="caption"
        align="center"
        value="Explorez les outils."
      />
      <Button
        x={16}
        y={186}
        width={172}
        height={24}
        label="Appareil"
        icon={CpuIcon}
        onPress={router.push("hardware")}
      />
      <Card
        x={201} y={38} width={1} height={164}
        radius={0} borderWidth={0} background="ink" opacity={50}
      />
      <Card
        x={211} y={53} width={181} height={155}
        radius={6} borderWidth={0} background="paper"
        shadow={{ x: 2, y: 2, opacity: 35 }}
      />
      <Text
        x={220}
        y={38}
        width={164}
        height={14}
        font="caption"
        value="EXPLORER"
      />
      {tools.map(([label, route, icon], index) => (
        <MenuItem
          x={220}
          y={58 + index * 30}
          width={164}
          label={label}
          icon={icon}
          onPress={router.push(route)}
        />
      ))}
    </Page>
  );
}

export function Components() {
  return (
    <Page name="components" title="Interface">
      <Text
        x={16}
        y={39}
        width={368}
        height={16}
        font="caption"
        value="Composants essentiels"
      />
      <Card
        x={16} y={62} width={368} height={86}
        radius={6} borderWidth={1} background="paper"
        shadow={{ x: 2, y: 2, opacity: 35 }}
      >
        <Text
          x={14}
          y={14}
          width={224}
          height={18}
          font="title"
          fontSize={14}
          fontWeight="bold"
          value="Objectif quotidien"
        />
        <Text
          x={14}
          y={37}
          width={224}
          height={16}
          font="caption"
          fontSize={8}
          fontFamily="sans"
          fontStyle="italic"
          value="Encore un petit effort."
        />
        <Text
          x={246}
          y={15}
          width={108}
          height={34}
          font="display"
          align="right"
          value="75 %"
        />
        <Progress x={14} y={65} width={340} height={7} value={75} />
      </Card>
      <Card
        x={16} y={160} width={176} height={42}
        radius={4} borderWidth={1} borderStyle="dotted" background="transparent"
      >
        <Text
          x={12}
          y={6}
          width={152}
          height={18}
          font="body"
          value="Connecté"
        />
        <Text
          x={12}
          y={25}
          width={152}
          height={14}
          font="caption"
          value="Synchronisation à jour"
        />
      </Card>
      <Card
        x={208} y={160} width={176} height={42}
        radius={4} borderWidth={1} borderStyle="dashed" background="transparent"
      >
        <Text x={12} y={6} width={152} height={18} font="body" value="macOS" />
        <Text
          x={12}
          y={25}
          width={152}
          height={14}
          font="caption"
          value="Thème clair"
        />
      </Card>
    </Page>
  );
}
