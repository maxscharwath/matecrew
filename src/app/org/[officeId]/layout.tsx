import { MembershipGate } from "./membership-gate";

interface Props {
  readonly children: React.ReactNode;
  readonly params: Promise<{ officeId: string }>;
}

export default async function OrgLayout({ children, params }: Props) {
  const { officeId } = await params;

  return <MembershipGate officeId={officeId}>{children}</MembershipGate>;
}
