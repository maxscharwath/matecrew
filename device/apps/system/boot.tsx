/** @jsxImportSource @matecrew/device-ui */
import { Screen, HStack, OwtLogo, H1, Lead, Label, Progress, bind } from "@matecrew/device-ui";

/** The host advances a few meaningful boot stages; no continuous display refresh. */
export default function BootScreen() {
  return (
    <Screen theme="paper" align="center" justify="center" gap={20}>
      {/* matécrew by OWT: whose terminal it is, with OWT's logo as owt.swiss shows it. */}
      <H1 align="center">{bind("boot.title", "matécrew")}</H1>
      <HStack gap={14} align="center">
        <Lead>by</Lead>
        <OwtLogo height={56} />
      </HStack>
      <Lead align="center">{bind("boot.stage", "")}</Lead>
      <Progress value={bind("boot.progress", 0)} width={320} height={16} />
      <Label align="center">{bind("boot.step", "01 / 04")}</Label>
    </Screen>
  );
}
