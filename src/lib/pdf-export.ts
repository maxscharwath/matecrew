import { PDFDocument, PDFPage, PDFFont, rgb, StandardFonts } from "pdf-lib";
import { createTranslator } from "next-intl";
import type { ConsumptionShare, PaymentLine } from "@/lib/reimbursement-calc";
import { toISODateString } from "@/lib/date";

async function getTranslator(locale: string) {
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return createTranslator({ locale, messages });
}

// Layout
const A4_WIDTH = 595;
const A4_HEIGHT = 842;
const MARGIN = 48;
const CONTENT_WIDTH = A4_WIDTH - 2 * MARGIN;
const LINE_HEIGHT = 16;
const TABLE_ROW_HEIGHT = 22;
const HEADER_BAND_HEIGHT = 72;
const SECTION_GAP = 24;

// Colors
const BRAND_DARK = rgb(0.11, 0.15, 0.25);
const TEAL = rgb(0.12, 0.51, 0.49);
const WHITE = rgb(1, 1, 1);
const LIGHT_BG = rgb(0.96, 0.97, 0.98);
const TABLE_HEADER_BG = rgb(0.93, 0.94, 0.96);
const MEDIUM_GRAY = rgb(0.75, 0.78, 0.82);
const DARK_TEXT = rgb(0.13, 0.15, 0.18);
const SECONDARY_TEXT = rgb(0.42, 0.45, 0.5);
const MUTED_ON_DARK = rgb(0.6, 0.65, 0.72);
const LIGHT_ON_DARK = rgb(0.7, 0.75, 0.82);
const RED = rgb(0.75, 0.12, 0.12);
const GREEN = rgb(0.09, 0.52, 0.18);
const RED_BG = rgb(0.97, 0.92, 0.92);
const GREEN_BG = rgb(0.92, 0.97, 0.93);

interface Column {
  label: string;
  x: number;
  align: "left" | "right";
}

class PdfContext {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  fontBold: PDFFont;
  y: number;
  isFirstPage = true;
  private readonly footerText: string;

  constructor(doc: PDFDocument, font: PDFFont, fontBold: PDFFont, footerText: string) {
    this.doc = doc;
    this.font = font;
    this.fontBold = fontBold;
    this.footerText = footerText;
    this.page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
    this.y = A4_HEIGHT - MARGIN;
  }

  ensureSpace(needed: number) {
    if (this.y - needed < MARGIN + 30) {
      this.drawPageFooter();
      this.page = this.doc.addPage([A4_WIDTH, A4_HEIGHT]);
      this.y = A4_HEIGHT - MARGIN;
      this.isFirstPage = false;
    }
  }

  drawHeaderBand(officeName: string, subtitle: string, dateRange: string) {
    // Dark rectangle across top
    this.page.drawRectangle({
      x: 0,
      y: A4_HEIGHT - HEADER_BAND_HEIGHT,
      width: A4_WIDTH,
      height: HEADER_BAND_HEIGHT,
      color: BRAND_DARK,
    });
    // Teal accent line at bottom of band
    this.page.drawRectangle({
      x: 0,
      y: A4_HEIGHT - HEADER_BAND_HEIGHT,
      width: A4_WIDTH,
      height: 2,
      color: TEAL,
    });
    // Office name
    this.page.drawText(officeName, {
      x: MARGIN,
      y: A4_HEIGHT - 28,
      font: this.fontBold,
      size: 18,
      color: WHITE,
    });
    // "MATECREW" right-aligned
    const brandText = "MATECREW";
    const brandWidth = this.font.widthOfTextAtSize(brandText, 9);
    this.page.drawText(brandText, {
      x: A4_WIDTH - MARGIN - brandWidth,
      y: A4_HEIGHT - 28,
      font: this.font,
      size: 9,
      color: MUTED_ON_DARK,
    });
    // Subtitle
    this.page.drawText(subtitle, {
      x: MARGIN,
      y: A4_HEIGHT - 48,
      font: this.font,
      size: 10,
      color: LIGHT_ON_DARK,
    });
    // Date range
    this.page.drawText(dateRange, {
      x: MARGIN,
      y: A4_HEIGHT - 62,
      font: this.font,
      size: 9,
      color: MUTED_ON_DARK,
    });

    this.y = A4_HEIGHT - HEADER_BAND_HEIGHT - 28;
  }

