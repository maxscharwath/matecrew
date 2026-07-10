"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CupSoda, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ItemThumb } from "@/components/item-thumb";
import { takeACan } from "@/app/org/[officeId]/dashboard/actions";

interface Item {
  id: string;
  name: string;
  imageUrl?: string;
  stockQty: number;
}

interface Props {
  officeId: string;
  items: Item[];
}

export function TakeCanButton({ officeId, items }: Props) {
  const [open, setOpen] = useState(false);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const t = useTranslations();

  function take(itemId: string | null) {
    startTransition(async () => {
      const result = await takeACan(officeId, itemId);
      setOpen(false);
      if (result.success) {
        toast.success(t("dashboard.canTaken"));
      } else {
        toast.error(result.error);
      }
    });
  }

  // Several items: pick one from a menu (then confirm). Single/none: confirm.
  if (items.length > 1) {
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button disabled={isPending} size="lg" className="gap-2">
              <CupSoda className="size-5" />
              {isPending ? t("common.processing") : t("dashboard.takeCan")}
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="min-w-52">
            {items.map((item) => {
              const soldOut = item.stockQty <= 0;
              return (
                <DropdownMenuItem
                  key={item.id}
                  disabled={soldOut}
                  onSelect={() => {
                    setPendingItemId(item.id);
                    setOpen(true);
                  }}
                >
                  <ItemThumb
                    imageUrl={item.imageUrl}
                    name={item.name}
                    className="mr-2 size-5 rounded-md"
                  />
                  <span className="flex-1">{item.name}</span>
                  {soldOut ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t("request.outOfStock")}
                    </span>
                  ) : (
                    <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                      {item.stockQty}
                    </span>
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          onConfirm={() => take(pendingItemId)}
          title={t("dashboard.takeCanConfirmTitle")}
          description={
            items.find((i) => i.id === pendingItemId)
              ? t("dashboard.takeCanConfirmItem", {
                  item: items.find((i) => i.id === pendingItemId)!.name,
                })
              : t("dashboard.takeCanConfirmDescription")
          }
          confirmLabel={t("dashboard.takeCan")}
          confirmVariant="default"
          isPending={isPending}
        />
      </>
    );
  }

  const soldOut = (items[0]?.stockQty ?? 0) <= 0;

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={isPending || soldOut}
        size="lg"
        className="gap-2"
      >
        <CupSoda className="size-5" />
        {soldOut
          ? t("request.outOfStock")
          : isPending
            ? t("common.processing")
            : t("dashboard.takeCan")}
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        onConfirm={() => take(null)}
        title={t("dashboard.takeCanConfirmTitle")}
        description={t("dashboard.takeCanConfirmDescription")}
        confirmLabel={t("dashboard.takeCan")}
        confirmVariant="default"
        isPending={isPending}
      />
    </>
  );
}
