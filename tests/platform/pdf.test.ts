import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { generateSettlementPdf, generateUserSettlementPdf } from "../../src/lib/pdf-export";
import { YOGA_WASM_BYTES } from "../../src/platform/cloudflare/pdf";
import { YOGA_WASM_PATH, embeddedYogaWasm } from "../../scripts/extract-yoga-wasm";

const period = { officeName: "Office", startDate: new Date("2026-09-01"), endDate: new Date("2026-09-30"), locale: "en" };

function pageCount(pdf: Buffer): number {
  return pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0;
}

test("both statements render as one-page PDFs", async () => {
  const admin = await generateSettlementPdf({
    ...period,
    totalConsumption: 3,
    totalCost: 5.4,
    avgUnitPrice: 1.8,
    lossQty: 1,
    lossCost: 1.8,
    unallocatedLossCost: 0,
    itemPrices: [{ itemId: "i", itemName: "Mate", unitPrice: 1.8, qtyConsumed: 3, cost: 5.4 }],
    shares: [{ userId: "u", userName: "Alice", qty: 3, costShare: 5.4, amountPaid: 0, netOwed: 5.4, lossShare: 0 }],
    lines: [{ fromUserId: "u", fromUserName: "Alice", toUserId: "v", toUserName: "Bob", amount: 5.4 }],
  } as Parameters<typeof generateSettlementPdf>[0]);
  const user = await generateUserSettlementPdf({
    ...period,
    userName: "Alice",
    avgUnitPrice: 1.8,
    qty: 3,
    costShare: 5.4,
    lossShare: 0,
    amountPaid: 0,
    netOwed: -5.4,
    lines: [{ direction: "receive", otherUserName: "Bob", amount: 5.4 }],
  });
  for (const pdf of [admin, user]) {
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.equal(pageCount(pdf), 1);
  }
});

test("the Worker's yoga binary is the one React-PDF embeds", () => {
  const committed = readFileSync(YOGA_WASM_PATH);
  assert.equal(committed.length, YOGA_WASM_BYTES, "set YOGA_WASM_BYTES to the size of yoga.wasm");
  assert.ok(
    Buffer.from(embeddedYogaWasm()).equals(committed),
    "yoga.wasm is stale: run `bun scripts/extract-yoga-wasm.ts`",
  );
});

test("where WebAssembly cannot be compiled at run time, React-PDF fails and the Worker adapter renders", () => {
  const run = (mode: string) =>
    spawnSync(process.execPath, ["tests/platform/fixtures/workerd-pdf.ts", mode], { encoding: "utf8" });
  const plain = run("plain");
  assert.notEqual(plain.status, 0, "React-PDF compiled yoga from bytes: the guard no longer stands for workerd");
  assert.match(plain.stderr, /disallowed by embedder/);
  const adapter = run("adapter");
  assert.equal(adapter.status, 0, adapter.stderr);
  assert.match(adapter.stdout, /^%PDF- \d+/);
});
