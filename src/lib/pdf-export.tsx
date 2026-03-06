import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { createTw } from "react-pdf-tailwind";
import { createTranslator } from "next-intl";
import type { ConsumptionShare, PaymentLine } from "@/lib/reimbursement-calc";
import { toISODateString } from "@/lib/date";

async function getTranslator(locale: string) {
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return createTranslator({ locale, messages });
}

// Color tokens matching the app's shadcn/neutral palette (globals.css oklch values).
// Single-word keys required — react-pdf-tailwind treats hyphens as shade separators.
//
//  ink       #0a0a0a  --foreground   oklch(0.145)  neutral-950
//  dark      #171717  --primary      oklch(0.205)  neutral-900
//  light     #fafafa  --primary-fg   oklch(0.985)  neutral-50
//  subtle    #737373  --muted-fg     oklch(0.556)  neutral-500
//  surface   #f5f5f5  --muted        oklch(0.97)   neutral-100
//  edge      #e5e5e5  --border       oklch(0.922)  neutral-200
//  silver    #a3a3a3  --ring         oklch(0.708)  neutral-400
//  danger    #dc2626  --destructive  oklch(0.577 0.245 27)  red-600
//  dangersoft#fef2f2                                red-50
//  ok        #16a34a                                green-600
//  oksoft    #f0fdf4                                green-50
const tw = createTw({
  colors: {
    ink: "#0a0a0a",
    dark: "#171717",
    light: "#fafafa",
    subtle: "#737373",
    surface: "#f5f5f5",
    edge: "#e5e5e5",
    silver: "#a3a3a3",
    danger: "#dc2626",
    dangersoft: "#fef2f2",
    ok: "#16a34a",
    oksoft: "#f0fdf4",
  },
});

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

// Hex constants for inline color overrides
const RED = "#dc2626";
const GREEN = "#16a34a";
const MUTED = "#737373";

// ─── Shared components ──────────────────────────────────────────────────────

function HeaderBand({
  officeName,
  subtitle,
  dateRange,
}: {
  officeName: string;
  subtitle: string;
  dateRange: string;
}) {
  return (
    <View style={tw("bg-dark px-12 pt-5 pb-4")}>
      <View style={tw("flex-row justify-between items-center mb-2")}>
        <Text style={tw("font-bold text-lg text-light")}>{officeName}</Text>
        <Text style={tw("text-[8px] tracking-widest text-silver")}>MATECREW</Text>
      </View>
      <Text style={tw("text-[10px] text-silver mb-1")}>{subtitle}</Text>
      <Text style={tw("text-[9px] text-subtle")}>{dateRange}</Text>
    </View>
  );
}

function Footer({ text }: { text: string }) {
  return (
    <View
      style={tw(
        "absolute bottom-6 left-12 right-12 border-t border-edge pt-2 flex-row justify-between",
      )}
      fixed
    >
      <Text style={tw("text-[7px] text-subtle")}>{text}</Text>
      <Text style={tw("text-[7px] text-subtle")}>
        {toISODateString(new Date())}
      </Text>
    </View>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={tw("flex-1 bg-surface border-l-2 border-dark py-3 px-3")}>
      <Text style={tw("text-[7px] text-subtle uppercase mb-1")}>{label}</Text>
      <Text style={tw("font-bold text-[13px] text-ink")}>{value}</Text>
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <View style={tw("mb-3 mt-1")}>
      <Text style={tw("font-bold text-[11px] text-dark mb-1")}>
        {children}
      </Text>
      <View style={tw("w-8 h-[1.5px] bg-dark")} />
    </View>
  );
}

function TableHeader({ children }: { children: React.ReactNode }) {
  return (
    <View style={tw("flex-row bg-surface border-b border-edge py-2 px-2")}>
      {children}
    </View>
  );
}

function TH({
  children,
  width,
  align = "left",
}: {
  children: string;
  width: string;
  align?: "left" | "right";
}) {
  return (
    <Text
      style={{
        ...tw("font-bold text-[7.5px] text-subtle uppercase"),
        width,
        textAlign: align,
      }}
    >
      {children}
    </Text>
  );
}

