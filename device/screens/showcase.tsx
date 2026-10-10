/** @jsxImportSource ../authoring */
import {
  WifiIcon,
  CreditCardWirelessIcon,
  PackageIcon,
  CheckIcon,
  HeartIcon,
  SlidersIcon,
  ChartIcon,
  BatteryIcon,
  AlertIcon,
  ArrowRightIcon,
} from "../authoring/icons/pixelarticons";
import { Screen, Group, Text, Card } from "../authoring/jsx-runtime";
import { DeviceChrome } from "../authoring/kit";
import type { IconComponent } from "../authoring";
const symbols: { icon: IconComponent; label: string }[] = [
  { icon: WifiIcon, label: "Wi-Fi" },
  { icon: CreditCardWirelessIcon, label: "Badge" },
  { icon: PackageIcon, label: "Stock" },
  { icon: CheckIcon, label: "OK" },
  { icon: HeartIcon, label: "Pause" },
  { icon: SlidersIcon, label: "Régl." },
  { icon: ChartIcon, label: "Conso" },
  { icon: BatteryIcon, label: "Charge" },
  { icon: AlertIcon, label: "Alerte" },
  { icon: ArrowRightIcon, label: "Suite" },
];
export default function Showcase() {
  return (
    <Screen width={400} height={240}>
      <DeviceChrome title="Device UI Kit" status="1-bit" />
      <Group y={40} width={400} height={196}>
        {symbols.map((symbol, index) => (
          <Card
            x={2 * (4 + (index % 5) * 39)}
            y={2 * (Math.floor(index / 5) * 49)}
            width={72}
            height={90}
          >
            <symbol.icon x={12} y={8} width={48} height={48} />
            <Text
              x={4}
              y={62}
              width={64}
              height={24}
              font="caption"
              align="center"
              value={symbol.label}
            />
          </Card>
        ))}
      </Group>
    </Screen>
  );
}
