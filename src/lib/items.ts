import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveItemImageUrl } from "@/lib/storage";

/**
 * Items are the consumables an office manages (e.g. "Maté Classic",
 * "Maté Zero", "Ginger"). Every office has at least one item — the default —
 * which is used as the fallback whenever a flow doesn't specify one and to
 * keep historical single-product data intact.
 */

export interface ItemSummary {
  id: string;
  name: string;
  imageUrl?: string;
  isDefault: boolean;
  sortOrder: number;
  stockQty: number;
}

/** Canonical display order for an office's items (default first). */
export const ITEM_DISPLAY_ORDER: Prisma.ItemOrderByWithRelationInput[] = [
  { isDefault: "desc" },
  { sortOrder: "asc" },
  { name: "asc" },
];

/** Sums an item's stock rows into a single current quantity. */
export function sumStockQty(stock: { currentQty: number }[]): number {
  return stock.reduce((sum, s) => sum + s.currentQty, 0);
}

/** Active items for an office, ordered for display (default first). */
export async function getActiveItems(officeId: string): Promise<ItemSummary[]> {
  const items = await prisma.item.findMany({
    where: { officeId, active: true },
    orderBy: ITEM_DISPLAY_ORDER,
    select: {
      id: true,
      name: true,
      imageKey: true,
      isDefault: true,
      sortOrder: true,
      stock: { select: { currentQty: true } },
    },
  });
  return items.map((i) => ({
    id: i.id,
    name: i.name,
    imageUrl: resolveItemImageUrl(i.imageKey),
    isDefault: i.isDefault,
    sortOrder: i.sortOrder,
    stockQty: sumStockQty(i.stock),
  }));
}

/** The id of the office's default item, or null if none is configured. */
export async function getDefaultItemId(officeId: string): Promise<string | null> {
  const item = await prisma.item.findFirst({
    where: { officeId, isDefault: true },
    select: { id: true },
  });
  return item?.id ?? null;
}

/**
 * Resolves an item id for a write, defaulting to the office's default item.
 * Verifies the item belongs to the office. Returns null when no valid item can
 * be resolved.
 */
export async function resolveItemId(
  officeId: string,
  itemId: string | null | undefined,
): Promise<string | null> {
  if (itemId) {
    const item = await prisma.item.findFirst({
      where: { id: itemId, officeId },
      select: { id: true },
    });
    return item?.id ?? null;
  }
  return getDefaultItemId(officeId);
}

/**
 * Resolves item references — an id or a case-insensitive name — to ids in one
 * query. Ids are matched first, so an item named after another item's id can
 * never shadow it.
 *
 * Inactive items are included: a de-listed product can still have cans on the
 * shelf, and a stock count has to be able to name them.
 */
export async function resolveItemRefs(
  officeId: string,
  refs: string[],
): Promise<{ idByRef: Map<string, string>; names: string[] }> {
  const items = await prisma.item.findMany({
    where: { officeId },
    orderBy: ITEM_DISPLAY_ORDER,
    select: { id: true, name: true },
  });
  const byId = new Map(items.map((i) => [i.id, i.id]));
  const byName = new Map(items.map((i) => [i.name.toLowerCase(), i.id]));

  const idByRef = new Map<string, string>();
  for (const ref of refs) {
    const wanted = ref.trim();
    const id = byId.get(wanted) ?? byName.get(wanted.toLowerCase());
    if (id) idByRef.set(ref, id);
  }
  return { idByRef, names: items.map((i) => i.name) };
}
