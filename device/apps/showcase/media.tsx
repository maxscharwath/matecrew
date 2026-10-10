/** @jsxImportSource ../../authoring */
import {
  WifiIcon,
  CreditCardIcon,
  CheckIcon,
  SlidersIcon,
  ChartIcon,
  BatteryIcon,
  AlertIcon,
  ArrowRightIcon,
} from "../../authoring/icons/pixelarticons";
import {
  ShoppingShippingBoxIcon,
  FoodDrinkCoffeeIcon,
} from "../../authoring/icons/streamline-pixel";
import { Card, Image, Qr, Text, type IconComponent } from "../../authoring";
import { Page } from "./shared";
const names: IconComponent[] = [
  WifiIcon,
  CreditCardIcon,
  ShoppingShippingBoxIcon,
  CheckIcon,
  FoodDrinkCoffeeIcon,
  SlidersIcon,
  ChartIcon,
  BatteryIcon,
  AlertIcon,
  ArrowRightIcon,
];
const labels = [
  "Wi-Fi",
  "Badge",
  "Stock",
  "OK",
  "Pause",
  "Régl.",
  "Conso",
  "Pile",
  "Alerte",
  "Suite",
];
export function Icons() {
  return (
    <Page name="icons" title="Icônes pixel">
      {names.map((Artwork, index) => (
        <Card
          x={2 * (4 + (index % 5) * 39)}
          y={2 * (20 + Math.floor(index / 5) * 40)}
          width={72}
          height={74}
        >
          <Artwork x={20} y={12} size={32} />
          <Text
            x={4}
            y={50}
            width={64}
            height={24}
            align="center"
            font="caption"
            value={labels[index]}
          />
        </Card>
      ))}
    </Page>
  );
}
export function Media() {
  return (
    <Page name="media" title="Images & QR">
      <Card x={8} y={40} width={232} height={156}>
        <Image
          src="/device/streamline-coffee.png"
          x={8}
          y={8}
          width={216}
          height={106}
          fit="contain"
        />
        <Text
          x={12}
          y={120}
          width={208}
          height={24}
          font="caption"
          value="PNG décodé ici"
        />
      </Card>
      <Qr
        x={256}
        y={42}
        width={136}
        height={136}
        value="https://matecrew.vercel.app"
      />
      <Text
        x={260}
        y={176}
        width={128}
        height={24}
        font="caption"
        align="center"
        value="Scannez-moi"
      />
    </Page>
  );
}
