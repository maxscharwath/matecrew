/** @jsxImportSource @matecrew/device-ui */
import {
  HStack,
  VStack,
  Separator,
  Logo,
  H1,
  H2,
  H3,
  Lead,
  P,
  Muted,
  Label,
  Num,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Button,
  Badge,
  Alert,
  AlertTitle,
  AlertDescription,
  Progress,
  Steps,
  Item,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemActions,
  useRouter,
} from "@matecrew/device-ui";
import {
  ChartColumnIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CupSodaIcon,
  ImageIcon,
  LanguagesIcon,
  LayoutDashboardIcon,
  ShapesIcon,
  TriangleAlertIcon,
  TypeIcon,
  WifiIcon,
} from "@matecrew/device-ui/icons/lucide";
import { Page, useT, type Page as PageName } from "./shared";

/** The kit's front door: what it is, and the pages one tap away. */
export function Home() {
  const router = useRouter<PageName>();
  const t = useT();
  const entries = [
    ["type", TypeIcon],
    ["components", ShapesIcon],
    ["layout", LayoutDashboardIcon],
    ["charts", ChartColumnIcon],
    ["media", ImageIcon],
    ["logic", LanguagesIcon],
  ] as const;
  return (
    <Page name="home" direction="row" gap={32}>
      <VStack gap={20} width={320}>
        <Logo size={48} />
        <H2 lines={3}>{t("home.title")}</H2>
        <Muted lines={3}>{t("home.text")}</Muted>
      </VStack>
      <Separator vertical />
      <VStack width="fill">
        {entries.flatMap(([route, Icon], i) => [
          i > 0 && <Separator />,
          <Item onPress={router.push(route)}>
            <ItemMedia><Icon size={28} /></ItemMedia>
            <ItemContent><ItemTitle>{t(route)}</ItemTitle></ItemContent>
            <ItemActions><ChevronRightIcon size={24} /></ItemActions>
          </Item>,
        ])}
      </VStack>
    </Page>
  );
}

/** The type scale: Free Universal for words, Logisoso for figures. */
export function TypeScale() {
  return (
    <Page name="type" direction="row" gap={32}>
      <VStack gap={2} width="fill">
        <H1 lines={1}>H1 · 42 gras</H1>
        <H2 lines={1}>H2 · 30 gras</H2>
        <H3 lines={1}>H3 · 25 gras</H3>
        <Lead lines={1}>Lead · une phrase qui introduit</Lead>
        <P lines={1}>P · le texte courant de l'appareil</P>
        <Muted lines={1}>Muted · détails et légendes</Muted>
        <Label>Label · capitales espacées</Label>
      </VStack>
      <Separator vertical />
      <VStack gap={12} width={208}>
        <Label>Chiffres</Label>
        <Num size="xl">1234</Num>
        <Num size="md">56,7</Num>
        <Num size="sm">+8 %</Num>
      </VStack>
    </Page>
  );
}

/** Cards, buttons, badges, alerts, progress and steps: what every screen is made of. */
export function Components() {
  return (
    <Page name="components" direction="row" gap={20}>
      <Card width="fill">
        <CardHeader>
          <CardTitle>Maté Classic</CardTitle>
          <CardDescription>36 en stock · 7 jours</CardDescription>
        </CardHeader>
        <CardContent>
          <HStack gap={8}>
            <Badge><WifiIcon size={18} /> Connecté</Badge>
            <Badge variant="outline"><CircleCheckIcon size={18} /> À jour</Badge>
          </HStack>
          <Progress value={64} />
        </CardContent>
        <CardFooter>
          <Button onPress={{ kind: "beep", tone: "success" }}><CupSodaIcon size={20} /> Prendre</Button>
          <Button variant="outline" onPress={{ kind: "beep", tone: "key" }}>Détails</Button>
        </CardFooter>
      </Card>
      <VStack gap={16} width="fill">
        <Alert>
          <TriangleAlertIcon size={24} />
          <AlertTitle>Stock bas</AlertTitle>
          <AlertDescription>Plus que 6 Maté Ginger au bureau.</AlertDescription>
        </Alert>
        <Card variant="ink" gap={8} padding={20}>
          <Label>Surface encre</Label>
          <Lead>Le contenu passe en papier tout seul.</Lead>
        </Card>
        <Steps steps={["Wi-Fi", "Site", "Prêt"]} current={1} />
      </VStack>
    </Page>
  );
}
