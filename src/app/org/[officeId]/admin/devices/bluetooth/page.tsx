import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireOrgRoles } from "@/lib/auth-utils";
import { Button } from "@/components/ui/button";
import { BluetoothPanel } from "@/components/device-ble/bluetooth-panel";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

/** Set up a new terminal, or control and debug one in range, over Web Bluetooth. */
export default async function BluetoothPage({ params }: Props) {
  const { officeId } = await params;
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations("deviceBluetooth");
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/org/${officeId}/admin/devices`}>
            <ArrowLeft /> {t("back")}
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <BluetoothPanel officeId={officeId} />
    </div>
  );
}
