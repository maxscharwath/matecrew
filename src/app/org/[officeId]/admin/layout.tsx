import { requireOrgRoles } from "@/lib/auth-utils";

interface Props {
  readonly children: React.ReactNode;
  readonly params: Promise<{ officeId: string }>;
}

export default async function AdminLayout({ children, params }: Props) {
  const { officeId } = await params;
  await requireOrgRoles(officeId, "ADMIN");

  return <>{children}</>;
}