function TableRow({
  alt,
  children,
}: {
  alt: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={tw(`flex-row py-2 px-2 ${alt ? "bg-surface" : ""}`)}>
      {children}
    </View>
  );
}

function TD({
  children,
  width,
  align = "left",
  bold,
  color,
}: {
  children: React.ReactNode;
  width?: string;
  align?: "left" | "right";
  bold?: boolean;
  color?: string;
}) {
  const base = tw(`text-[9px] text-ink ${bold ? "font-bold" : ""}`);
  const style: Style = {
    ...base,
    textAlign: align,
    ...(width ? { width } : { flex: 1 }),
    ...(color ? { color } : {}),
  };
  return <Text style={style}>{children}</Text>;
}

// Column widths
const SW = ["35%", "13%", "17%", "17%", "18%"];
const PW = ["40%", "40%", "20%"];

// ─── Admin Settlement PDF ───────────────────────────────────────────────────

function SettlementDocument({
  data,
  t,
}: {
  data: Parameters<typeof generateSettlementPdf>[0];
  t: ReturnType<typeof createTranslator>;
}) {
  const dateRange = `${toISODateString(data.startDate)} - ${toISODateString(data.endDate)}`;
  const totalQty = data.shares.reduce((s, r) => s + r.qty, 0);
  const totalCostShare = data.shares.reduce((s, r) => s + r.costShare, 0);
  const totalPaid = data.shares.reduce((s, r) => s + r.amountPaid, 0);

  return (
    <Document>
      <Page size="A4" style={tw("font-[Helvetica] text-[9px] text-ink pb-16")}>
        <HeaderBand
          officeName={data.officeName}
          subtitle={t("pdf.settlementStatement")}
          dateRange={dateRange}
        />
        <View style={tw("px-12 pt-6")}>
          {/* Summary boxes */}
          <View style={tw("flex-row gap-2 mb-8")}>
            <InfoBox
              label={t("pdf.totalConsumption")}
              value={t("pdf.units", { count: data.totalConsumption })}
            />
            <InfoBox
              label={t("pdf.unitPrice")}
              value={`CHF ${data.unitPrice.toFixed(2)}`}
            />
            <InfoBox
              label={t("pdf.totalCost")}
              value={`CHF ${data.totalCost.toFixed(2)}`}
            />
          </View>

          {/* Consumption shares */}
          <SectionTitle>{t("pdf.consumptionShares")}</SectionTitle>

          <TableHeader>
            <TH width={SW[0]}>{t("reimbursements.user")}</TH>
            <TH width={SW[1]} align="right">{t("pdf.consumed")}</TH>
            <TH width={SW[2]} align="right">{t("pdf.costShare")}</TH>
            <TH width={SW[3]} align="right">{t("pdf.paidLabel")}</TH>
            <TH width={SW[4]} align="right">{t("pdf.balanceLabel")}</TH>
          </TableHeader>

          {data.shares.map((s, i) => {
            const balColor =
              s.netOwed > 0.01 ? RED : s.netOwed < -0.01 ? GREEN : MUTED;
            const prefix = s.netOwed < -0.01 ? "-" : "";
            return (
              <TableRow key={s.userId} alt={i % 2 === 1}>
                <TD width={SW[0]}>{truncate(s.userName, 28)}</TD>
                <TD width={SW[1]} align="right">{String(s.qty)}</TD>
                <TD width={SW[2]} align="right">CHF {s.costShare.toFixed(2)}</TD>
                <TD width={SW[3]} align="right">CHF {s.amountPaid.toFixed(2)}</TD>
                <TD width={SW[4]} align="right" bold color={balColor}>
                  {prefix}CHF {Math.abs(s.netOwed).toFixed(2)}
                </TD>
              </TableRow>
            );
          })}

          {/* Totals */}
          <View style={tw("flex-row border-t border-ink py-2 px-2")}>
            <TD width={SW[0]} bold>{t("pdf.total")}</TD>
            <TD width={SW[1]} align="right" bold>{String(totalQty)}</TD>
            <TD width={SW[2]} align="right" bold>CHF {totalCostShare.toFixed(2)}</TD>
            <TD width={SW[3]} align="right" bold>CHF {totalPaid.toFixed(2)}</TD>
            <TD width={SW[4]} align="right">{""}</TD>
          </View>

          {/* Payment lines */}
          {data.lines.length > 0 && (
            <View style={tw("mt-8")}>
              <SectionTitle>{t("pdf.paymentLines")}</SectionTitle>

              <TableHeader>
                <TH width={PW[0]}>{t("pdf.from")}</TH>
                <TH width={PW[1]}>{t("pdf.to")}</TH>
                <TH width={PW[2]} align="right">{t("pdf.amount")}</TH>
              </TableHeader>

              {data.lines.map((l, i) => (
                <TableRow key={`${l.fromUserId}-${l.toUserId}`} alt={i % 2 === 1}>
                  <TD width={PW[0]}>{truncate(l.fromUserName, 24)}</TD>
                  <TD width={PW[1]}>{truncate(l.toUserName, 24)}</TD>
                  <TD width={PW[2]} align="right" bold>
                    CHF {l.amount.toFixed(2)}
                  </TD>
                </TableRow>
              ))}
            </View>
          )}
        </View>

        <Footer text={t("pdf.generatedBy")} />
      </Page>
    </Document>
  );
}

