/** @jsxImportSource @matecrew/device-ui */
import { HStack, VStack, Surface, Media as Frame, QrCode, Image, Small, Muted, Label, type IconComponent } from "@matecrew/device-ui";
import {
  BatteryMediumIcon,
  BellIcon,
  CupSodaIcon,
  LeafIcon,
  NfcIcon,
  PackageIcon,
  RefreshCwIcon,
  SettingsIcon,
  TriangleAlertIcon,
  UserIcon,
  WifiIcon,
} from "@matecrew/device-ui/icons/lucide";
import { Page } from "./shared";

/** Lucide, the site's icon set, drawn at the size it is used with exact strokes. */
export function Icons() {
  const grid: [IconComponent, string][] = [
    [WifiIcon, "Wi-Fi"],
    [NfcIcon, "Badge"],
    [CupSodaIcon, "Maté"],
    [PackageIcon, "Stock"],
    [UserIcon, "Profil"],
    [BellIcon, "Alerte"],
    [RefreshCwIcon, "Synchro"],
    [SettingsIcon, "Réglages"],
    [BatteryMediumIcon, "Batterie"],
    [TriangleAlertIcon, "Attention"],
  ];
  const tile = ([Icon, label]: [IconComponent, string], ink: boolean) => (
    <Surface variant={ink ? "ink" : "hairline"} radius={14} width="fill" padding={[16, 0]} gap={10} align="center">
      <Icon size={32} />
      <Small align="center">{label}</Small>
    </Surface>
  );
  return (
    <Page name="icons" direction="row" gap={28}>
      <VStack gap={12} width="fill">
        <HStack gap={12} width="fill">{grid.slice(0, 5).map((icon, i) => tile(icon, i === 2))}</HStack>
        <HStack gap={12} width="fill">{grid.slice(5).map((icon) => tile(icon, false))}</HStack>
        <Muted lines={2}>1 703 icônes Lucide, vectorielles jusqu'à la compilation.</Muted>
      </VStack>
      <VStack gap={14} align="center">
        <Label>Tailles</Label>
        <LeafIcon size={24} />
        <LeafIcon size={48} strokeWidth={3} />
        <LeafIcon size={96} strokeWidth={4} />
      </VStack>
    </Page>
  );
}

/** Pictures: web PNGs decoded on the device, and QR codes in three styles. */
export function Media() {
  const url = "https://matecrew.vercel.app";
  return (
    <Page name="media" direction="row" gap={24} align="start">
      <VStack gap={12} align="center">
        <Frame size={200}>
          <Image width={144} height={144} src="/device/streamline-coffee.png" />
        </Frame>
        <Muted align="center">PNG du site</Muted>
      </VStack>
      <QrCode value={url} size={208}>Arrondi + logo</QrCode>
      <VStack gap={16}>
        {(["dots", "square"] as const).map((style) => (
          <HStack gap={12}>
            <QrCode value={url} size={124} style={style} logo={null} />
            <Small>{style === "dots" ? "Points" : "Carré"}</Small>
          </HStack>
        ))}
      </VStack>
    </Page>
  );
}
