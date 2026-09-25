import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import ExcelJS from "exceljs";
import { createPdf } from "./pdf";
import { readCsv, readWorkbook, sheetToRows } from "./files";
import {
  mergeText,
  missingFields,
  mmToPt,
  paperFromPreset,
  sampleProject,
} from "./model";

describe("paper and merge data", () => {
  it("uses exact millimetre sizes in both orientations", () => {
    expect(paperFromPreset("A4", "portrait")).toMatchObject({
      width: 210,
      height: 297,
    });
    expect(paperFromPreset("A4", "landscape")).toMatchObject({
      width: 297,
      height: 210,
    });
    expect(paperFromPreset("A3", "landscape")).toMatchObject({
      width: 420,
      height: 297,
    });
    expect(paperFromPreset("B4", "portrait")).toMatchObject({
      width: 257,
      height: 364,
    });
    expect(paperFromPreset("custom", "landscape", [300, 205])).toMatchObject({
      width: 300,
      height: 205,
    });
    expect(mmToPt(25.4)).toBe(72);
  });
  it("merges mixed text, treats blank values as blank, and identifies unknown fields", () => {
    expect(
      mergeText("{学校名} {氏名} 殿 / {空欄}", {
        学校名: "西条小学校",
        氏名: "山田太郎",
        空欄: "",
      }),
    ).toBe("西条小学校 山田太郎 殿 / ");
    const project = sampleProject();
    project.objects[0].text = "{不存在}";
    expect(missingFields(project.objects, project.columns)).toEqual(["不存在"]);
  });
});

describe("data import", () => {
  it("reads quoted CSV with commas and embedded line breaks", async () => {
    const file = new File(
      ['\ufeff氏名,表彰文\n山田太郎,"優秀賞, 特別部門\n第1位"'],
      "test.csv",
    );
    const parsed = await readCsv(file);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].表彰文).toBe("優秀賞, 特別部門\n第1位");
  });
  it("decodes Windows Japanese CSV", async () => {
    const bytes = Uint8Array.from([
      0x8e, 0x81, 0x96, 0xbc, 0x0a, 0x8e, 0x52, 0x93, 0x63, 0x91, 0xbe, 0x98,
      0x59,
    ]);
    const parsed = await readCsv(new File([bytes], "sjis.csv"));
    expect(parsed.encoding).toBe("shift_jis");
    expect(parsed.columns[0]).toBe("氏名");
    expect(parsed.rows[0].氏名).toBe("山田太郎");
  });
  it("reads Excel sheets, dates and leading-zero display formats", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("受賞者");
    sheet.addRow(["氏名", "日付", "学籍番号"]);
    const row = sheet.addRow(["山田太郎", new Date(2026, 2, 15), 12]);
    row.getCell(3).numFmt = "0000";
    const bytes = await workbook.xlsx.writeBuffer();
    const file = new File([bytes], "test.xlsx");
    const sheets = await readWorkbook(file);
    const parsed = sheetToRows(sheets[0], 1, "japaneseWeekday");
    expect(parsed.rows[0].日付).toBe("令和8年3月15日（日）");
    expect(parsed.rows[0].学籍番号).toBe("0012");
  });
});

describe("PDF output", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const name = String(url).split("/").at(-1)!;
      const bytes = await readFile(`public/fonts/${name}`);
      return new Response(bytes);
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  it("creates exact A4 landscape pages with embedded Japanese text and never includes background in print PDF", async () => {
    const project = sampleProject();
    const background = await PDFDocument.create();
    const page = background.addPage([mmToPt(297), mmToPt(210)]);
    page.drawRectangle({ x: 10, y: 10, width: 100, height: 100 });
    const data = Buffer.from(await background.save()).toString("base64");
    project.background = {
      name: "background.pdf",
      data,
      page: 1,
      pageCount: 1,
      width: 297,
      height: 210,
      visible: true,
      opacity: 1,
    };
    const print = await PDFDocument.load(
      await createPdf(project, [0, 1, 2], false),
    );
    const confirm = await PDFDocument.load(await createPdf(project, [0], true));
    expect(print.getPageCount()).toBe(3);
    expect(print.getPage(0).getSize()).toEqual({
      width: mmToPt(297),
      height: mmToPt(210),
    });
    const xObjects = (doc: PDFDocument) =>
      doc
        .getPage(0)
        .node.Resources()
        ?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    expect(xObjects(print)?.keys().length ?? 0).toBe(0);
    expect(xObjects(confirm)?.keys().length ?? 0).toBeGreaterThan(0);
    const printAgain = await PDFDocument.load(
      await createPdf(project, [0], false),
    );
    const content = (doc: PDFDocument) => {
      const references = doc.getPage(0).node.Contents() as PDFArray;
      return references
        .asArray()
        .map((ref) =>
          Array.from((doc.context.lookup(ref) as PDFRawStream).getContents()),
        );
    };
    expect(content(printAgain)).toEqual(content(print));
  }, 120_000);
  it("renders vertical writing and print offset without changing paper size", async () => {
    const project = sampleProject();
    project.objects = [
      { ...project.objects[0], text: "「表彰状。」", vertical: true, x: 20, y: 20 },
    ];
    project.offsetX = 1.5;
    project.offsetY = -0.5;
    const bytes = await createPdf(project, [0], false);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPage(0).getSize()).toEqual({
      width: mmToPt(297),
      height: mmToPt(210),
    });
    expect(bytes.length).toBeGreaterThan(1000);
  }, 120_000);
});
