import { PDFDocument, rgb, degrees, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { base64ToBytes } from "./files";
import {
  mergeText,
  mmToPt,
  type Project,
  type TextObject,
  type DataRow,
} from "./model";

const color = (hex: string) => {
  const clean = hex.replace("#", "");
  return rgb(
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255,
  );
};
const splitLines = (
  font: PDFFont,
  text: string,
  size: number,
  maxWidth: number,
  spacing: number,
) => {
  const out: string[] = [];
  for (const original of text.split("\n")) {
    let line = "";
    for (const char of original) {
      const candidate = line + char;
      if (
        line &&
        font.widthOfTextAtSize(candidate, size) +
          Math.max(0, candidate.length - 1) * spacing >
          maxWidth
      ) {
        out.push(line);
        line = char;
      } else line = candidate;
    }
    out.push(line);
  }
  return out;
};
function drawHorizontal(
  page: PDFPage,
  font: PDFFont,
  obj: TextObject,
  text: string,
  offsetX: number,
  offsetY: number,
): boolean {
  const size = obj.fontSize,
    x = mmToPt(obj.x + offsetX),
    top = page.getHeight() - mmToPt(obj.y + offsetY),
    width = mmToPt(obj.width),
    height = mmToPt(obj.height),
    spacing = mmToPt(obj.letterSpacing);
  const lines = splitLines(font, text, size, width, spacing);
  const step = size * obj.lineHeight;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const measured =
      font.widthOfTextAtSize(line, size) +
      Math.max(0, line.length - 1) * spacing;
    const dx =
      obj.align === "center"
        ? (width - measured) / 2
        : obj.align === "right"
          ? width - measured
          : 0;
    if (spacing === 0)
      page.drawText(line, {
        x: x + dx,
        y: top - size - i * step,
        size,
        font,
        color: color(obj.color),
        rotate: degrees(obj.rotation),
      });
    else {
      let cursor = x + dx;
      for (const char of line) {
        page.drawText(char, {
          x: cursor,
          y: top - size - i * step,
          size,
          font,
          color: color(obj.color),
          rotate: degrees(obj.rotation),
        });
        cursor += font.widthOfTextAtSize(char, size) + spacing;
      }
    }
  }
  return lines.length * step > height + step - size;
}
function drawVertical(
  page: PDFPage,
  font: PDFFont,
  obj: TextObject,
  text: string,
  offsetX: number,
  offsetY: number,
): boolean {
  const size = obj.fontSize,
    x = mmToPt(obj.x + offsetX),
    top = page.getHeight() - mmToPt(obj.y + offsetY),
    width = mmToPt(obj.width),
    height = mmToPt(obj.height),
    advance = size * obj.lineHeight,
    spacing = mmToPt(obj.letterSpacing);
  const columns: string[][] = [[]];
  for (const char of text) {
    if (
      char === "\n" ||
      columns.at(-1)!.length * (size + spacing) + size > height
    )
      columns.push([]);
    if (char !== "\n") columns.at(-1)!.push(char);
  }
  columns.forEach((chars, ci) =>
    chars.forEach((char, ri) => {
      const verticalForms: Record<string, string> = {
        "、": "︑",
        "。": "︒",
        "「": "﹁",
        "」": "﹂",
        "『": "﹃",
        "』": "﹄",
        "（": "︵",
        "）": "︶",
      };
      const glyph = verticalForms[char] ?? char;
      // Draw each glyph upright; rotate only glyphs that are conventionally sideways in vertical text.
      const sideways = /[A-Za-z0-9!?()\[\]]/.test(glyph);
      page.drawText(glyph, {
        x: x + width - (ci + 1) * advance,
        y: top - (ri + 1) * (size + spacing),
        size,
        font,
        color: color(obj.color),
        rotate: degrees(sideways ? 90 + obj.rotation : obj.rotation),
      });
    }),
  );
  return columns.length * advance > width;
}
export type PdfProgress = (done: number, total: number) => void;
export async function createPdf(
  project: Project,
  indices: number[],
  withBackground: boolean,
  progress?: PdfProgress,
  testMarks = false,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fonts = new Map<string, PDFFont>();
  const builtins = [
    ["serif", "NotoSerifCJKjp-Regular.otf"],
    ["sans", "NotoSansCJKjp-Regular.otf"],
    ["serif-bold", "NotoSerifCJKjp-Bold.otf"],
    ["sans-bold", "NotoSansCJKjp-Bold.otf"],
  ];
  const needed = new Set(
    project.objects.map((o) =>
      o.bold && ["serif", "sans"].includes(o.fontId)
        ? `${o.fontId}-bold`
        : o.fontId,
    ),
  );
  for (const [id, filename] of builtins.filter(([id]) => needed.has(id))) {
    const response = await fetch(
      `${import.meta.env.BASE_URL}fonts/${filename}`,
    );
    if (!response.ok) throw new Error("標準フォントを読み込めませんでした");
    fonts.set(
      id,
      await pdf.embedFont(await response.arrayBuffer(), { subset: true }),
    );
  }
  for (const asset of project.fonts) {
    if (!asset.embeddingAllowed) continue;
    fonts.set(
      asset.id,
      await pdf.embedFont(base64ToBytes(asset.data), { subset: true }),
    );
  }
  let sourcePdf: PDFDocument | null = null;
  if (withBackground && project.background)
    sourcePdf = await PDFDocument.load(base64ToBytes(project.background.data));
  const records: DataRow[] = project.rows.length
    ? indices.map((i) => project.rows[i] ?? {})
    : [{}];
  for (let i = 0; i < records.length; i++) {
    const page = pdf.addPage([
      mmToPt(project.paper.width),
      mmToPt(project.paper.height),
    ]);
    if (sourcePdf) {
      const source = sourcePdf.getPage(
        Math.max(
          0,
          Math.min(project.background!.page - 1, sourcePdf.getPageCount() - 1),
        ),
      );
      const embedded = await pdf.embedPage(source);
      page.drawPage(embedded, {
        x: 0,
        y: 0,
        width: page.getWidth(),
        height: page.getHeight(),
        opacity: project.background!.opacity,
      });
    }
    if (testMarks) drawTestMarks(page);
    else
      for (const obj of project.objects) {
        const fontId =
          obj.bold && ["serif", "sans"].includes(obj.fontId)
            ? `${obj.fontId}-bold`
            : obj.fontId;
        const font = fonts.get(fontId);
        if (!font)
          throw new Error(
            `${obj.fontId} のフォントがありません。埋め込み権限を確認してください。`,
          );
        const text = mergeText(obj.text, records[i]);
        if (obj.vertical)
          drawVertical(page, font, obj, text, project.offsetX, project.offsetY);
        else
          drawHorizontal(
            page,
            font,
            obj,
            text,
            project.offsetX,
            project.offsetY,
          );
      }
    progress?.(i + 1, records.length);
    if (i % 10 === 9) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return pdf.save();
}
function drawTestMarks(page: PDFPage): void {
  const w = page.getWidth(),
    h = page.getHeight(),
    stroke = rgb(0.18, 0.22, 0.3);
  for (const x of [mmToPt(10), w - mmToPt(10)])
    for (const y of [mmToPt(10), h - mmToPt(10)]) {
      page.drawLine({
        start: { x: x - 12, y },
        end: { x: x + 12, y },
        color: stroke,
        thickness: 0.5,
      });
      page.drawLine({
        start: { x, y: y - 12 },
        end: { x, y: y + 12 },
        color: stroke,
        thickness: 0.5,
      });
    }
  page.drawLine({
    start: { x: w / 2 - 12, y: h / 2 },
    end: { x: w / 2 + 12, y: h / 2 },
    color: stroke,
  });
  page.drawLine({
    start: { x: w / 2, y: h / 2 - 12 },
    end: { x: w / 2, y: h / 2 + 12 },
    color: stroke,
  });
  for (let x = mmToPt(20); x < w - mmToPt(15); x += mmToPt(10))
    page.drawLine({
      start: { x, y: mmToPt(7) },
      end: { x, y: mmToPt(x % mmToPt(50) < 1 ? 14 : 11) },
      color: stroke,
      thickness: 0.4,
    });
}
