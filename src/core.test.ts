import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import fontkit from "@pdf-lib/fontkit";
import { inflateSync } from "node:zlib";
import { createPdf } from "./pdf";
import {
  parseProjectJson,
  projectJson,
  readCsv,
  readWorkbook,
  sheetToRows,
} from "./files";
import {
  alignTo,
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
  it("splits dates into year, month and day parts", () => {
    const row = {
      和暦: "令和8年3月15日",
      西暦: "2026/03/15",
      元年: "令和元年5月1日",
      略記: "Ｒ８．３．１５",
      名前: "山田",
    };
    expect(mergeText("{和暦:元号}{和暦:年}年{和暦:月}月{和暦:日}日", row)).toBe(
      "令和8年3月15日",
    );
    expect(
      mergeText("{西暦:年}|{西暦:月}|{西暦:日}|{西暦:曜日}|{西暦:和暦}", row),
    ).toBe("2026|3|15|日|8");
    expect(mergeText("{元年:年}|{元年:西暦}", row)).toBe("元|2019");
    expect(mergeText("{略記:西暦}-{略記:月}", row)).toBe("2026-3");
    expect(mergeText("[{名前:年}]", row)).toBe("[]");
    expect(mergeText("{a:b}", { "a:b": "x" })).toBe("x");
    const project = sampleProject();
    project.objects[0].text = "{日付:年}{不明:月}";
    expect(missingFields(project.objects, project.columns)).toEqual(["不明"]);
  });
  it("extracts only the number from values like ６年", () => {
    const row = { 学年: "６年", 学年2: "6年生", 空: "" };
    expect(mergeText("{学年:数字}|{学年2:数字}|{空:数字}", row)).toBe("６|6|");
    expect(mergeText("{学年:半角数字}|{学年2:全角数字}", row)).toBe("6|６");
    const project = sampleProject();
    project.objects[0].text = "{学年:数字}";
    expect(missingFields(project.objects, project.columns)).toEqual([]);
  });
  it("splits school names into name and school type", () => {
    const row = {
      a: "西条小学校",
      b: "丹原東中学校 ",
      c: "今治特別支援学校",
      d: "西条教育委員会",
    };
    expect(mergeText("{a:校名}|{a:種別}|{b:校名}|{b:種別}", row)).toBe(
      "西条|小学校|丹原東|中学校",
    );
    expect(mergeText("{c:校名}|{c:種別}", row)).toBe("今治|特別支援学校");
    expect(mergeText("{d:校名}|{d:種別}", row)).toBe("西条教育委員会|");
    expect(mergeText("{a:種別略}|{b:種別略}|{d:種別略}", row)).toBe("小|中|");
  });
  it("snaps dragged edges to the nearest guide within tolerance", () => {
    // 左端 49 → 50 に吸着、中央・右端は該当なし
    expect(alignTo([49, 59, 69], [0, 50, 105, 210], 2)).toEqual({
      delta: 1,
      lines: [50],
    });
    // 中央 104 → 用紙中央 105 のほうが近い
    expect(alignTo([97.5, 104, 110.5], [0, 99, 105, 210], 2)).toEqual({
      delta: 1,
      lines: [105],
    });
    // 同じずれ量で左右とも揃う場合は両方のガイドを出す
    expect(alignTo([10, 20, 30], [11, 31], 2)?.lines).toEqual([11, 31]);
    expect(alignTo([40], [0, 50], 2)).toBeNull();
  });
  it("opens the sample as a fully placed A4 portrait certificate", () => {
    const project = sampleProject();
    expect(project.paper).toMatchObject({
      preset: "A4",
      orientation: "portrait",
      width: 210,
      height: 297,
    });
    expect(
      project.objects.every(
        (object) =>
          object.x >= 0 &&
          object.y >= 0 &&
          object.x + object.width <= 210 &&
          object.y + object.height <= 297,
      ),
    ).toBe(true);
  });
  it("round trips the layout through JSON and excludes personal data by default", () => {
    const project = sampleProject();
    const restored = parseProjectJson(projectJson(project));
    expect(restored.paper).toEqual(project.paper);
    expect(restored.objects).toEqual(project.objects);
    expect(restored.rows).toEqual([]);
    project.includePersonalData = true;
    expect(parseProjectJson(projectJson(project)).rows).toEqual(project.rows);
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
  it("reads dates stored with Japanese Excel built-in format IDs", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("受賞者");
    sheet.addRow(["和暦", "西暦", "数値"]);
    const row = sheet.addRow([46296, 46296, 46296]);
    row.getCell(1).numFmt = "WAREKI";
    row.getCell(2).numFmt = "SEIREKI";
    // 日本語版Excelが保存したファイルと同じく、書式番号 58 / 31 だけを残して書式文字列を消す
    const zip = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
    let styles = await zip.file("xl/styles.xml")!.async("string");
    const idOf = (code: string) =>
      new RegExp(`numFmtId="(\\d+)" formatCode="${code}"`).exec(styles)![1];
    const wareki = idOf("WAREKI"),
      seireki = idOf("SEIREKI");
    styles = styles
      .replace(/<numFmt [^>]*\/>/g, "")
      .replaceAll(`numFmtId="${wareki}"`, 'numFmtId="58"')
      .replaceAll(`numFmtId="${seireki}"`, 'numFmtId="31"');
    zip.file("xl/styles.xml", styles);
    const bytes = await zip.generateAsync({ type: "arraybuffer" });
    const sheets = await readWorkbook(new File([bytes], "builtin.xlsx"));
    const parsed = sheetToRows(sheets[0], 1, "japanese");
    expect(parsed.rows[0]).toEqual({
      和暦: "令和8年10月1日",
      西暦: "令和8年10月1日",
      数値: "46296",
    });
    expect(
      mergeText("{和暦:元号}{和暦:年}|{和暦:月}|{和暦:日}", parsed.rows[0]),
    ).toBe("令和8|10|1");
  });
  it("reads Japanese-era formatted Excel dates instead of serial numbers", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("受賞者");
    sheet.addRow(["日付", "数式", "年度初日", "数値"]);
    const row = sheet.addRow([
      46296,
      { formula: "A2", result: 46296 },
      43586,
      46296,
    ]);
    row.getCell(1).numFmt = '[$-ja-JP]ggge"年"m"月"d"日"';
    row.getCell(2).numFmt = "[$-411]ggge年m月d日";
    row.getCell(3).numFmt = "yyyy/m/d";
    const bytes = await workbook.xlsx.writeBuffer();
    const sheets = await readWorkbook(new File([bytes], "era.xlsx"));
    const parsed = sheetToRows(sheets[0], 1, "japanese");
    expect(parsed.rows[0]).toEqual({
      日付: "令和8年10月1日",
      数式: "令和8年10月1日",
      年度初日: "令和元年5月1日",
      数値: "46296",
    });
  });
});