  drawSectionTitle(title: string) {
    this.ensureSpace(LINE_HEIGHT + 20);
    this.page.drawText(title, {
      x: MARGIN,
      y: this.y,
      font: this.fontBold,
      size: 11,
      color: BRAND_DARK,
    });
    const textWidth = this.fontBold.widthOfTextAtSize(title, 11);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y - 4 },
      end: { x: MARGIN + textWidth + 8, y: this.y - 4 },
      thickness: 1.5,
      color: TEAL,
    });
    this.y -= LINE_HEIGHT + 8;
  }

  drawInfoBox(
    x: number,
    width: number,
    label: string,
    value: string,
    accentColor = TEAL,
  ) {
    const height = 44;
    const boxY = this.y - height + 12;
    // Background
    this.page.drawRectangle({
      x,
      y: boxY,
      width,
      height,
      color: LIGHT_BG,
    });
    // Left accent bar
    this.page.drawRectangle({
      x,
      y: boxY,
      width: 2.5,
      height,
      color: accentColor,
    });
    // Label
    this.page.drawText(label.toUpperCase(), {
      x: x + 12,
      y: boxY + height - 14,
      font: this.font,
      size: 7,
      color: SECONDARY_TEXT,
    });
    // Value
    this.page.drawText(value, {
      x: x + 12,
      y: boxY + 10,
      font: this.fontBold,
      size: 13,
      color: DARK_TEXT,
    });
  }

  drawTableHeader(columns: Column[]) {
    this.ensureSpace(TABLE_ROW_HEIGHT + 4);
    // Background
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - TABLE_ROW_HEIGHT + 10,
      width: CONTENT_WIDTH,
      height: TABLE_ROW_HEIGHT,
      color: TABLE_HEADER_BG,
    });
    // Bottom border
    this.page.drawLine({
      start: { x: MARGIN, y: this.y - TABLE_ROW_HEIGHT + 10 },
      end: { x: A4_WIDTH - MARGIN, y: this.y - TABLE_ROW_HEIGHT + 10 },
      thickness: 0.75,
      color: MEDIUM_GRAY,
    });
    // Header labels
    for (const col of columns) {
      const text = col.label.toUpperCase();
      const size = 7.5;
      if (col.align === "right") {
        const w = this.fontBold.widthOfTextAtSize(text, size);
        this.page.drawText(text, {
          x: col.x - w,
          y: this.y - 2,
          font: this.fontBold,
          size,
          color: SECONDARY_TEXT,
        });
      } else {
        this.page.drawText(text, {
          x: col.x,
          y: this.y - 2,
          font: this.fontBold,
          size,
          color: SECONDARY_TEXT,
        });
      }
    }
    this.y -= TABLE_ROW_HEIGHT;
  }

  drawTableRow(
    cells: { text: string; color?: typeof DARK_TEXT; bold?: boolean }[],
    columns: Column[],
    isAlternate: boolean,
  ) {
    this.ensureSpace(TABLE_ROW_HEIGHT);
    if (isAlternate) {
      this.page.drawRectangle({
        x: MARGIN,
        y: this.y - TABLE_ROW_HEIGHT + 10,
        width: CONTENT_WIDTH,
        height: TABLE_ROW_HEIGHT,
        color: LIGHT_BG,
      });
    }
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const col = columns[i];
      const f = cell.bold ? this.fontBold : this.font;
      const size = 9;
      const color = cell.color ?? DARK_TEXT;
      if (col.align === "right") {
        const w = f.widthOfTextAtSize(cell.text, size);
        this.page.drawText(cell.text, {
          x: col.x - w,
          y: this.y - 2,
          font: f,
          size,
          color,
        });
      } else {
        this.page.drawText(cell.text, {
          x: col.x,
          y: this.y - 2,
          font: f,
          size,
          color,
        });
      }
    }
    this.y -= TABLE_ROW_HEIGHT;
  }

  drawBalanceStrip(text: string, netOwed: number) {
    const height = 28;
    this.ensureSpace(height + 8);
    const bg =
      netOwed > 0.01 ? RED_BG : netOwed < -0.01 ? GREEN_BG : LIGHT_BG;
    const textColor =
      netOwed > 0.01 ? RED : netOwed < -0.01 ? GREEN : SECONDARY_TEXT;

    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - height + 8,
      width: CONTENT_WIDTH,
      height,
      color: bg,
    });
    // Center text
    const textWidth = this.fontBold.widthOfTextAtSize(text, 10);
    this.page.drawText(text, {
      x: MARGIN + (CONTENT_WIDTH - textWidth) / 2,
      y: this.y - 6,
      font: this.fontBold,
      size: 10,
      color: textColor,
    });
    this.y -= height + SECTION_GAP;
  }

  drawPageFooter() {
    const footerY = MARGIN + 8;
    this.page.drawLine({
      start: { x: MARGIN, y: footerY + 12 },
      end: { x: A4_WIDTH - MARGIN, y: footerY + 12 },
      thickness: 0.5,
      color: MEDIUM_GRAY,
    });
    this.page.drawText(this.footerText, {
      x: MARGIN,
      y: footerY,
      font: this.font,
      size: 7,
      color: MUTED_ON_DARK,
    });
    const dateStr = toISODateString(new Date());
    const dateWidth = this.font.widthOfTextAtSize(dateStr, 7);
    this.page.drawText(dateStr, {
      x: A4_WIDTH - MARGIN - dateWidth,
      y: footerY,
      font: this.font,
      size: 7,
      color: MUTED_ON_DARK,
    });
  }

  static async create(footerText: string): Promise<PdfContext> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    return new PdfContext(doc, font, fontBold, footerText);
  }

  async save(): Promise<Buffer> {
    this.drawPageFooter();
    const bytes = await this.doc.save();
    return Buffer.from(bytes);
  }
}

