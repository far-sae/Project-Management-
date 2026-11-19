import type { Branding, LetterheadDesign, LetterheadElement } from "./types.js";
export const PAPER = { width: 595.28, height: 841.89 };
export const ELEMENTS = [
  "logo",
  "companyName",
  "address",
  "identifiers",
  "rule",
  "footer",
  "pageNumber",
] as const;
export type ElementId = (typeof ELEMENTS)[number];
export const ELEMENT_LABELS: Record<ElementId, string> = {
  logo: "Company logo",
  companyName: "Company name",
  address: "Address",
  identifiers: "Registration & tax details",
  rule: "Divider line",
  footer: "Footer",
  pageNumber: "Page number",
};
export const BRAND_TEMPLATES = [
  {
    id: "executive",
    name: "Executive",
    description: "Charcoal masthead and layered diagonal footer",
  },
  {
    id: "metropolitan",
    name: "Metropolitan",
    description: "Angular corner cuts and a two-tone geometric footer",
  },
  {
    id: "editorial",
    name: "Editorial",
    description: "Circular corner motifs and a refined centered identity",
  },
  {
    id: "horizon",
    name: "Horizon",
    description: "Flowing layered ribbons with a crisp corporate header",
  },
  {
    id: "ledger",
    name: "Ledger",
    description: "Architectural tabs and a structured angular footer",
  },
  {
    id: "studio",
    name: "Modern studio",
    description: "Dynamic corner geometry and a bold studio signature",
  },
  {
    id: "prestige",
    name: "Prestige",
    description: "Dark crest, fine frame and a tailored signature band",
  },
  {
    id: "minimal-corporate",
    name: "Essential",
    description: "Slanted colour ribbons and a compact corporate masthead",
  },
] as const;
export type BrandDecoration = {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  points?: [number, number][];
};
export function templateDecorations(
  d: LetterheadDesign,
  color: string,
  secondaryColor = "#172c35",
): BrandDecoration[] {
  const w = PAPER.width,
    h = PAPER.height;
  const dark = secondaryColor;
  const tint = (amount: number) =>
    "#" +
    [1, 3, 5]
      .map((i) =>
        Math.round(
          parseInt(color.slice(i, i + 2), 16) * (1 - amount) + 255 * amount,
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  const rect = (
    x: number,
    y: number,
    width: number,
    height: number,
    fill = color,
  ): BrandDecoration => ({ x, y, width, height, color: fill });
  const poly = (points: [number, number][], fill = color): BrandDecoration => ({
    x: 0,
    y: 0,
    width: w,
    height: h,
    color: fill,
    points,
  });
  const circle = (cx: number, cy: number, r: number, fill = color) =>
    poly(
      Array.from(
        { length: 64 },
        (_, i) =>
          [
            cx + r * Math.cos((i * Math.PI) / 32),
            cy + r * Math.sin((i * Math.PI) / 32),
          ] as [number, number],
      ),
      fill,
    );
  const wave = (base: number, amp: number, phase: number, fill: string) =>
    poly(
      [
        ...Array.from(
          { length: 65 },
          (_, i) =>
            [
              (i * w) / 64,
              base + Math.sin((i / 64) * Math.PI + phase) * amp,
            ] as [number, number],
        ),
        [w, h],
        [0, h],
      ],
      fill,
    );
  switch (d.template) {
    case "executive":
      return [
        rect(42, 22, 511, 2, dark),
        rect(42, 26, 95, 4, color),
        rect(42, h - 73, 511, 0.7, tint(0.55)),
        rect(0, h - 19, w, 19, dark),
        rect(w - 150, h - 19, 150, 19, color),
      ];
    case "metropolitan":
      return [
        poly(
          [
            [w - 100, 0],
            [w, 0],
            [w, 100],
          ],
          dark,
        ),
        poly(
          [
            [w - 66, 0],
            [w, 0],
            [w, 66],
          ],
          color,
        ),
        rect(42, 138, 58, 3),
        rect(0, h - 22, w, 22, dark),
        poly(
          [
            [w - 180, h - 22],
            [w, h - 60],
            [w, h],
          ],
          color,
        ),
        rect(42, h - 73, 38, 3),
      ];
    case "editorial":
      return [
        circle(0, 0, 52, tint(0.86)),
        circle(0, 0, 35, color),
        circle(0, 0, 25, "#ffffff"),
        rect(90, 27, 415, 0.7, dark),
        rect(90, h - 70, 415, 0.7, tint(0.4)),
        circle(w, h, 52, tint(0.86)),
        circle(w, h, 35, color),
        circle(w, h, 25, "#ffffff"),
      ];
    case "horizon":
      return [
        rect(0, 0, w, 7, dark),
        rect(42, 21, 110, 3, color),
        wave(h - 42, 13, 0, tint(0.75)),
        wave(h - 31, 12, 0.3, color),
        wave(h - 18, 7, 0.7, dark),
      ];
    case "ledger":
      return [
        rect(26, 27, 4, 96, dark),
        rect(30, 27, 3, 46, color),
        rect(42, h - 71, 511, 0.7, dark),
        rect(42, h - 68, 48, 3, color),
        rect(0, h - 16, w, 16, dark),
        rect(w - 110, h - 24, 110, 8, color),
      ];
    case "studio":
      return [
        poly(
          [
            [0, 0],
            [76, 0],
            [0, 76],
          ],
          color,
        ),
        poly(
          [
            [0, 0],
            [41, 0],
            [0, 41],
          ],
          dark,
        ),
        rect(w - 140, 22, 98, 3, color),
        rect(42, h - 70, 70, 3, color),
        rect(0, h - 22, w, 22, dark),
        poly(
          [
            [w - 90, h],
            [w - 44, h - 46],
            [w, h - 46],
            [w, h],
          ],
          color,
        ),
      ];
    case "prestige":
      return [
        rect(25, 20, w - 50, 1, dark),
        rect(25, 20, 1, 103, dark),
        rect(w - 26, 20, 1, 103, dark),
        rect(264, 17, 67, 6, color),
        rect(25, h - 72, w - 50, 0.7, dark),
        rect(25, h - 72, 1, 48, dark),
        rect(w - 26, h - 72, 1, 48, dark),
        rect(25, h - 24, w - 50, 1, dark),
        rect(264, h - 27, 67, 6, color),
      ];
    case "minimal-corporate":
      return [
        rect(0, 0, w, 6, dark),
        rect(42, 25, 38, 3, color),
        poly(
          [
            [0, h - 27],
            [w, h - 10],
            [w, h],
            [0, h],
          ],
          dark,
        ),
        poly(
          [
            [0, h - 37],
            [w, h - 20],
            [w, h - 10],
            [0, h - 27],
          ],
          color,
        ),
        rect(42, h - 73, 38, 2, color),
      ];
    default:
      return [];
  }
}
export function presetDesign(name: string, b: Branding): LetterheadDesign {
  const box = (
    x: number,
    y: number,
    width: number,
    height: number,
    fontSize = 10,
    color = "#35443e",
    align: LetterheadElement["align"] = "left",
  ): LetterheadElement => ({
    x,
    y,
    width,
    height,
    fontSize,
    color,
    align,
    visible: true,
    fontFamily: b.fontFamily || "instrument",
  });
  const d: LetterheadDesign = {
    version: 1,
    headerHeight: 140,
    footerHeight: 64,
    accent: name !== "minimal",
    elements: {
      logo: box(42, 26, 78, 64),
      companyName: box(
        b.logo ? 140 : 42,
        27,
        b.logo ? 410 : 508,
        29,
        22,
        "#243536",
      ),
      address: box(b.logo ? 140 : 42, 63, b.logo ? 410 : 508, 38, 10),
      identifiers: box(42, 108, 510, 16, 8),
      rule: box(42, 132, 510, 1, 8, b.color),
      footer: box(80, 794, 472, 24, 8, "#52604f", "right"),
      pageNumber: box(42, 805, 36, 14, 8, "#52604f"),
    },
  };
  if (name === "centered") {
    d.headerHeight = 205;
    Object.assign(d.elements, {
      logo: box(258, 22, 80, 64),
      companyName: box(42, b.logo ? 94 : 35, 510, 34, 24, "#243536", "center"),
      address: box(42, b.logo ? 135 : 78, 510, 36, 10, "#35443e", "center"),
      identifiers: box(42, 179, 510, 15, 8, "#35443e", "center"),
      rule: box(42, 201, 510, 1, 8, b.color),
    });
  } else if (name === "right") {
    d.elements.logo = box(471, 26, 80, 64);
    d.elements.companyName = box(42, 27, b.logo ? 405 : 510, 29, 22, "#243536");
    d.elements.address = box(42, 63, b.logo ? 405 : 510, 38, 10);
  } else if (name === "minimal") {
    d.elements.rule.visible = false;
  }
  if (BRAND_TEMPLATES.some((t) => t.id === name)) {
    d.template = name;
    d.accent = false;
    d.footerHeight = 76;
    d.elements.rule.visible = false;
    d.elements.footer = {
      ...box(42, 790, 440, 26, 9, "#46575d"),
      align: "left",
    };
    d.elements.pageNumber = box(505, 796, 48, 16, 9, "#46575d", "right");
    d.elements.companyName.bold = true;
    d.elements.identifiers = box(42, 108, 511, 16, 8);
    if (name === "executive") {
      d.elements.companyName = {
        ...d.elements.companyName,
        fontFamily: "inter",
        color: "#183238",
        y: 38,
      };
      d.elements.address.y = 77;
      d.headerHeight = 150;
    } else if (name === "metropolitan") {
      d.elements.logo = box(42, 32, 68, 58);
      d.elements.companyName = box(
        b.logo ? 130 : 42,
        34,
        b.logo ? 420 : 510,
        32,
        24,
        "#183238",
      );
      d.elements.address = box(
        b.logo ? 130 : 42,
        76,
        b.logo ? 420 : 510,
        30,
        10,
      );
      d.headerHeight = 145;
    } else if (name === "editorial") {
      d.headerHeight = 195;
      d.elements.logo = box(274, 28, 48, 38);
      d.elements.companyName = box(
        42,
        b.logo ? 76 : 48,
        511,
        34,
        25,
        "#183238",
        "center",
      );
      d.elements.companyName.fontFamily = "source-serif";
      d.elements.address = box(
        42,
        b.logo ? 118 : 94,
        511,
        30,
        10,
        "#46575d",
        "center",
      );
      d.elements.identifiers = box(42, 162, 511, 16, 8, "#46575d", "center");
      d.elements.footer = box(90, 790, 415, 26, 9, "#46575d", "center");
      d.elements.pageNumber = box(512, 800, 40, 14, 8, "#46575d", "right");
    } else if (name === "horizon") {
      d.elements.logo = box(478, 38, 74, 60);
      d.elements.companyName = box(
        42,
        40,
        b.logo ? 410 : 511,
        32,
        24,
        "#183238",
      );
      d.elements.address = box(42, 82, 410, 28, 10);
      d.headerHeight = 150;
    } else if (name === "ledger") {
      d.elements.logo = box(66, 30, 60, 48);
      d.elements.companyName = box(
        b.logo ? 140 : 66,
        32,
        b.logo ? 235 : 309,
        32,
        20,
        "#183238",
      );
      d.elements.address = box(410, 30, 143, 65, 9, "#46575d", "right");
      d.elements.identifiers = box(66, 95, 309, 20, 8);
      d.headerHeight = 145;
      d.elements.footer = box(110, 790, 370, 26, 9, "#46575d");
    } else if (name === "studio") {
      d.elements.companyName = {
        ...d.elements.companyName,
        y: 43,
        fontFamily: "inter",
        fontSize: 26,
        color: "#183238",
      };
      d.elements.address.y = 85;
      d.elements.identifiers.y = 125;
      d.headerHeight = 160;
    } else if (name === "prestige") {
      d.elements.logo = box(268, 28, 60, 44);
      d.elements.companyName = box(
        42,
        b.logo ? 80 : 44,
        511,
        30,
        23,
        "#183238",
        "center",
      );
      d.elements.companyName.fontFamily = "inter";
      d.elements.address = box(
        42,
        b.logo ? 116 : 84,
        511,
        27,
        9,
        "#46575d",
        "center",
      );
      d.elements.identifiers = box(42, 152, 511, 16, 8, "#46575d", "center");
      d.headerHeight = 185;
      d.elements.footer = box(60, 790, 420, 25, 9, "#46575d", "center");
    } else {
      d.elements.companyName = {
        ...d.elements.companyName,
        y: 40,
        fontSize: 20,
        color: "#183238",
      };
      d.elements.address.y = 78;
      d.headerHeight = 145;
    }
  }
  if (d.template) {
    // Keep contact information on white space above the decorative footer.
    d.footerHeight = 100;
    d.elements.footer = {
      ...d.elements.footer,
      x: 42,
      y: 752,
      width: 440,
      height: 24,
      fontSize: 9,
      color: "#354951",
    };
    d.elements.pageNumber = {
      ...d.elements.pageNumber,
      x: 510,
      y: 760,
      width: 42,
      height: 14,
      color: "#354951",
    };
    if (name === "editorial") {
      d.elements.footer.width = 420;
      d.elements.footer.align = "left";
      d.elements.pageNumber.x = 484;
    }
    if (name === "executive") {
      d.headerHeight = 160;
      d.elements.companyName.y = 51;
      d.elements.address.y = 90;
      d.elements.identifiers.y = 127;
      d.elements.logo.y = 47;
    }
    if (name === "metropolitan") {
      d.elements.companyName.width = b.logo ? 285 : 380;
      d.elements.address.width = b.logo ? 285 : 380;
    }
    if (name === "ledger") {
      d.elements.logo.y = 49;
      d.elements.companyName.y = 51;
      d.elements.address.y = 50;
      d.elements.identifiers.y = 111;
      d.headerHeight = 150;
    }
    if (name === "studio") {
      d.elements.logo.x = 115;
      d.elements.logo.y = 37;
      d.elements.companyName.x = b.logo ? 200 : 115;
      d.elements.companyName.width = b.logo ? 350 : 435;
      d.elements.address.x = b.logo ? 200 : 115;
      d.elements.address.width = b.logo ? 350 : 435;
    }
    if (name === "minimal-corporate") {
      d.elements.companyName.y = 57;
      d.elements.address.y = 94;
      d.elements.identifiers.y = 128;
      d.elements.logo.y = 55;
      d.headerHeight = 155;
    }
  }
  d.elements.companyName.bold = true;
  if (d.template) {
    d.elements.identifiers.visible = false;
    d.elements.companyName.fontSize = Math.max(
      22,
      d.elements.companyName.fontSize,
    );
    d.elements.companyName.color = "#172c35";
  }
  return d;
}
export function designFor(b: Branding) {
  return (
    b.design ||
    presetDesign(
      b.logoPosition === "right"
        ? "right"
        : b.layout === "minimal"
          ? "minimal"
          : "classic",
      b,
    )
  );
}
export function elementText(id: ElementId, b: Branding) {
  if (id === "companyName") return b.companyName;
  if (id === "address") return b.address;
  if (id === "footer") return b.footer;
  if (id === "pageNumber") return "1 / 1";
  if (id === "identifiers")
    return [
      b.companyNumber && "Company " + b.companyNumber,
      b.taxNumber && "Tax ID " + b.taxNumber,
    ]
      .filter(Boolean)
      .join(" · ");
  return "";
}
export function constrainElement(
  id: ElementId,
  e: LetterheadElement,
  d: LetterheadDesign,
): LetterheadElement {
  const footer = id === "footer" || id === "pageNumber";
  const minY = footer ? PAPER.height - d.footerHeight + 5 : 12;
  const maxY = footer ? PAPER.height - 18 : d.headerHeight;
  const width = Math.max(20, Math.min(PAPER.width - 32, e.width));
  const height = Math.max(
    id === "rule" ? 1 : 12,
    Math.min(maxY - minY, e.height),
  );
  return {
    ...e,
    width,
    height,
    x: Math.max(16, Math.min(PAPER.width - 16 - width, e.x)),
    y: Math.max(minY, Math.min(maxY - height, e.y)),
  };
}
// Both previews use the same wrapping and shrink-to-fit rules, with their font metrics.
export function fitLetterheadText(
  value: string,
  e: LetterheadElement,
  measure: (text: string, size: number) => number,
) {
  let lines: string[] = [];
  let size = e.fontSize;
  for (; size >= 6; size -= 0.5) {
    lines = [];
    for (const paragraph of value.replace(/\r/g, "").split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        if (line && measure(line + " " + word, size) > e.width) {
          lines.push(line);
          line = "";
        }
        for (const char of (line ? " " : "") + word) {
          if (measure(line + char, size) > e.width && line) {
            lines.push(line);
            line = "";
          }
          line += char;
        }
      }
      lines.push(line);
    }
    if (lines.length * size * 1.25 <= e.height)
      return { lines, size, overflow: false };
  }
  return { lines, size: 6, overflow: true };
}