describe("PDF output", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const name = String(url).split("/").at(-1)!.split("?")[0];
      const bytes = await readFile(
        name.endsWith(".wasm")
          ? `node_modules/harfbuzzjs/dist/${name}`
          : `public/fonts/${name}`,
      );
      return new Response(bytes);
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  it("creates exact A4 landscape pages with embedded Japanese text and never includes background in print PDF", async () => {
    const project = sampleProject();
    project.paper = paperFromPreset("A4", "landscape");
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
    // フォントは文書で使う文字だけから作るため、字形番号（<...> Tj）とフォント名は文書ごとに違う。
    // それ以外（位置・大きさ・色）が同じなら、1ページ目は他の受賞者の影響を受けていない。
    const content = (doc: PDFDocument) => {
      const references = doc.getPage(0).node.Contents() as PDFArray;
      return references.asArray().map((ref) =>
        Buffer.from(
          inflateSync((doc.context.lookup(ref) as PDFRawStream).getContents()),
        )
          .toString("latin1")
          .replace(/<[0-9A-Fa-f]*>/g, "<>")
          .replace(/\/[\w-]+ ([\d.]+ Tf)/g, "/F $1"),
      );
    };
    expect(content(printAgain)).toEqual(content(print));
  }, 120_000);
  it("shifts only the background by its position adjustment", async () => {
    const project = sampleProject();
    const background = await PDFDocument.create();
    background
      .addPage([mmToPt(210), mmToPt(297)])
      .drawRectangle({ x: 10, y: 10, width: 100, height: 100 });
    project.background = {
      name: "background.pdf",
      data: Buffer.from(await background.save()).toString("base64"),
      page: 1,
      pageCount: 1,
      width: 210,
      height: 297,
      visible: true,
      opacity: 1,
    };
    // 下絵を描く行列（a b c d e f cm の e・f が位置）を取り出す
    const placement = async (withBackground: boolean) => {
      const doc = await PDFDocument.load(
        await createPdf(project, [0], withBackground),
      );
      const text = (doc.getPage(0).node.Contents() as PDFArray)
        .asArray()
        .map((ref) =>
          Buffer.from(
            inflateSync(
              (doc.context.lookup(ref) as PDFRawStream).getContents(),
            ),
          ).toString("latin1"),
        )
        .join("\n");
      // pdf-lib は下絵の前に「gs」の直後で位置の行列を出す
      const m = / gs\n1 0 0 1 ([-\d.]+) ([-\d.]+) cm/.exec(text);
      return { text, e: Number(m?.[1]), f: Number(m?.[2]) };
    };
    const before = await placement(true);
    const printBefore = await placement(false);
    project.background.offsetX = 2;
    project.background.offsetY = 3;
    const after = await placement(true);
    expect(after.e - before.e).toBeCloseTo(mmToPt(2), 3);
    expect(after.f - before.f).toBeCloseTo(-mmToPt(3), 3);
    // 印刷用（下絵なし）の文字の位置は変わらない
    const printAfter = await placement(false);
    const normalize = (text: string) =>
      text
        .replace(/<[0-9A-Fa-f]*>/g, "<>")
        .replace(/\/[\w-]+ ([\d.]+ Tf)/g, "/F $1");
    expect(printBefore.e).toBeNaN(); // 印刷用には下絵が入らない
    expect(normalize(printAfter.text)).toBe(normalize(printBefore.text));
  }, 60_000);
  it("embeds fonts that contain an outline for every Japanese character drawn", async () => {
    const project = sampleProject();
    project.objects.push(
      { ...project.objects[0], text: "ゴシック 髙﨑", fontId: "sans" },
      { ...project.objects[0], text: "縦書き「賞」。", vertical: true },
    );
    const pdf = await PDFDocument.load(
      await createPdf(project, [0, 1, 2], false),
    );
    const embedded: { name: string; bytes: Uint8Array }[] = [];
    for (const page of pdf.getPages()) {
      const fonts = page.node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
      for (const key of fonts.keys()) {
        const cid = fonts
          .lookup(key, PDFDict)
          .lookup(PDFName.of("DescendantFonts"), PDFArray)
          .lookup(0, PDFDict);
        const descriptor = cid.lookup(PDFName.of("FontDescriptor"), PDFDict);
        const file =
          descriptor.lookup(PDFName.of("FontFile3")) ??
          descriptor.lookup(PDFName.of("FontFile2"));
        const name = String(descriptor.get(PDFName.of("FontName")));
        if (
          file instanceof PDFRawStream &&
          !embedded.some((e) => e.name === name)
        )
          embedded.push({ name, bytes: inflateSync(file.contents) });
      }
    }
    expect(embedded.length).toBe(2); // 太字の明朝とゴシック
    // 3人分の差し込み結果と追加した文字（縦書きの約物は縦用の字形で描かれる）
    const drawn =
      "西条大町神拝小山田太郎佐藤花子田中一殿令和ゴシック髙﨑縦書き﹁賞﹂︒";
    const covered = new Set<string>();
    for (const { bytes } of embedded) {
      const font = fontkit.create(bytes);
      for (const char of drawn) {
        const glyph = font.glyphForCodePoint(char.codePointAt(0)!);
        if (glyph.id !== 0 && glyph.path.toSVG().length > 0) covered.add(char);
      }
    }
    expect([...drawn].filter((char) => !covered.has(char))).toEqual([]);
  }, 30_000);
  it("finishes the test-mark PDF and records whose merged text is empty", async () => {
    const project = sampleProject();
    const marks = await PDFDocument.load(
      await createPdf(project, [0], false, undefined, true),
    );
    expect(marks.getPageCount()).toBe(1);
    project.rows = [{ 氏名: "", 学校名: "", 学年: "", 日付: "" }];
    project.objects = project.objects.filter((o) => o.kind === "merge");
    const blank = await PDFDocument.load(await createPdf(project, [0], false));
    expect(blank.getPageCount()).toBe(1);
  }, 20_000);
  it("renders vertical writing and print offset without changing paper size", async () => {
    const project = sampleProject();
    project.objects = [
      {
        ...project.objects[0],
        text: "「表彰状。」",
        vertical: true,
        x: 20,
        y: 20,
      },
    ];
    project.offsetX = 1.5;
    project.offsetY = -0.5;
    const bytes = await createPdf(project, [0], false);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPage(0).getSize()).toEqual({
      width: mmToPt(210),
      height: mmToPt(297),
    });
    expect(bytes.length).toBeGreaterThan(1000);
  }, 120_000);
});
