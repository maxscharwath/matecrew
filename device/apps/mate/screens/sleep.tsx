/** @jsxImportSource @matecrew/device-ui */
import { Label, Muted, Num, VStack, cond, eq } from "@matecrew/device-ui";
import { MoonIcon } from "@matecrew/device-ui/icons/lucide";
import { NightSky } from "../art";
import { Frame, useT, view } from "./shared";

/**
 * Outside the office's hours the terminal sleeps and the panel keeps this: the night sky, and
 * when it wakes, the time large. `view.title`: night or weekend; `view.day` and `view.time`: when
 * it wakes, the day empty for the next morning, else named in the office's language. No clock in
 * the status bar: it would stay at the time it fell asleep. A key wakes it.
 */
export function sleep() {
  const t = useT();
  return (
    <Frame title={t("sleep.title", { context: view("title") })} trailing={<MoonIcon size={24} />} direction="row" align="center" gap={40}>
      <NightSky width={360} height={300} />
      <VStack gap={8} width="fill">
        <Label>{cond(eq(view("day"), ""), t("sleep.wake"), t("sleep.wakeDay", { day: view("day") }))}</Label>
        <Num size="2xl">{view("time")}</Num>
        <Muted>{t("sleep.hint")}</Muted>
      </VStack>
    </Frame>
  );
}
