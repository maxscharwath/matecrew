/** @jsxImportSource @matecrew/device-ui */
import {
  Screen,
  HStack,
  VStack,
  OwtLogo,
  H1,
  Lead,
  Label,
  Small,
  Progress,
  Show,
  Switch,
  Case,
  bind,
  eq,
  useI18n,
  type TextChildren,
} from "@matecrew/device-ui";
import {
  CircleCheckIcon,
  CircleXIcon,
  LoaderCircleIcon,
} from "@matecrew/device-ui/icons/lucide";
import { messages } from "./messages";

/** Log lines the host sends: the latest ones (`ui::boot::BootLog`). */
const LINES = 5;

/** One line of the log: what the terminal does, and how it went, in the office's language. */
function Line({ index }: { index: number }) {
  const t = useI18n(messages);
  const at = (field: string) => bind(`boot.lines.${index}.${field}`, "");
  const param = (name: string) =>
    bind(`boot.lines.${index}.params.${name}`, "");
  const text = (line: TextChildren) => (
    <Small lines={1} width="fill">
      {line}
    </Small>
  );
  return (
    <Show when={at("key")}>
      <HStack gap={12} align="center" width="fill">
        <Show when={eq(at("state"), "done")}>
          <CircleCheckIcon size={22} />
        </Show>
        <Show when={eq(at("state"), "run")}>
          <LoaderCircleIcon size={22} />
        </Show>
        <Show when={eq(at("state"), "fail")}>
          <CircleXIcon size={22} />
        </Show>
        {/* A Switch is a group, not a box: the column gives its text the row's width. */}
        <VStack width="fill">
          <Switch value={at("key")}>
            <Case is="screen">{text(t("boot.screen"))}</Case>
            <Case is="screenReady">{text(t("boot.screenReady"))}</Case>
            <Case is="reader">{text(t("boot.reader"))}</Case>
            <Case is="readerReady">
              {text(t("boot.readerReady", { version: param("version") }))}
            </Case>
            <Case is="readerMissing">{text(t("boot.readerMissing"))}</Case>
            <Case is="wifiJoining">
              {text(t("boot.wifiJoining", { ssid: param("ssid") }))}
            </Case>
            <Case is="wifiJoined">
              {text(
                t("boot.wifiJoined", {
                  ssid: param("ssid"),
                  rssi: param("rssi"),
                }),
              )}
            </Case>
            <Case is="wifiJoinedQuiet">
              {text(t("boot.wifiJoinedQuiet", { ssid: param("ssid") }))}
            </Case>
            <Case is="wifiOffline">{text(t("boot.wifiOffline"))}</Case>
            <Case is="site">{text(t("boot.site"))}</Case>
            <Case is="siteReady">
              {text(t("boot.siteReady", { host: param("host") }))}
            </Case>
            <Case is="apps">{text(t("boot.apps"))}</Case>
            <Case is="appsLoaded">{text(t("boot.appsLoaded"))}</Case>
            <Case is="mateLoaded">{text(t("boot.mateLoaded"))}</Case>
            <Case is="ready">{text(t("boot.ready"))}</Case>
            <Case is="allReady">{text(t("boot.allReady"))}</Case>
          </Switch>
        </VStack>
      </HStack>
    </Show>
  );
}

/** The terminal's start, live: matécrew by OWT, then what the system does, step by step. */
export default function BootScreen() {
  return (
    <Screen theme="paper" align="center" justify="center" gap={16}>
      {/* matécrew by OWT: whose terminal it is, with OWT's logo as owt.swiss shows it. */}
      <H1 align="center">{bind("boot.title", "matécrew")}</H1>
      <HStack gap={14} align="center">
        <Lead>by</Lead>
        <OwtLogo height={48} />
      </HStack>
      <Progress value={bind("boot.progress", 0)} width={440} height={12} />
      <VStack gap={8} width={440}>
        {Array.from({ length: LINES }, (_, index) => (
          <Line index={index} />
        ))}
      </VStack>
      <Label align="center">{bind("boot.step", "")}</Label>
    </Screen>
  );
}
