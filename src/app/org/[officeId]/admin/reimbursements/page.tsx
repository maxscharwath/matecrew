interface Props {
  readonly params: Promise<{ officeId: string }>;
}

export default async function ReimbursementsPage({ params }: Props) {
  await params;

  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-bold">Reimbursements</h1>
      <p className="mt-2 text-muted-foreground">
        Reimbursement management coming soon.
      </p>
    </div>
  );
}
