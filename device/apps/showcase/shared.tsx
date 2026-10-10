/** @jsxImportSource @matecrew/device-ui */
import { VStack, StatusBar, Main, Keys, Key, useRouter, useI18n, defineMessages, type Children, type LayoutProps } from "@matecrew/device-ui";

export const pages = ["home", "type", "components", "layout", "charts", "icons", "media", "logic", "themes", "hardware"] as const;
export type Page = (typeof pages)[number];

export const messages = defineMessages({
  fr: {
    "title": "Device Studio",
    "title_type": "Typographie",
    "title_components": "Composants",
    "title_layout": "Mise en page",
    "title_charts": "Graphiques",
    "title_icons": "Icônes",
    "title_media": "Images & QR",
    "title_logic": "Logique & langues",
    "title_themes": "Apparence",
    "title_hardware": "Matériel",
    "home": "Device Studio",
    "type": "Typographie",
    "components": "Composants",
    "layout": "Mise en page",
    "charts": "Graphiques",
    "icons": "Icônes",
    "media": "Images & QR",
    "logic": "Logique & langues",
    "themes": "Apparence",
    "hardware": "Matériel",
    "back": "Retour",
    "next": "Suite",
    "start": "Accueil",
    "home.title": "Un kit natif pour l'encre électronique",
    "home.text": "Composants comme shadcn, mise en page flex calculée sur l'appareil, textes traduits.",
    "taken_zero": "Aucun maté pris",
    "taken_one": "{{count}} maté pris",
    "taken_other": "{{count}} matés pris",
    "hello": "Bonjour {{name}} !",
    "language": "Langue",
  },
  en: {
    "title": "Device Studio",
    "title_type": "Typography",
    "title_components": "Components",
    "title_layout": "Layout",
    "title_charts": "Charts",
    "title_icons": "Icons",
    "title_media": "Images & QR",
    "title_logic": "Logic & languages",
    "title_themes": "Appearance",
    "title_hardware": "Hardware",
    "home": "Device Studio",
    "type": "Typography",
    "components": "Components",
    "layout": "Layout",
    "charts": "Charts",
    "icons": "Icons",
    "media": "Images & QR",
    "logic": "Logic & languages",
    "themes": "Appearance",
    "hardware": "Hardware",
    "back": "Back",
    "next": "Next",
    "start": "Home",
    "home.title": "A native kit for electronic ink",
    "home.text": "Components like shadcn, flex layout computed on the device, translated text.",
    "taken_zero": "No maté taken",
    "taken_one": "{{count}} maté taken",
    "taken_other": "{{count}} matés taken",
    "hello": "Hello {{name}}!",
    "language": "Language",
  },
});
export const useT = () => useI18n(messages);

/** The one status bar: its title follows the current page (an i18next context, one text node). */
export function TitleBar() {
  const router = useRouter<Page>();
  const t = useT();
  return <StatusBar>{t("title", { context: router.current })}</StatusBar>;
}

/** A showcase page: its content, and the keys walking through the pages. */
export function Page({ name, children, ...layout }: LayoutProps & { name: Page; children?: Children }) {
  const router = useRouter<Page>();
  const t = useT();
  const index = pages.indexOf(name);
  const last = index === pages.length - 1;
  return (
    <VStack width="fill" height="fill">
      <Main {...layout}>{children}</Main>
      <Keys>
        <Key side="left" onPress={router.back()}>{index === 0 ? t("start") : t("back")}</Key>
        <Key side="right" primary onPress={last ? router.reset("home") : router.push(pages[index + 1])}>
          {last ? t("start") : t("next")}
        </Key>
      </Keys>
    </VStack>
  );
}
