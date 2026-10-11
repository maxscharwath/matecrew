/** @jsxImportSource @matecrew/device-ui */
import { H1, Lead, cond, eq } from "@matecrew/device-ui";
import { MoonIcon } from "@matecrew/device-ui/icons/lucide";
import { Sleeper } from "../art";
import { Frame, useT, view } from "./shared";

/**
 * Outside the office's hours the terminal sleeps and the panel keeps this. `view.title`: night
 * or weekend; `view.day` and `view.time`: when it wakes, the day empty for the next morning, else
 * named in the office's language. No clock in the status bar: it would stay at the time it fell
 * asleep. A key wakes it.
 */
export function sleep() {
  const t = useT();
  const time = view("time");
  return (
    <Frame title={t("sleep.title", { context: view("title") })} trailing={<MoonIcon size={24} />} align="center" justify="center" gap={8}>
      <Sleeper width={288} height={180} />
      <H1 align="center">{cond(eq(view("day"), ""), t("sleep.wake", { time }), t("sleep.wakeDay", { day: view("day"), time }))}</H1>
      <Lead align="center">{t("sleep.hint")}</Lead>
    </Frame>
  );
}
