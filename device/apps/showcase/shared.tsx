/** @jsxImportSource ../../authoring */
import {
  Screen,
  DeviceChrome,
  KeyBar,
  useRouter,
  type Children,
} from "../../authoring";
export const pages = [
  "home",
  "components",
  "charts",
  "area",
  "icons",
  "media",
  "themes",
  "state",
  "hardware",
] as const;
export type Page = (typeof pages)[number];
export function Page({
  name,
  title,
  children,
}: {
  name: Page;
  title: string;
  children: Children;
}) {
  const router = useRouter<Page>();
  const index = pages.indexOf(name);
  return (
    <Screen width={400} height={240}>
      <DeviceChrome title={title} />
      {children}
      <KeyBar
        left={index === 0 ? "Accueil" : "Retour"}
        right={index === pages.length - 1 ? "Accueil" : "Suite"}
        onLeft={router.back()}
        onRight={
          index === pages.length - 1
            ? router.reset("home")
            : router.push(pages[index + 1])
        }
      />
    </Screen>
  );
}
