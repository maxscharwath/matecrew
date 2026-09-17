import { permanentRedirect } from "next/navigation";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

/**
 * Inventory moved into Stock: counting the fridge and reading its level are
 * the same job, and splitting them meant two screens disagreeing about the
 * same numbers. Kept as a redirect so old links and bookmarks still land.
 */
export default async function InventoryPage({ params }: Props) {
  const { officeId } = await params;
  permanentRedirect(`/org/${officeId}/admin/stock`);
}
