import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { prisma } from "@/lib/prisma";
import { McpToolError, resolveAdminOffice } from "@/lib/mcp/context";
import { defineTool } from "@/lib/mcp/tool";
import { officeArg } from "@/lib/mcp/schemas";

/** Finds an item in the office by id or name, or explains what does exist. */
async function requireItem(officeId: string, item: string) {
  const wanted = item.trim();
  const match = await prisma.item.findFirst({
    where: {
      officeId,
      OR: [{ id: wanted }, { name: { equals: wanted, mode: "insensitive" } }],
    },
    select: { id: true, name: true, active: true, isDefault: true },
  });
  if (!match) {
    const available = await prisma.item.findMany({
      where: { officeId },
      select: { name: true },
    });
    throw new McpToolError(
      `No item called "${item}" in this office. Existing items: ${
        available.map((i) => i.name).join(", ") || "none"
      }.`,
    );
  }
  return match;
}

export function registerAdminItemTools(server: McpServer): void {
  defineTool(
    server,
    {
      name: "matecrew_admin_create_item",
      title: "Add a new item",
      description:
        "Add a maté variety to the office catalogue. It starts with zero stock — record a delivery to stock it. Nutrition figures default to a 50cl maté and drive the health statistics, so set them if the drink differs.",
      inputSchema: {
        office: officeArg,
        name: z
          .string()
          .min(1)
          .max(60)
          .describe("Display name, e.g. 'Maté Zero'. Must be unique per office."),
        volumeMl: z
          .number()
          .int()
          .min(0)
          .max(5000)
          .optional()
          .describe("Volume per can in millilitres. Defaults to 500."),
        sugarGrams: z
          .number()
          .min(0)
          .max(500)
          .optional()
          .describe("Sugar per can in grams. Defaults to 25."),
        caffeineMg: z
          .number()
          .min(0)
          .max(2000)
          .optional()
          .describe("Caffeine per can in milligrams. Defaults to 100."),
      },
    },
    async ({ office, name, volumeMl, sugarGrams, caffeineMg }, { actor }) => {
      const scope = await resolveAdminOffice(actor, office);
      const trimmed = name.trim();

      const existing = await prisma.item.findUnique({
        where: { officeId_name: { officeId: scope.officeId, name: trimmed } },
        select: { id: true },
      });
      if (existing) {
        throw new McpToolError(
          `${scope.officeName} already has an item called "${trimmed}".`,
        );
      }

      const maxSort = await prisma.item.aggregate({
        where: { officeId: scope.officeId },
        _max: { sortOrder: true },
      });

      const created = await prisma.item.create({
        data: {
          officeId: scope.officeId,
          name: trimmed,
          sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
          ...(volumeMl === undefined ? {} : { volumeMl }),
          ...(sugarGrams === undefined ? {} : { sugarGrams }),
          ...(caffeineMg === undefined ? {} : { caffeineMg }),
          // Every item needs its own stock pool from the start.
          stock: { create: { officeId: scope.officeId, currentQty: 0 } },
        },
        select: { id: true, name: true },
      });

      return {
        ok: true,
        itemId: created.id,
        item: created.name,
        stockQty: 0,
        message: `Added ${created.name} to ${scope.officeName} with zero stock.`,
      };
    },
  );

  defineTool(
    server,
    {
      name: "matecrew_admin_update_item",
      title: "Update an item",
      description:
        "Change an existing item: rename it, retire or restore it, make it the office default, reorder it, or correct its nutrition figures. Only the fields you pass are changed. Retiring an item hides it from ordering but keeps all its history.",
      inputSchema: {
        office: officeArg,
        item: z.string().describe("Item id or current name."),
        name: z.string().min(1).max(60).optional().describe("New name."),
        active: z
          .boolean()
          .optional()
          .describe("false retires the item, true brings it back."),
        isDefault: z
          .boolean()
          .optional()
          .describe(
            "true makes this the office default (the previous default loses the flag). An office has exactly one default.",
          ),
        sortOrder: z
          .number()
          .int()
          .optional()
          .describe("Display position — lower sorts first."),
        volumeMl: z.number().int().min(0).max(5000).optional(),
        sugarGrams: z.number().min(0).max(500).optional(),
        caffeineMg: z.number().min(0).max(2000).optional(),
      },
      idempotent: true,
    },
    async (
      {
        office,
        item,
        name,
        active,
        isDefault,
        sortOrder,
        volumeMl,
        sugarGrams,
        caffeineMg,
      },
      { actor },
    ) => {
      const scope = await resolveAdminOffice(actor, office);
      const target = await requireItem(scope.officeId, item);

      if (name !== undefined) {
        const trimmed = name.trim();
        const clash = await prisma.item.findUnique({
          where: { officeId_name: { officeId: scope.officeId, name: trimmed } },
          select: { id: true },
        });
        if (clash && clash.id !== target.id) {
          throw new McpToolError(
            `Another item in ${scope.officeName} is already called "${trimmed}".`,
          );
        }
      }

      if (active === false && target.isDefault) {
        throw new McpToolError(
          `${target.name} is the office default item, so it cannot be retired. Make another item the default first.`,
        );
      }
      if (isDefault === true && (active === false || !target.active)) {
        throw new McpToolError(
          `${target.name} is retired, so it cannot be the default. Set active: true in the same call to restore it.`,
        );
      }

      const data = {
        ...(name === undefined ? {} : { name: name.trim() }),
        ...(active === undefined ? {} : { active }),
        ...(sortOrder === undefined ? {} : { sortOrder }),
        ...(volumeMl === undefined ? {} : { volumeMl }),
        ...(sugarGrams === undefined ? {} : { sugarGrams }),
        ...(caffeineMg === undefined ? {} : { caffeineMg }),
      };

      if (Object.keys(data).length === 0 && isDefault !== true) {
        throw new McpToolError(
          "Nothing to change — pass at least one field to update.",
        );
      }

      // Clearing the old default and setting the new one must be atomic, or a
      // failure in between would leave the office with no default item.
      await prisma.$transaction([
        ...(isDefault === true
          ? [
              prisma.item.updateMany({
                where: { officeId: scope.officeId, isDefault: true },
                data: { isDefault: false },
              }),
            ]
          : []),
        prisma.item.update({
          where: { id: target.id },
          data: { ...data, ...(isDefault === true ? { isDefault: true } : {}) },
        }),
      ]);

      const updated = await prisma.item.findUniqueOrThrow({
        where: { id: target.id },
        select: {
          id: true,
          name: true,
          active: true,
          isDefault: true,
          sortOrder: true,
          volumeMl: true,
          sugarGrams: true,
          caffeineMg: true,
        },
      });

      return { ok: true, item: updated, message: `Updated ${updated.name}.` };
    },
  );
}