export async function generateSettlementPdf(data: {
  officeName: string;
  startDate: Date;
  endDate: Date;
  totalConsumption: number;
  totalCost: number;
  unitPrice: number;
  shares: ConsumptionShare[];
  lines: PaymentLine[];
  locale: string;
}): Promise<Buffer> {
  const t = await getTranslator(data.locale);
  const buffer = await renderToBuffer(
    <SettlementDocument data={data} t={t} />,
  );
  return Buffer.from(buffer);
}

// ─── User Personal Settlement PDF ───────────────────────────────────────────

interface UserPaymentLine {
  direction: "pay" | "receive";
  otherUserName: string;
  amount: number;
}

function UserSettlementDocument({
  data,
  t,
}: {
  data: Parameters<typeof generateUserSettlementPdf>[0];
  t: ReturnType<typeof createTranslator>;
}) {
  const dateRange = `${toISODateString(data.startDate)} - ${toISODateString(data.endDate)}`;
  const balColor =
    data.netOwed > 0.01 ? RED : data.netOwed < -0.01 ? GREEN : MUTED;
  const balPrefix = data.netOwed < -0.01 ? "-" : "";

  const balanceText =
    data.netOwed > 0.01
      ? t("pdf.youOwe", { amount: data.netOwed.toFixed(2) })
      : data.netOwed < -0.01
        ? t("pdf.youAreOwed", { amount: Math.abs(data.netOwed).toFixed(2) })
        : t("pdf.allSettled");

  const stripBg =
    data.netOwed > 0.01
      ? "bg-dangersoft"
      : data.netOwed < -0.01
        ? "bg-oksoft"
        : "bg-surface";

  return (
    <Document>
      <Page size="A4" style={tw("font-[Helvetica] text-[9px] text-ink pb-16")}>
        <HeaderBand
          officeName={data.officeName}
          subtitle={t("pdf.personalSettlement")}
          dateRange={dateRange}
        />
        <View style={tw("px-12 pt-6")}>
          {/* User name */}
          <Text style={tw("font-bold text-sm text-ink mb-1 pb-1")}>
            {data.userName}
          </Text>
          <View style={tw("w-10 h-[2px] bg-dark mb-5")} />

          {/* Summary box */}
          <View style={tw("bg-surface border-l-2 border-dark p-4 mb-6")}>
            <View style={tw("flex-row mb-4")}>
              <View style={tw("flex-1")}>
                <Text style={tw("text-[7px] text-subtle uppercase mb-1")}>
                  {t("pdf.consumed")}
                </Text>
                <Text style={tw("font-bold text-[11px] text-ink")}>
                  {t("pdf.units", { count: data.qty })}
                </Text>
              </View>
              <View style={tw("flex-1")}>
                <Text style={tw("text-[7px] text-subtle uppercase mb-1")}>
                  {t("pdf.youPaidLabel")}
                </Text>
                <Text style={tw("font-bold text-[11px] text-ink")}>
                  CHF {data.amountPaid.toFixed(2)}
                </Text>
              </View>
            </View>
            <View style={tw("flex-row mb-4")}>
              <View style={tw("flex-1")}>
                <Text style={tw("text-[7px] text-subtle uppercase mb-1")}>
                  {t("pdf.unitPrice")}
                </Text>
                <Text style={tw("font-bold text-[11px] text-ink")}>
                  CHF {data.unitPrice.toFixed(2)}
                </Text>
              </View>
              <View style={tw("flex-1")}>
                <Text style={tw("text-[7px] text-subtle uppercase mb-1")}>
                  {t("pdf.balanceLabel")}
                </Text>
                <Text style={{ ...tw("font-bold text-[11px]"), color: balColor }}>
                  {balPrefix}CHF {Math.abs(data.netOwed).toFixed(2)}
                </Text>
              </View>
            </View>
            <View style={tw("flex-row")}>
              <View style={tw("flex-1")}>
                <Text style={tw("text-[7px] text-subtle uppercase mb-1")}>
                  {t("pdf.yourShare")}
                </Text>
                <Text style={tw("font-bold text-[11px] text-ink")}>
                  CHF {data.costShare.toFixed(2)}
                </Text>
              </View>
              <View style={tw("flex-1")} />
            </View>
          </View>

          {/* Balance strip */}
          <View style={tw(`py-3 items-center mb-8 ${stripBg}`)}>
            <Text style={{ ...tw("font-bold text-[10px]"), color: balColor }}>
              {balanceText}
            </Text>
          </View>

          {/* Payment lines */}
          {data.lines.length > 0 && (
            <View>
              <SectionTitle>{t("pdf.paymentInstructions")}</SectionTitle>

              {data.lines.map((l, i) => {
                const isPay = l.direction === "pay";
                const badgeBg = isPay ? "bg-dangersoft" : "bg-oksoft";
                const badgeColor = isPay ? RED : GREEN;
                const badgeText = isPay ? t("pdf.pay") : t("pdf.receive");

                return (
                  <View
                    key={`${l.direction}-${l.otherUserName}`}
                    style={tw(
                      `flex-row items-center py-2 px-2 ${i % 2 === 1 ? "bg-surface" : ""}`,
                    )}
                  >
                    <View style={tw(`${badgeBg} py-1 px-2 w-14`)}>
                      <Text
                        style={{
                          ...tw("font-bold text-[7px] text-center"),
                          color: badgeColor,
                        }}
                      >
                        {badgeText}
                      </Text>
                    </View>
                    <Text style={tw("text-[9px] text-ink flex-1 ml-3")}>
                      {truncate(l.otherUserName, 30)}
                    </Text>
                    <Text
                      style={{
                        ...tw("font-bold text-[10px] text-right"),
                        color: badgeColor,
                      }}
                    >
                      CHF {l.amount.toFixed(2)}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <Footer text={t("pdf.generatedBy")} />
      </Page>
    </Document>
  );
}

export async function generateUserSettlementPdf(data: {
  officeName: string;
  userName: string;
  startDate: Date;
  endDate: Date;
  unitPrice: number;
  qty: number;
  costShare: number;
  amountPaid: number;
  netOwed: number;
  lines: UserPaymentLine[];
  locale: string;
}): Promise<Buffer> {
  const t = await getTranslator(data.locale);
  const buffer = await renderToBuffer(
    <UserSettlementDocument data={data} t={t} />,
  );
  return Buffer.from(buffer);
}
