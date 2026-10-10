/** @jsxImportSource @matecrew/device-ui */
import { HStack, VStack, Spacer, Label, H2, Num, Media, Progress, Alert, AlertDescription } from "@matecrew/device-ui";
import { DownloadIcon, PlugZapIcon } from "@matecrew/device-ui/icons/lucide";
import { concat } from "@matecrew/device-ui";
import { Frame, useT, view } from "./shared";

/** A firmware update: what is installing, how far, and the one thing not to do. */
export function update() {
  const t = useT();
  return (
    <Frame title={t("update.title")} gap={28}>
      <HStack gap={28}>
        <Media size={112}><DownloadIcon size={56} strokeWidth={3} /></Media>
        <VStack gap={8} width="fill">
          <Label>{t("update.installing")}</Label>
          <H2>{t("update.heading", { version: view("version") })}</H2>
        </VStack>
        <Num size="md">{concat(view("percent", 0), " %")}</Num>
      </HStack>
      <Progress value={view("percent", 0)} height={32} />
      <Spacer />
      <Alert>
        <PlugZapIcon size={24} />
        <AlertDescription>{t("update.keep")}</AlertDescription>
      </Alert>
    </Frame>
  );
}
