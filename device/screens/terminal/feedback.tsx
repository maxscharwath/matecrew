/** @jsxImportSource ../../authoring */
import { Screen, Card, Text } from "../../authoring/jsx-runtime";
import {
  FoodDrinkCoffeeIcon,
  InternetNetworkWifiMonitorIcon,
} from "../../authoring/icons/streamline-pixel";
import {
  CellularSignalOffIcon,
  CreditCardWirelessIcon,
} from "../../authoring/icons/pixelarticons";
import { FeedbackCard, type IconComponent } from "../../authoring/kit";
import { Chrome, Footer, Keys, data } from "./shared";
function Message(icon: IconComponent = FoodDrinkCoffeeIcon) {
  return (
    <Screen width={400} height={240}>
      <Chrome />
      <FeedbackCard
        icon={icon}
        title={data("heading")}
        detail={data("detail")}
      />
      <Footer />
    </Screen>
  );
}
export const linked = () => Message();
export const connecting = () => Message(InternetNetworkWifiMonitorIcon);
export const connected = () => Message();
export const error = () => Message(CellularSignalOffIcon);
export const test = () => Message();
export const badge = () => (
  <Screen width={400} height={240}>
    <Chrome icon={CreditCardWirelessIcon} />
    <FeedbackCard
      icon={CreditCardWirelessIcon}
      title="Pose ton badge"
      detail="Sur le lecteur, au centre"
    />
    <Keys />
  </Screen>
);
export const leave = () => (
  <Screen width={400} height={240}>
    <Chrome />
    <Card x={8} y={40} width={384} height={160}>
      <Text
        x={24}
        y={24}
        width={336}
        height={48}
        font="title"
        value="Rien pour moi"
      />
      <Text
        x={24}
        y={86}
        width={336}
        height={64}
        maxLines={2}
        value="Revenir au stock, ou parcourir les articles"
      />
    </Card>
    <Keys />
  </Screen>
);
