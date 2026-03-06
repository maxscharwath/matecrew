import { getSidebarData } from "@/lib/sidebar-data";
import { LocaleSync } from "@/components/locale-sync";
import { SidebarShell } from "@/components/sidebar-shell";

interface Props {
  readonly children: React.ReactNode;
}

export default async function ProfileLayout({ children }: Props) {
  const { userLocale, ...sidebarProps } = await getSidebarData();

  return (
    <SidebarShell {...sidebarProps}>
      <LocaleSync userLocale={userLocale} />
      {children}
    </SidebarShell>
  );
}
