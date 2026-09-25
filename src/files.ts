import ExcelJS from "exceljs";
import Papa from "papaparse";
import type { DataRow, FontAsset, Project } from "./model";

export async function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
export async function readCsv(
  file: File,
  encoding: "auto" | "utf-8" | "shift_jis" = "auto",
): Promise<{ columns: string[]; rows: DataRow[]; encoding: string }> {
  const bytes = await file.arrayBuffer();
  let chosen = encoding;
  if (chosen === "auto") {
    const utf = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    chosen = utf.includes("\ufffd") ? "shift_jis" : "utf-8";
  }
  const source = new TextDecoder(chosen === "shift_jis" ? "shift_jis" : "utf-8")
    .decode(bytes)
    .replace(/^\ufeff/, "");
  const parsed = Papa.parse<string[]>(source, {
    delimiter: ",",
    skipEmptyLines: "greedy",
  });
  if (parsed.errors.length)
    throw new Error(`CSVの解析に失敗しました: ${parsed.errors[0].message}`);
  const [header, ...values] = parsed.data;
  const columns = (header ?? []).map((name, i) => name.trim() || `列${i + 1}`);
  if (!columns.length) throw new Error("CSVに列名がありません");
  return {
    columns,
    rows: values.map((cells) =>
      Object.fromEntries(columns.map((name, i) => [name, cells[i] ?? ""])),
    ),
    encoding: chosen,
  };
}
export type SheetData = { name: string; rows: unknown[][] };
export async function readWorkbook(file: File): Promise<SheetData[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  return workbook.worksheets.map((sheet) => ({
    name: sheet.name,
    rows: Array.from({ length: sheet.rowCount }, (_, i) => {
      const row = sheet.getRow(i + 1);
      return Array.from({ length: sheet.columnCount }, (_, c) => {
        const cell = row.getCell(c + 1);
        const value = cell.value;
        if (value instanceof Date) return value;
        if (typeof value === "number" && /^0+$/.test(cell.numFmt))
          return String(value).padStart(cell.numFmt.length, "0");
        return cell.text || value || "";
      });
    }),
  }));
}
export function formatDate(date: Date, format: Project["dateFormat"]): string {
  const year = date.getFullYear(),
    month = date.getMonth() + 1,
    day = date.getDate();
  if (format === "western") return `${year}年${month}月${day}日`;
  const era =
    year >= 2019
      ? `令和${year - 2018}`
      : year >= 1989
        ? `平成${year - 1988}`
        : `西暦${year}`;
  return `${era}年${month}月${day}日${format === "japaneseWeekday" ? `（${"日月火水木金土"[date.getDay()]}）` : ""}`;
}
export function sheetToRows(
  sheet: SheetData,
  headerRow: number,
  dateFormat: Project["dateFormat"],
): { columns: string[]; rows: DataRow[] } {
  const convert = (value: unknown): string => {
    if (value instanceof Date) return formatDate(value, dateFormat);
    if (value === null || value === undefined) return "";
    if (typeof value === "object") {
      if ("text" in value) return String(value.text);
      if ("result" in value) return convert(value.result);
    }
    return String(value);
  };
  const columns = (sheet.rows[headerRow - 1] ?? []).map(
    (value, i) => convert(value).trim() || `列${i + 1}`,
  );
  const rows = sheet.rows
    .slice(headerRow)
    .filter((cells) => cells.some((value) => convert(value) !== ""))
    .map((cells) =>
      Object.fromEntries(columns.map((name, i) => [name, convert(cells[i])])),
    );
  return { columns, rows };
}
export async function readFont(file: File): Promise<FontAsset> {
  if (!/\.(ttf|otf)$/i.test(file.name))
    throw new Error("TTFまたはOTFファイルを選択してください");
  return readFontBlob(file, file.name.replace(/\.(ttf|otf)$/i, ""));
}
export async function readFontBlob(
  blob: Blob,
  name: string,
): Promise<FontAsset> {
  const data = await fileToBase64(blob);
  const bytes = base64ToBytes(data);
  const signature = String.fromCharCode(...bytes.slice(0, 4));
  const type =
    signature === "OTTO"
      ? "otf"
      : signature === "\u0000\u0001\u0000\u0000" || signature === "true"
        ? "ttf"
        : null;
  if (!type)
    throw new Error(
      "このPCフォントの形式はPDF埋め込みに対応していません（TTF/OTFを選択してください）",
    );
  // OS/2 fsType: 0 means installable embedding. Restricted License Embedding has bit 1.
  let embeddingAllowed = true;
  const view = new DataView(bytes.buffer);
  const tableCount = view.getUint16(4);
  for (let i = 0; i < tableCount; i++) {
    const at = 12 + i * 16;
    if (at + 16 > bytes.length) break;
    if (String.fromCharCode(...bytes.slice(at, at + 4)) === "OS/2") {
      const offset = view.getUint32(at + 8);
      if (offset + 10 <= bytes.length)
        embeddingAllowed = (view.getUint16(offset + 8) & 0x0002) === 0;
      break;
    }
  }
  return {
    id: crypto.randomUUID(),
    name,
    data,
    type,
    embeddingAllowed,
  };
}
export function download(
  bytes: BlobPart,
  filename: string,
  type: string,
): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export function projectJson(project: Project): string {
  const saved = project.includePersonalData
    ? project
    : { ...project, rows: [] };
  return JSON.stringify(saved, null, 2);
}
export function exportProject(project: Project): void {
  download(
    projectJson(project),
    `${(project.name || "AwardPrint").replace(/[\\/:*?"<>|]/g, "_")}.json`,
    "application/json",
  );
}
export async function importProject(file: File): Promise<Project> {
  return parseProjectJson(await file.text());
}
export function parseProjectJson(json: string): Project {
  const data: unknown = JSON.parse(json);
  if (
    !data ||
    typeof data !== "object" ||
    !("version" in data) ||
    data.version !== 1 ||
    !("paper" in data) ||
    !data.paper ||
    typeof data.paper !== "object" ||
    !("width" in data.paper) ||
    typeof data.paper.width !== "number" ||
    !("height" in data.paper) ||
    typeof data.paper.height !== "number" ||
    !("objects" in data) ||
    !Array.isArray(data.objects) ||
    !("fonts" in data) ||
    !Array.isArray(data.fonts)
  )
    throw new Error("対応していないJSONプロジェクト形式です");
  return data as Project;
}
