"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Boxes, Candy, Check, Droplets, Pencil, Plus, Star, Archive, ArchiveRestore, X, PackageOpen, CupSoda, ImagePlus, ImageOff, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ItemThumb } from "@/components/item-thumb";
import {
  createItem,
  renameItem,
  removeItemImage,
  setDefaultItem,
  setItemActive,
  setItemImage,
  setItemNutrition,
} from "@/app/org/[officeId]/admin/items/actions";

interface ItemRow {
  id: string;
  name: string;
  imageUrl?: string;
  active: boolean;
  isDefault: boolean;
  volumeMl: number;
  sugarGrams: number;
  caffeineMg: number;
  stockQty: number;
  consumptionCount: number;
}

interface ItemsManagerProps {
  readonly officeId: string;
  readonly items: ItemRow[];
}

export function ItemsManager({ officeId, items }: ItemsManagerProps) {
  const t = useTranslations();
  const [isPending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editVolume, setEditVolume] = useState("");
  const [editSugar, setEditSugar] = useState("");
  const [editCaffeine, setEditCaffeine] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageTargetId = useRef<string | null>(null);

  function pickImage(itemId: string) {
    imageTargetId.current = itemId;
    fileInputRef.current?.click();
  }

  function handleImageSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const itemId = imageTargetId.current;
    e.target.value = ""; // allow re-selecting the same file later
    if (!file || !itemId) return;
    const formData = new FormData();
    formData.set("image", file);
    startTransition(async () => {
      const result = await setItemImage(officeId, itemId, formData);
      if (result.success) toast.success(t("items.imageUpdated"));
      else toast.error(result.error);
    });
  }

  function handleRemoveImage(itemId: string) {
    startTransition(async () => {
      const result = await removeItemImage(officeId, itemId);
      if (result.success) toast.success(t("items.imageRemoved"));
      else toast.error(result.error);
    });
  }

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    const formData = new FormData();
    formData.set("name", name);
    startTransition(async () => {
      const result = await createItem(officeId, formData);
      if (result.success) {
        toast.success(t("items.created"));
        setNewName("");
      } else {
        toast.error(result.error);
      }
    });
  }

  function startEdit(item: ItemRow) {
    setEditingId(item.id);
    setEditName(item.name);
    setEditVolume(String(item.volumeMl));
    setEditSugar(String(item.sugarGrams));
    setEditCaffeine(String(item.caffeineMg));
  }

  function handleSaveEdit(item: ItemRow) {
    const name = editName.trim();
    if (!name) return;
    startTransition(async () => {
      if (name !== item.name) {
        const nameData = new FormData();
        nameData.set("name", name);
        const renamed = await renameItem(officeId, item.id, nameData);
        if (!renamed.success) {
          toast.error(renamed.error);
          return;
        }
      }
      const nutritionData = new FormData();
      nutritionData.set("volumeMl", editVolume);
      nutritionData.set("sugarGrams", editSugar);
      nutritionData.set("caffeineMg", editCaffeine);
      const result = await setItemNutrition(officeId, item.id, nutritionData);
      if (result.success) {
        toast.success(t("items.updated"));
        setEditingId(null);
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleSetDefault(itemId: string) {
    startTransition(async () => {
      const result = await setDefaultItem(officeId, itemId);
      if (result.success) toast.success(t("items.defaultSet"));
      else toast.error(result.error);
    });
  }

  function handleToggleActive(itemId: string, active: boolean) {
    startTransition(async () => {
      const result = await setItemActive(officeId, itemId, active);
      if (result.success) {
        toast.success(active ? t("items.restored") : t("items.archived"));
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("items.addTitle")}</CardTitle>
          <CardDescription>{t("items.addDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-2">
            <Input
              value={newName}
              placeholder={t("items.namePlaceholder")}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
            <Button onClick={handleCreate} disabled={isPending || !newName.trim()}>
              <Plus className="mr-1 size-4" />
              {t("items.add")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-muted">
              <PackageOpen className="size-7 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">{t("items.empty")}</p>
              <p className="text-sm text-muted-foreground">
                {t("items.emptyDescription")}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
      <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleImageSelected}
      />
      <div className="space-y-2">
        {items.map((item) => (
          <Card key={item.id} className={item.active ? "" : "opacity-70"}>
            <CardContent className="flex flex-wrap items-center gap-3 py-3">
              <button
                type="button"
                className="group relative shrink-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => pickImage(item.id)}
                disabled={isPending}
                aria-label={t("items.changeImage")}
              >
                <ItemThumb imageUrl={item.imageUrl} name={item.name} />
                <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <ImagePlus className="size-4" />
                </span>
              </button>

              <div className="min-w-0 flex-1">
                {editingId === item.id ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        value={editName}
                        autoFocus
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveEdit(item);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        disabled={isPending}
                        onClick={() => handleSaveEdit(item)}
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        onClick={() => setEditingId(null)}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="space-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Droplets className="size-3" />
                          {t("items.volumeMl")}
                        </span>
                        <Input
                          type="number"
                          min={0}
                          value={editVolume}
                          onChange={(e) => setEditVolume(e.target.value)}
                        />
                      </label>
                      <label className="space-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Candy className="size-3" />
                          {t("items.sugarGrams")}
                        </span>
                        <Input
                          type="number"
                          min={0}
                          step="0.1"
                          value={editSugar}
                          onChange={(e) => setEditSugar(e.target.value)}
                        />
                      </label>
                      <label className="space-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Zap className="size-3" />
                          {t("items.caffeineMg")}
                        </span>
                        <Input
                          type="number"
                          min={0}
                          step="0.1"
                          value={editCaffeine}
                          onChange={(e) => setEditCaffeine(e.target.value)}
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{item.name}</span>
                      {item.isDefault && (
                        <Badge className="gap-1 bg-amber-100 text-amber-700 text-[10px] hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-300">
                          <Star className="size-3 fill-current" />
                          {t("items.defaultBadge")}
                        </Badge>
                      )}
                      {!item.active && (
                        <Badge variant="outline" className="text-[10px]">
                          {t("items.archivedBadge")}
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Boxes className="size-3" />
                        {t("items.stockLabel", { qty: item.stockQty })}
                      </span>
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <CupSoda className="size-3" />
                        {t("items.consumedLabel", { count: item.consumptionCount })}
                      </span>
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Droplets className="size-3" />
                        {item.volumeMl} ml
                      </span>
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Candy className="size-3" />
                        {item.sugarGrams} g
                      </span>
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Zap className="size-3" />
                        {item.caffeineMg} mg
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {editingId !== item.id && (
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    aria-label={t("items.rename")}
                    onClick={() => startEdit(item)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  {item.imageUrl && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label={t("items.removeImage")}
                      disabled={isPending}
                      onClick={() => handleRemoveImage(item.id)}
                    >
                      <ImageOff className="size-4" />
                    </Button>
                  )}
                  {!item.isDefault && item.active && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      disabled={isPending}
                      onClick={() => handleSetDefault(item.id)}
                    >
                      <Star className="mr-1 size-3.5" />
                      {t("items.makeDefault")}
                    </Button>
                  )}
                  {item.active ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label={t("items.archive")}
                      disabled={isPending || item.isDefault}
                      onClick={() => handleToggleActive(item.id, false)}
                    >
                      <Archive className="size-4" />
                    </Button>
                  ) : (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label={t("items.restore")}
                      disabled={isPending}
                      onClick={() => handleToggleActive(item.id, true)}
                    >
                      <ArchiveRestore className="size-4" />
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      </>
      )}
    </div>
  );
}
