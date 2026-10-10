/** @jsxImportSource @matecrew/device-ui */
import {
  HStack,
  VStack,
  Spacer,
  Show,
  Switch,
  Case,
  Default,
  Card,
  Button,
  Badge,
  Label,
  Lead,
  H2,
  H3,
  Muted,
  Num,
  Stat,
  StatLabel,
  StatValue,
  Media,
  BadgeInput,
  add,
  sub,
  max,
  gt,
  fmt,
  useBuzzer,
  useDeviceData,
  useDeviceInfo,
  useDeviceState,
  useDialog,
  useLocale,
  useToast,
  type Action,
  type ThemeName,
} from "@matecrew/device-ui";
import {
  BellIcon,
  CircleCheckIcon,
  MessageSquareIcon,
  MinusIcon,
  MoonIcon,
  MousePointerClickIcon,
  NfcIcon,
  PlusIcon,
  SunIcon,
  TriangleAlertIcon,
} from "@matecrew/device-ui/icons/lucide";
import { Page, useT } from "./shared";

/**
 * Logic on the device: state updated from itself, text built from data, plurals and the
 * language chosen at runtime, branches by value.
 */
export function Logic() {
  const t = useT();
  const [count, setCount] = useDeviceState("count", 1);
  const [locale, setLocale] = useLocale();
  const data = useDeviceData("showcase", "/api/device/state", { refreshMs: 120000, onWake: true });
  return (
    <Page name="logic" direction="row" gap={20}>
      <Card width="fill" height="fill">
        <Label>{t("taken", { count })}</Label>
        <HStack gap={16}>
          <Button variant="outline" onPress={setCount(max(sub(count, 1), 0))}><MinusIcon size={20} /></Button>
          <Num size="xl" align="center" width="fill">{count}</Num>
          <Button onPress={setCount(add(count, 1))}><PlusIcon size={20} /></Button>
        </HStack>
        <Switch value={count}>
          <Case is={0}><Badge variant="outline">Rien pris</Badge></Case>
          <Case is={1}><Badge variant="secondary">Un seul</Badge></Case>
          <Default><Badge><TriangleAlertIcon size={18} /> Beaucoup</Badge></Default>
        </Switch>
        <Spacer />
        <Show when={gt(count, 3)} fallback={<Muted>Encore raisonnable.</Muted>}>
          <Lead>{fmt`${count} matés : pense à boire de l'eau.`}</Lead>
        </Show>
      </Card>
      <Card width="fill" height="fill">
        <Label>{t("language")}</Label>
        <H3>{t("hello", { name: data("office.name", "Lausanne") })}</H3>
        <HStack gap={12}>
          <Button variant="outline" onPress={setLocale("fr")}>Français</Button>
          <Button variant="outline" onPress={setLocale("en")}>English</Button>
        </HStack>
        <Spacer />
        <Muted>{fmt`Choix : ${locale} (vide = langue du bureau)`}</Muted>
      </Card>
    </Page>
  );
}

/** Polarity is a theme: paper, or the same screens in ink. */
export function Themes({ change }: { change: (name: ThemeName) => Action }) {
  return (
    <Page name="themes" direction="row" gap={28}>
      <VStack gap={16} width="fill">
        <H2>Clair ou sombre, le même écran.</H2>
        <Lead>Le thème inverse l'encre et le papier ; les QR restent noirs sur blanc pour les téléphones.</Lead>
      </VStack>
      <VStack gap={14} width={272}>
        <Button variant="outline" width="fill" size="lg" onPress={change("paper")}><SunIcon /> Papier</Button>
        <Button width="fill" size="lg" onPress={change("dark")}><MoonIcon /> Encre</Button>
        <Card variant="tint" padding={20} gap={6}>
          <Label>Trames</Label>
          <Muted>Gris à 12, 25 et 50 % par tramage ordonné</Muted>
        </Card>
      </VStack>
    </Page>
  );
}

/** The board: piezo tones, notifications, a dialog on the keys, and the badge reader. */
export function Hardware() {
  const buzzer = useBuzzer();
  const toast = useToast();
  const dialog = useDialog();
  const info = useDeviceInfo();
  return (
    <Page name="hardware" gap={16}>
      <HStack gap={24}>
        <VStack gap={4} width="fill">
          <Label>Carte</Label>
          <H3 lines={1}>{info("board.name", "Ton appareil")}</H3>
        </VStack>
        <Stat>
          <StatLabel>Signal dBm</StatLabel>
          <StatValue size="sm">{info("wifi.rssi", "--")}</StatValue>
        </Stat>
        <Stat>
          <StatLabel>Piezo GPIO</StatLabel>
          <StatValue size="sm">{info("pins.buzzer", "--")}</StatValue>
        </Stat>
      </HStack>
      <HStack gap={12} width="fill">
        <Button variant="outline" width="fill" onPress={buzzer.beep("key")}><MousePointerClickIcon size={20} /> Clic</Button>
        <Button variant="outline" width="fill" onPress={buzzer.beep("success")}><CircleCheckIcon size={20} /> Succès</Button>
        <Button variant="outline" width="fill" onPress={buzzer.beep("error")}><TriangleAlertIcon size={20} /> Erreur</Button>
      </HStack>
      <HStack gap={12} width="fill" align="stretch">
        <Button variant="secondary" width="fill" onPress={toast.show("Ton appareil est à jour.")}><BellIcon size={20} /> Notification</Button>
        <Button
          variant="secondary"
          width="fill"
          onPress={dialog.confirm({
            title: "Jouer un son ?",
            message: "Le buzzer jouera le motif de confirmation.",
            confirmLabel: "Jouer",
            onConfirm: buzzer.beep("success"),
          })}
        >
          <MessageSquareIcon size={20} /> Dialogue
        </Button>
        <Card variant="sunken" width="fill" direction="row" gap={12} padding={[8, 14]} align="center">
          <Media size={36} variant="outline"><NfcIcon size={20} /></Media>
          <Muted lines={1} width="fill">{info("nfc.uid", "Pose un badge")}</Muted>
        </Card>
      </HStack>
      <BadgeInput onPress={[toast.show("Badge lu : bienvenue !"), buzzer.beep("badge")]} />
    </Page>
  );
}
