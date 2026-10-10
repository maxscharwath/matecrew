/** @jsxImportSource @matecrew/device-ui */
import { Screen, Surface, MateCrewMark, H1, Lead, Label, Progress, bind } from "@matecrew/device-ui";

/** The host advances a few meaningful boot stages; no continuous display refresh. */
export default function BootScreen() {
  return (
    <Screen theme="paper" align="center" justify="center" gap={20}>
      {/* The mark on its brand tile, as the site shows it; ink turns the mark to paper. */}
      <Surface variant="ink" radius={32} width={120} height={120} align="center" justify="center">
        <MateCrewMark size={92} />
      </Surface>
      <H1 align="center">{bind("boot.title", "matécrew")}</H1>
      <Lead align="center">{bind("boot.stage", "")}</Lead>
      <Progress value={bind("boot.progress", 0)} width={320} height={16} />
      <Label align="center">{bind("boot.step", "01 / 04")}</Label>
    </Screen>
  );
}