// ─── Admin Settlement PDF ───────────────────────────────────────────────────

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
  const ctx = await PdfContext.create(t("pdf.generatedBy"));

  const dateRange = `${toISODateString(data.startDate)} - ${toISODateString(data.endDate)}`;
  ctx.drawHeaderBand(data.officeName, t("pdf.settlementStatement"), dateRange);

  // Summary boxes row
  const boxWidth = Math.floor((CONTENT_WIDTH - 16) / 3);
  ctx.drawInfoBox(
    MARGIN,
    boxWidth,
    t("pdf.totalConsumption"),
    t("pdf.units", { count: data.totalConsumption }),
  );
  ctx.drawInfoBox(
    MARGIN + boxWidth + 8,
    boxWidth,
    t("pdf.unitPrice"),
    `CHF ${data.unitPrice.toFixed(2)}`,
  );
  ctx.drawInfoBox(
    MARGIN + (boxWidth + 8) * 2,
    boxWidth,
    t("pdf.totalCost"),
    `CHF ${data.totalCost.toFixed(2)}`,
  );
  ctx.y -= 44 + SECTION_GAP;

  // Shares table
  ctx.drawSectionTitle(t("pdf.consumptionShares"));

  const userLabel = t("reimbursements.user");
  const shareColumns: Column[] = [
    { label: userLabel, x: MARGIN + 4, align: "left" },
    { label: t("pdf.consumed"), x: MARGIN + 200, align: "right" },
    { label: t("pdf.costShare"), x: MARGIN + 290, align: "right" },
    { label: t("pdf.paidLabel"), x: MARGIN + 380, align: "right" },
    { label: t("pdf.balanceLabel"), x: MARGIN + CONTENT_WIDTH - 4, align: "right" },
  ];

  ctx.drawTableHeader(shareColumns);

  for (let i = 0; i < data.shares.length; i++) {
    const s = data.shares[i];
    const name =
      s.userName.length > 28 ? s.userName.slice(0, 28) + "..." : s.userName;
    const balanceColor =
      s.netOwed > 0.01 ? RED : s.netOwed < -0.01 ? GREEN : SECONDARY_TEXT;
    const balancePrefix = s.netOwed < -0.01 ? "-" : "";

    ctx.drawTableRow(
      [
        { text: name },
        { text: String(s.qty) },
        { text: `CHF ${s.costShare.toFixed(2)}` },
        { text: `CHF ${s.amountPaid.toFixed(2)}` },
        {
          text: `${balancePrefix}CHF ${Math.abs(s.netOwed).toFixed(2)}`,
          color: balanceColor,
          bold: true,
        },
      ],
      shareColumns,
      i % 2 === 1,
    );
  }

  // Totals row
  const totalQty = data.shares.reduce((s, r) => s + r.qty, 0);
  const totalCostShare = data.shares.reduce((s, r) => s + r.costShare, 0);
  const totalPaid = data.shares.reduce((s, r) => s + r.amountPaid, 0);
  ctx.ensureSpace(TABLE_ROW_HEIGHT + 4);
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y + 10 },
    end: { x: A4_WIDTH - MARGIN, y: ctx.y + 10 },
    thickness: 0.75,
    color: MEDIUM_GRAY,
  });
  ctx.drawTableRow(
    [
      { text: t("pdf.total"), bold: true },
      { text: String(totalQty), bold: true },
      { text: `CHF ${totalCostShare.toFixed(2)}`, bold: true },
      { text: `CHF ${totalPaid.toFixed(2)}`, bold: true },
      { text: "" },
    ],
    shareColumns,
    false,
  );

  ctx.y -= SECTION_GAP;

  // Payment lines
  if (data.lines.length > 0) {
    ctx.drawSectionTitle(t("pdf.paymentLines"));

    const payColumns: Column[] = [
      { label: t("pdf.from"), x: MARGIN + 4, align: "left" },
      { label: "", x: MARGIN + 160, align: "left" },
      { label: t("pdf.to"), x: MARGIN + 180, align: "left" },
      { label: t("pdf.amount"), x: MARGIN + CONTENT_WIDTH - 4, align: "right" },
    ];

    ctx.drawTableHeader(payColumns);

    for (let i = 0; i < data.lines.length; i++) {
      const l = data.lines[i];
      const from =
        l.fromUserName.length > 20
          ? l.fromUserName.slice(0, 20) + "..."
          : l.fromUserName;
      const to =
        l.toUserName.length > 20
          ? l.toUserName.slice(0, 20) + "..."
          : l.toUserName;

      ctx.drawTableRow(
        [
          { text: from },
          { text: "->", color: SECONDARY_TEXT },
          { text: to },
          { text: `CHF ${l.amount.toFixed(2)}`, bold: true },
        ],
        payColumns,
        i % 2 === 1,
      );
    }
  }

  return ctx.save();
}

