import { PDFDocument, rgb } from "pdf-lib";
import type { Branding, Invoice, Payment } from "./shared/types.js";
import { AppError } from "./errors.js";
import { font, drawBranding, type BlobLoader } from "./pdf.js";
import { PAPER } from "./shared/letterhead.js";
const money = (n: number, c: string) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: c,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n / 100);
const date = (s: string) =>
  new Date(s + "T12:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
// Financial records are rendered once at issue/payment time, then stored immutably.
// Moved invoices carry a thin branding snapshot; fill the gaps like brandingOf does.
const DEFAULT_BRAND: Omit<Branding, "companyName"> = {
  address: "",
  companyNumber: "",
  taxNumber: "",
  color: "#24543b",
  fontSize: 12,
  fontFamily: "instrument",
  footer: "",
  layout: "letterhead",
  logoPosition: "left",
  paymentInstructions: "",
};
export async function financialPdf(
  i: Invoice,
  payment?: Payment,
  load?: BlobLoader,
): Promise<Uint8Array> {
  const brand: Branding = { ...DEFAULT_BRAND, ...i.branding } as Branding;
  const pdf = await PDFDocument.create();
  pdf.setTitle(
    payment ? "Receipt " + payment.receiptNumber : "Invoice " + i.number,
  );
  pdf.setProducer("TaskCalendar");
  const f = await font(pdf, brand.fontFamily, {
      bold: brand.bodyBold,
      italic: brand.bodyItalic,
    }),
    W = PAPER.width,
    H = PAPER.height,
    L = 48,
    R = W - 48;
  const top = brand.design ? H - brand.design.headerHeight - 26 : H - 122,
    bottom = brand.design ? brand.design.footerHeight + 18 : 70;
  const ink = rgb(0.13, 0.2, 0.19),
    muted = rgb(0.39, 0.45, 0.42),
    line = rgb(0.86, 0.89, 0.86),
    pale = rgb(0.95, 0.97, 0.94);
  const base = Math.max(10, Math.min(16, brand.fontSize)),
    leading = base * 1.35;
  let page = pdf.addPage([W, H]),
    y = top;
  function next() {
    if (pdf.getPageCount() >= 100)
      throw new AppError("This financial document exceeds 100 pages.");
    page = pdf.addPage([W, H]);
    y = top;
    text(
      (payment ? "PAYMENT RECEIPT" : "INVOICE") + " / CONTINUED",
      L,
      y,
      10,
      muted,
    );
    right(payment ? payment.receiptNumber : i.number, R, y, 10);
    y -= 28;
  }
  function ensure(height: number) {
    if (y - height < bottom) next();
  }
  function text(s: string, x: number, yy: number, size = base, color = ink) {
    page.drawText(s, { x, y: yy, font: f, size, color });
  }
  function right(s: string, x: number, yy: number, size = 10, color = ink) {
    while (f.widthOfTextAtSize(s, size) > 125 && size > 6) size -= 0.5;
    text(s, x - f.widthOfTextAtSize(s, size), yy, size, color);
  }
  function wrap(value: string, width: number, size: number) {
    const rows: string[] = [];
    for (const para of value.replace(/\r/g, "").split("\n")) {
      let row = "";
      for (const word of para.split(/\s+/)) {
        if (row && f.widthOfTextAtSize(row + " " + word, size) > width) {
          rows.push(row);
          row = "";
        }
        for (const char of (row ? " " : "") + word) {
          if (row && f.widthOfTextAtSize(row + char, size) > width) {
            rows.push(row);
            row = "";
          }
          row += char;
        }
      }
      rows.push(row);
    }
    return rows;
  }
  function paragraph(value: string, size = 10, color = muted, width = R - L) {
    for (const row of wrap(value, width, size)) {
      ensure(size * 1.45);
      text(row, L, y, size, color);
      y -= size * 1.45;
    }
  }
  function rule(yy: number) {
    page.drawLine({
      start: { x: L, y: yy },
      end: { x: R, y: yy },
      color: line,
      thickness: 0.6,
    });
  }
  const draft = i.status === "Draft" && !payment;
  text(
    payment ? "PAYMENT RECEIPT" : draft ? "DRAFT - INVOICE" : "INVOICE",
    L,
    y,
    payment ? 26 : 30,
  );
  y -= 28;
  text(payment ? payment.receiptNumber : i.number, L, y, 11, muted);
  y -= 25;
  const blockTop = y;
  text(payment ? "RECEIVED FROM" : "BILL TO", L, y, 8, muted);
  y -= 20;
  const customer = i.customer!;
  const buyer = [
    customer.name,
    customer.contactName,
    customer.billingAddress,
    customer.email,
    customer.companyNumber && "Company " + customer.companyNumber,
  ]
    .filter(Boolean)
    .join("\n");
  const buyerLines = wrap(buyer, 245, Math.min(base, 12));
  const metadata: [string, string][] = payment
    ? [
        ["Payment date", date(payment.paidOn)],
        ["For invoice", i.number],
        ["Currency", i.currency],
      ]
    : [
        ["Date of issue", date(i.issueDate)],
        ["Date due", date(i.dueDate)],
        ["Currency", i.currency],
      ];
  if (i.project) metadata.unshift(["Project", i.project]);
  if (buyerLines.length * 16 > y - bottom - 80) {
    paragraph(buyer, Math.min(base, 12), ink);
    y -= 12;
    for (const [label, value] of metadata)
      paragraph(`${label}: ${value}`, 10, ink);
    y -= 20;
  } else {
    for (const row of buyerLines) {
      text(row, L, y, Math.min(base, 12));
      y -= 16;
    }
    const buyerEnd = y;
    let metaY = blockTop;
    for (const [label, value] of metadata) {
      text(label, 330, metaY, 8, muted);
      const rows = wrap(value, R - 395, 10);
      for (const row of rows) {
        text(row, 395, metaY, 10);
        metaY -= 14;
      }
      metaY -= 8;
    }
    // No fixed spacer: the table follows the taller details column.
    y = Math.min(buyerEnd, metaY) - 20;
  }
  function tableHeader() {
    ensure(40);
    page.drawRectangle({
      x: L,
      y: y - 26,
      width: R - L,
      height: 28,
      color: pale,
    });
    text("DESCRIPTION", L + 10, y - 15, 8, muted);
    right("QTY", 315, y - 15, 8, muted);
    right("UNIT PRICE", 407, y - 15, 8, muted);
    right("TAX", 448, y - 15, 8, muted);
    right("AMOUNT", R - 8, y - 15, 8, muted);
    y -= 42;
  }
  tableHeader();
  const lines = payment
    ? [
        {
          description: `Payment received against invoice ${i.number}`,
          quantityMilli: 1000,
          rateMinor: payment.amountMinor,
          totalMinor: payment.amountMinor,
        },
      ]
    : i.lines;
  for (const l of lines) {
    const rows = wrap(
      l.description +
        ("billingType" in l && l.billingType && l.billingType !== "One-off"
          ? ` · ${l.billingType === "Custom" && "billingLabel" in l ? l.billingLabel : l.billingType}`
          : ""),
      205,
      base,
    );
    let first = true;
    while (rows.length) {
      if (y - leading - 14 < bottom) {
        next();
        tableHeader();
      }
      const count = Math.max(1, Math.floor((y - bottom - 16) / leading));
      const part = rows.splice(0, count);
      const start = y;
      for (const row of part) {
        text(row, L + 10, y, base);
        y -= leading;
      }
      if (first) {
        right(String(l.quantityMilli / 1000), 315, start, 10);
        right(money(l.rateMinor, i.currency), 407, start, 10);
        right(
          payment
            ? "—"
            : `${("taxBps" in l && l.taxBps !== undefined ? l.taxBps : i.taxBps) / 100}%`,
          448,
          start,
          9,
        );
        right(money(l.totalMinor, i.currency), R - 8, start, 10);
        first = false;
      }
      y -= 8;
      rule(y);
      y -= 12;
      if (rows.length) {
        next();
        tableHeader();
      }
    }
  }
  ensure(payment ? 142 : 115);
  y -= 8;
  const totalRow = (label: string, value: string) => {
    text(label, 310, y, 10, muted);
    right(value, R - 8, y, 11);
    y -= 23;
  };
  if (payment) {
    totalRow("Invoice total", money(i.totalMinor, i.currency));
    const previous = i.payments.reduce((n, p) => n + p.amountMinor, 0);
    totalRow("Previously received", money(previous, i.currency));
    totalRow(
      "Remaining balance",
      money(i.totalMinor - previous - payment.amountMinor, i.currency),
    );
  } else {
    totalRow("Subtotal", money(i.subtotalMinor, i.currency));
    totalRow(
      i.lines.some((l) => l.taxBps !== undefined && l.taxBps !== i.taxBps)
        ? "Tax (by item)"
        : `Tax (${i.taxBps / 100}%)`,
      money(i.taxMinor, i.currency),
    );
  }
  page.drawRectangle({
    x: 300,
    y: y - 21,
    width: R - 300,
    height: 39,
    color: ink,
  });
  text(
    payment ? "PAYMENT RECEIVED" : draft ? "DRAFT TOTAL" : "TOTAL DUE",
    312,
    y - 6,
    8,
    rgb(1, 1, 1),
  );
  right(
    money(payment ? payment.amountMinor : i.totalMinor, i.currency),
    R - 10,
    y - 7,
    14,
    rgb(1, 1, 1),
  );
  y -= 58;
  if (payment) {
    paragraph("Payment method: " + payment.method, 10, ink);
    paragraph("Reference: " + (payment.reference || "Not provided"), 10, ink);
    y -= 12;
    paragraph(
      "This receipt records a payment entered by the issuer. It does not initiate or collect a payment.",
      9,
    );
  } else {
    if (i.notes) {
      ensure(35);
      text("NOTES", L, y, 8, muted);
      y -= 18;
      paragraph(i.notes, 10, ink);
      y -= 14;
    }
    ensure(35);
    text("PAYMENT INSTRUCTIONS", L, y, 8, muted);
    y -= 18;
    paragraph(
      brand.paymentInstructions ||
        "Contact the issuer for payment instructions.",
      10,
      ink,
    );
  }
  if (brand.address && !brand.design?.elements.address.visible) {
    y -= 18;
    ensure(30);
    paragraph("Issued by: " + brand.companyName, 9);
    paragraph(brand.address, 9);
  }
  await drawBranding(pdf, brand, load);
  if (!brand.design)
    pdf.getPages().forEach((p, n) =>
      p.drawText(`${n + 1} / ${pdf.getPageCount()}`, {
        x: L,
        y: 29,
        font: f,
        size: 8,
        color: muted,
      }),
    );
  return pdf.save();
}

export function sampleFinancial(brand: Branding, receipt = false, load?: BlobLoader): Promise<Uint8Array> {
  const i: Invoice = {
    id: "design-preview",
    workspaceId: "preview",
    clientId: "sample",
    createdBy: "preview",
    revision: 1,
    status: "Issued",
    number: "INV-2026-00005",
    project: "Brand & digital services",
    currency: "GBP",
    issueDate: "2026-11-11",
    dueDate: "2026-11-25",
    created: "2026-11-11T12:00:00Z",
    updated: "2026-11-11T12:00:00Z",
    branding: brand,
    customer: {
      name: "Sample Client Ltd",
      contactName: "Client Accounts Team",
      email: "accounts@example.test",
      companyNumber: "",
      billingAddress: "12 Example Street\nLondon",
    },
    lines: [
      {
        description: "Digital marketing services\nMonthly retainer",
        quantityMilli: 1000,
        rateMinor: 50000,
        totalMinor: 50000,
      },
      {
        description: "Application development\nProject milestone",
        quantityMilli: 1000,
        rateMinor: 75000,
        totalMinor: 75000,
      },
      {
        description: "Automation & reporting",
        quantityMilli: 2000,
        rateMinor: 12500,
        totalMinor: 25000,
      },
    ],
    taxBps: 2000,
    subtotalMinor: 150000,
    taxMinor: 30000,
    totalMinor: 180000,
    notes: "Design preview only. No payment is requested.",
    payments: [],
    events: [],
  };
  const p: Payment = {
    id: "preview",
    receiptNumber: "RCT-2026-00005",
    amountMinor: 180000,
    paidOn: "2026-11-11",
    reference: "SAMPLE / PREVIEW ONLY",
    method: "Bank transfer",
    receiptHash: "",
    recordedAt: "2026-11-11T12:00:00Z",
  };
  return financialPdf(i, receipt ? p : undefined, load);
}
