import { redirect } from "next/navigation";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

export default async function OrgIndexPage({ params }: Props) {
  const { officeId } = await params;
  redirect(`/org/${officeId}/dashboard`);
}
