"use client";

import { useTransition, useState, useCallback } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Plus, Trash2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { bulkCreateConsumption } from "@/app/org/[officeId]/admin/consumption/actions";

interface Member {
  userId: string;
  name: string;
}

interface BulkConsumptionFormProps {
  readonly officeId: string;
  readonly members: Member[];
}

interface Row {
  id: number;
  userId: string;
  date: string;
  qty: number;
  deductStock: boolean;
}

let nextId = 1;

function makeRow(date: string, deductStock = false): Row {
  return { id: nextId++, userId: "", date, qty: 1, deductStock };
}

export function BulkConsumptionForm({
  officeId,
  members,
}: BulkConsumptionFormProps) {
  const [isPending, startTransition] = useTransition();
  const t = useTranslations();
  const today = new Date().toISOString().split("T")[0];

  const [rows, setRows] = useState<Row[]>(() => [makeRow(today)]);
  const [defaultDeductStock, setDefaultDeductStock] = useState(false);

  const addRow = useCallback(() => {
    setRows((prev) => {
      const lastDate = prev.length > 0 ? prev[prev.length - 1].date : today;
      return [...prev, makeRow(lastDate, defaultDeductStock)];
    });
  }, [today, defaultDeductStock]);

  const removeRow = useCallback((id: number) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const updateRow = useCallback(
    (id: number, field: keyof Row, value: string | number | boolean) => {
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
      );
    },
    [],
  );

  const fillAllMembers = useCallback(() => {
    setRows((prev) => {
      const lastDate = prev.length > 0 ? prev[prev.length - 1].date : today;
      return members.map((m) => ({
        id: nextId++,
        userId: m.userId,
        date: lastDate,
        qty: 1,
        deductStock: defaultDeductStock,
      }));
    });
  }, [members, today, defaultDeductStock]);

  const validRows = rows.filter((r) => r.userId && r.qty > 0 && r.date);
  const totalQty = validRows.reduce((sum, r) => sum + r.qty, 0);

  function handleSubmit() {
    if (validRows.length === 0) {
      toast.error(t("bulkConsumption.noRows"));
      return;
    }

    startTransition(async () => {
      const result = await bulkCreateConsumption(
        officeId,
        validRows.map((r) => ({
          userId: r.userId,
          date: r.date,
          qty: r.qty,
          deductStock: r.deductStock,
        })),
      );
      if (result.success) {
        toast.success(t("bulkConsumption.created", { count: result.count }));
        setRows([makeRow(today)]);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("bulkConsumption.formTitle")}</CardTitle>
        <CardDescription>
          {t("bulkConsumption.formDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="mr-1 size-4" />
            {t("bulkConsumption.addRow")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={fillAllMembers}
          >
            <Copy className="mr-1 size-4" />
            {t("bulkConsumption.fillAllMembers")}
          </Button>
        </div>

        {rows.length > 0 && (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[250px]">
                    {t("bulkConsumption.member")}
                  </TableHead>
                  <TableHead className="w-[170px]">
                    {t("bulkConsumption.date")}
                  </TableHead>
                  <TableHead className="w-[100px]">
                    {t("bulkConsumption.qty")}
                  </TableHead>
                  <TableHead className="w-[100px]">
                    {t("bulkConsumption.stock")}
                  </TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Select
                        value={row.userId}
                        onValueChange={(v) => updateRow(row.id, "userId", v)}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t("purchases.selectMember")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {members.map((m) => (
                            <SelectItem key={m.userId} value={m.userId}>
                              {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="date"
                        value={row.date}
                        onChange={(e) =>
                          updateRow(row.id, "date", e.target.value)
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={1}
                        value={row.qty}
                        onChange={(e) =>
                          updateRow(
                            row.id,
                            "qty",
                            Math.max(1, Number(e.target.value) || 1),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={row.deductStock}
                        onCheckedChange={(v) =>
                          updateRow(row.id, "deductStock", v)
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeRow(row.id)}
                      >
                        <Trash2 className="size-4 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {rows.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t("bulkConsumption.noRowsHint")}
          </p>
        )}

        <div className="flex items-center gap-3 rounded-md border p-3">
          <Switch
            id="defaultDeductStock"
            checked={defaultDeductStock}
            onCheckedChange={(v) => {
              setDefaultDeductStock(v);
              setRows((prev) => prev.map((r) => ({ ...r, deductStock: v })));
            }}
          />
          <Label htmlFor="defaultDeductStock" className="flex flex-col gap-0.5">
            <span>{t("bulkConsumption.deductStock")}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {t("bulkConsumption.deductStockHint")}
            </span>
          </Label>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {t("bulkConsumption.summary", {
              rows: validRows.length,
              total: totalQty,
            })}
          </p>
          <Button
            onClick={handleSubmit}
            disabled={isPending || validRows.length === 0}
          >
            {isPending
              ? t("common.processing")
              : t("bulkConsumption.submit")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
