/** @jsxImportSource @matecrew/device-ui */
import { Screen, OverlayHost, Overlay, Surface, VStack, HStack, When, H3, Lead, Num, bind, useI18n } from "@matecrew/device-ui";
import { BluetoothIcon } from "@matecrew/device-ui/icons/lucide";
import { messages } from "./messages";

/**
 * Composited by the host over any built-in screen: the toast, and the code a computer asks for
 * while it pairs over Bluetooth (`pairing`, from `ui::notifications::pairing`).
 */
export default function SystemLayer() {
  const t = useI18n(messages);
  return (
    <Screen width={800} height={480}>
      <OverlayHost />
      <Overlay>
        <When width="fill" height="fill" value={bind("pairing.first", "")}>
          <VStack width="fill" height="fill" align="center" justify="center">
            <Surface variant="outline" radius={24} width={520} gap={16} padding={40} align="center">
              <BluetoothIcon size={40} />
              <H3 align="center">{t("pairing.title")}</H3>
              <HStack gap={24} align="center">
                <Num size="lg">{bind("pairing.first", "")}</Num>
                <Num size="lg">{bind("pairing.last", "")}</Num>
              </HStack>
              <Lead align="center" lines={2} width="fill">{t("pairing.hint")}</Lead>
            </Surface>
          </VStack>
        </When>
      </Overlay>
    </Screen>
  );
}
