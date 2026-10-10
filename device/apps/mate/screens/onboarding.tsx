/** @jsxImportSource @matecrew/device-ui */
/**
 * First start, in three steps: join the setup Wi-Fi from a phone, link the terminal to the
 * site, ready. The status bar carries the steps; each screen has one QR or one state, and the
 * words to act on it.
 */
import {
  HStack,
  VStack,
  Spacer,
  QrCode,
  Steps,
  Surface,
  Label,
  H2,
  Lead,
  Num,
  Muted,
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  Alert,
  AlertDescription,
  type Children,
} from "@matecrew/device-ui";
import { CircleCheckBigIcon, IdCardIcon, InfoIcon, TriangleAlertIcon, WifiIcon } from "@matecrew/device-ui/icons/lucide";
import { Facts, Frame, Instruction, useT, view } from "./shared";

function Onboarding({ step, children }: { step: number; children?: Children }) {
  const t = useT();
  return (
    <Frame title={t("setup.title")} trailing={<Steps steps={[t("steps.wifi"), t("steps.site"), t("steps.ready")]} current={step} />}>
      {children}
    </Frame>
  );
}

/** Step 1: the phone joins the terminal's own Wi-Fi and opens its settings page. */
export function setup() {
  const t = useT();
  return (
    <Onboarding step={0}>
      <HStack gap={32} align="start" height="fill">
        <QrCode value={view("qr")} size={280}>{t("setup.noCamera", { url: view("portal") })}</QrCode>
        <VStack gap={14} width="fill" height="fill">
          <Label>{t("setup.step")}</Label>
          <H2>{t("setup.heading")}</H2>
          <VStack gap={10}>
            <Instruction n={1}>{t("setup.scan")}</Instruction>
            <Instruction n={2}>{t("setup.open")}</Instruction>
            <Instruction n={3}>{t("setup.choose")}</Instruction>
          </VStack>
          <Spacer />
          <Facts rows={[[t("setup.network"), view("ssid")], [t("setup.key"), view("password")]]} />
        </VStack>
      </HStack>
    </Onboarding>
  );
}

/** Between steps 1 and 2: the terminal joins the office network. */
export function connecting() {
  const t = useT();
  return (
    <Onboarding step={0}>
      <Empty>
        <EmptyMedia variant="outline" size={128}><WifiIcon size={64} strokeWidth={4} /></EmptyMedia>
        <EmptyTitle>{t("connecting.heading")}</EmptyTitle>
        <Lead align="center">{view("ssid")}</Lead>
        <Muted align="center">{t("connecting.wait")}</Muted>
      </Empty>
    </Onboarding>
  );
}

/** Step 1 done: on the network, about to reach the site. */
export function connected() {
  const t = useT();
  return (
    <Onboarding step={1}>
      <Empty>
        <EmptyMedia variant="ink" size={128}><WifiIcon size={64} strokeWidth={4} /></EmptyMedia>
        <EmptyTitle>{t("connected.heading")}</EmptyTitle>
        <VStack width={432}>
          <Facts rows={[[t("setup.network"), view("ssid")], [t("connected.address"), view("ip")]]} />
        </VStack>
        <Muted align="center">{t("connected.next")}</Muted>
      </Empty>
    </Onboarding>
  );
}

/** Step 2: an admin approves this terminal's code on the site, by QR or by hand. */
export function link() {
  const t = useT();
  return (
    <Onboarding step={1}>
      <HStack gap={32} align="start" height="fill">
        <QrCode value={view("qr")} size={280}>{t("link.scan")}</QrCode>
        <VStack gap={14} width="fill" height="fill">
          <Label>{t("link.step")}</Label>
          <H2>{t("link.heading")}</H2>
          <Lead>{t("link.admin", { url: view("url") })}</Lead>
          <Spacer />
          <Surface variant="ink" radius={16} padding={[20, 0]} align="center" width="fill">
            <Num size="md" align="center">{view("code")}</Num>
          </Surface>
        </VStack>
      </HStack>
    </Onboarding>
  );
}

/** Step 3: linked to an office; the next touch starts the first take. */
export function linked() {
  const t = useT();
  return (
    <Onboarding step={3}>
      <Empty>
        <EmptyMedia variant="ink" size={128}><CircleCheckBigIcon size={64} strokeWidth={4} /></EmptyMedia>
        <EmptyTitle>{t("linked.heading")}</EmptyTitle>
        <VStack width={432}>
          <Facts rows={[[t("linked.office"), view("office")], [t("linked.terminal"), view("name")]]} />
        </VStack>
        <EmptyDescription>{t("linked.next")}</EmptyDescription>
      </Empty>
    </Onboarding>
  );
}

/** Anything that needs a person: what happened, then where to fix it (texts from the host). */
export function error() {
  return (
    <Frame title={view("title")} gap={24}>
      <Alert variant="ghost">
        <TriangleAlertIcon size={64} strokeWidth={4} />
        <H2>{view("heading")}</H2>
        <Lead>{view("detail")}</Lead>
      </Alert>
      <Spacer />
      <Alert>
        <InfoIcon size={24} />
        <AlertDescription>{view("footer")}</AlertDescription>
      </Alert>
    </Frame>
  );
}

/** A badge nobody owns yet: scan to claim it, then badge again. */
export function claim() {
  const t = useT();
  return (
    <Frame title={t("claim.title")}>
      <HStack gap={32} align="start" height="fill">
        <QrCode value={view("qr")} size={296} logo={null} />
        <VStack gap={14} width="fill" height="fill">
          <Label>{t("claim.label")}</Label>
          <H2>{t("claim.heading")}</H2>
          <VStack gap={10}>
            <Instruction n={1}>{t("claim.scan")}</Instruction>
            <Instruction n={2}>{t("claim.login")}</Instruction>
            <Instruction n={3}>{t("claim.again")}</Instruction>
          </VStack>
          <Spacer />
          <Surface variant="sunken" direction="row" align="center" gap={14} padding={[14, 20]} width="fill">
            <IdCardIcon size={24} />
            <Lead lines={1} width="fill">{view("uid")}</Lead>
          </Surface>
        </VStack>
      </HStack>
    </Frame>
  );
}
