/** @jsxImportSource ../../authoring */
import { Screen, Card, Text, Qr } from "../../authoring/jsx-runtime";
import type { IconComponent } from "../../authoring";
import {
  WifiIcon,
  SlidersIcon,
  CreditCardWirelessIcon,
} from "../../authoring/icons/pixelarticons";
import { Chrome, Footer, data } from "./shared";
function QrScreen(icon: IconComponent) {
  return (
    <Screen width={400} height={240}>
      <Chrome icon={icon} />
      <Card x={6} y={38} width={172} height={172}>
        <Qr width={172} height={172} value={data("qr")} />
      </Card>
      <Card x={188} y={38} width={206} height={36} inverted>
        <Text
          x={8}
          y={4}
          width={190}
          height={30}
          font="caption"
          inverted
          value={data("heading")}
        />
      </Card>
      <Text
        x={192}
        y={80}
        width={200}
        height={84}
        maxLines={3}
        value={data("detail")}
      />
      <Text
        x={192}
        y={166}
        width={200}
        height={44}
        font="caption"
        maxLines={2}
        value={data("extra")}
      />
      <Footer />
    </Screen>
  );
}
export const setup = () => QrScreen(WifiIcon);
export const link = () => QrScreen(SlidersIcon);
export const claim = () => QrScreen(CreditCardWirelessIcon);