// ─── User Personal Settlement PDF ───────────────────────────────────────────

interface UserPaymentLine {
  direction: "pay" | "receive";
  otherUserName: string;
  amount: number;
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
  const ctx = await PdfContext.create(t("pdf.generatedBy"));

  const dateRange = `${toISODateString(data.startDate)} - ${toISODateString(data.endDate)}`;
  ctx.drawHeaderBand(data.officeName, t("pdf.personalSettlement"), dateRange);

  // User name with accent
  ctx.page.drawText(data.userName, {
    x: MARGIN,
    y: ctx.y,
    font: ctx.fontBold,
    size: 14,
    color: DARK_TEXT,
  });
  ctx.y -= 6;
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: MARGIN + 40, y: ctx.y },
    thickness: 2,
    color: TEAL,
  });
  ctx.y -= 20;

  // Summary box
  const boxHeight = 90;
  const boxY = ctx.y - boxHeight + 12;
  ctx.page.drawRectangle({
    x: MARGIN,
    y: boxY,
    width: CONTENT_WIDTH,
    height: boxHeight,
    color: LIGHT_BG,
  });
  ctx.page.drawRectangle({
    x: MARGIN,
    y: boxY,
    width: 3,
    height: boxHeight,
    color: TEAL,
  });

  // Left column
  const leftX = MARGIN + 16;
  const rightX = MARGIN + 260;
  let row = boxY + boxHeight - 18;

  const drawSummaryItem = (
    x: number,
    y: number,
    label: string,
    value: string,
    color = DARK_TEXT,
  ) => {
    ctx.page.drawText(label.toUpperCase(), {
      x,
      y: y + 10,
      font: ctx.font,
      size: 7,
      color: SECONDARY_TEXT,
    });
    ctx.page.drawText(value, {
      x,
      y,
      font: ctx.fontBold,
      size: 11,
      color,
    });
  };

  drawSummaryItem(leftX, row, t("pdf.consumed"), t("pdf.units", { count: data.qty }));
  drawSummaryItem(rightX, row, t("pdf.youPaidLabel"), `CHF ${data.amountPaid.toFixed(2)}`);
  row -= 28;
  drawSummaryItem(leftX, row, t("pdf.unitPrice"), `CHF ${data.unitPrice.toFixed(2)}`);
  const balColor =
    data.netOwed > 0.01 ? RED : data.netOwed < -0.01 ? GREEN : SECONDARY_TEXT;
  const balPrefix = data.netOwed < -0.01 ? "-" : "";
  drawSummaryItem(
    rightX,
    row,
    t("pdf.balanceLabel"),
    `${balPrefix}CHF ${Math.abs(data.netOwed).toFixed(2)}`,
    balColor,
  );
  row -= 28;
  drawSummaryItem(leftX, row, t("pdf.yourShare"), `CHF ${data.costShare.toFixed(2)}`);

  ctx.y = boxY - SECTION_GAP;

  // Balance highlight strip
  const balanceText =
    data.netOwed > 0.01
      ? t("pdf.youOwe", { amount: data.netOwed.toFixed(2) })
      : data.netOwed < -0.01
        ? t("pdf.youAreOwed", { amount: Math.abs(data.netOwed).toFixed(2) })
        : t("pdf.allSettled");
  ctx.drawBalanceStrip(balanceText, data.netOwed);

  // Payment lines
  if (data.lines.length > 0) {
    ctx.drawSectionTitle(t("pdf.paymentInstructions"));

    for (let i = 0; i < data.lines.length; i++) {
      const l = data.lines[i];
      ctx.ensureSpace(TABLE_ROW_HEIGHT);

      if (i % 2 === 1) {
        ctx.page.drawRectangle({
          x: MARGIN,
          y: ctx.y - TABLE_ROW_HEIGHT + 10,
          width: CONTENT_WIDTH,
          height: TABLE_ROW_HEIGHT,
          color: LIGHT_BG,
        });
      }

      // Direction badge
      const isPay = l.direction === "pay";
      const badgeText = isPay ? t("pdf.pay") : t("pdf.receive");
      const badgeBg = isPay ? RED_BG : GREEN_BG;
      const badgeColor = isPay ? RED : GREEN;
      const badgeWidth = isPay ? 30 : 48;

      ctx.page.drawRectangle({
        x: MARGIN + 4,
        y: ctx.y - 6,
        width: badgeWidth,
        height: 14,
        color: badgeBg,
      });
      const badgeTextWidth = ctx.fontBold.widthOfTextAtSize(badgeText, 6.5);
      ctx.page.drawText(badgeText, {
        x: MARGIN + 4 + (badgeWidth - badgeTextWidth) / 2,
        y: ctx.y - 2,
        font: ctx.fontBold,
        size: 6.5,
        color: badgeColor,
      });

      // Person name
      const name =
        l.otherUserName.length > 30
          ? l.otherUserName.slice(0, 30) + "..."
          : l.otherUserName;
      ctx.page.drawText(name, {
        x: MARGIN + 60,
        y: ctx.y - 2,
        font: ctx.font,
        size: 10,
        color: DARK_TEXT,
      });

      // Amount
      const amountText = `CHF ${l.amount.toFixed(2)}`;
      const amountWidth = ctx.fontBold.widthOfTextAtSize(amountText, 10);
      ctx.page.drawText(amountText, {
        x: A4_WIDTH - MARGIN - 4 - amountWidth,
        y: ctx.y - 2,
        font: ctx.fontBold,
        size: 10,
        color: badgeColor,
      });

      ctx.y -= TABLE_ROW_HEIGHT;
    }
  }

  return ctx.save();
}
