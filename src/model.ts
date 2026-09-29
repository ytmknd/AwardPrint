export type Orientation = "portrait" | "landscape";
export type PaperPreset =
  "A3" | "A4" | "A5" | "B4" | "B5" | "postcard" | "custom";
export type Paper = {
  preset: PaperPreset;
  orientation: Orientation;
  width: number;
  height: number;
};
export type TextObject = {
  id: string;
  kind: "fixed" | "merge";
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontId: string;
  fontSize: number;
  color: string;
  bold: boolean;
  align: "left" | "center" | "right";
  lineHeight: number;
  letterSpacing: number;
  vertical: boolean;
  rotation: number;
};
export type FontAsset = {
  id: string;
  name: string;
  data: string;
  type: "ttf" | "otf";
  embeddingAllowed: boolean;
};
export type DataRow = Record<string, string>;
export type Background = {
  name: string;
  data: string;
  page: number;
  pageCount: number;
  width: number;
  height: number;
  visible: boolean;
  opacity: number;
};
export type Project = {
  version: 1;
  name: string;
  paper: Paper;
  objects: TextObject[];
  background: Background | null;
  fonts: FontAsset[];
  columns: string[];
  rows: DataRow[];
  sourceName: string;
  sheetName: string;
  headerRow: number;
  dateFormat: "western" | "japanese" | "japaneseWeekday";
  offsetX: number;
  offsetY: number;
  grid: boolean;
  guides: boolean;
  snap: boolean;
  includePersonalData: boolean;
};
export const PAPER_SIZES: Record<
  Exclude<PaperPreset, "custom">,
  [number, number]
> = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  B4: [257, 364],
  B5: [182, 257],
  postcard: [100, 148],
};
export function paperFromPreset(
  preset: PaperPreset,
  orientation: Orientation,
  custom?: [number, number],
): Paper {
  const [short, long] =
    preset === "custom" ? (custom ?? [210, 297]) : PAPER_SIZES[preset];
  return {
    preset,
    orientation,
    width:
      orientation === "landscape"
        ? Math.max(short, long)
        : Math.min(short, long),
    height:
      orientation === "landscape"
        ? Math.min(short, long)
        : Math.max(short, long),
  };
}
export const mmToPt = (mm: number) => (mm * 72) / 25.4;
export const ptToMm = (pt: number) => (pt * 25.4) / 72;
export const roundMm = (n: number) => Math.round(n * 10) / 10;
export const uid = () => crypto.randomUUID();
export function makeObject(
  text = "新しい文字",
  kind: TextObject["kind"] = "fixed",
  at?: Partial<Pick<TextObject, "x" | "y">>,
): TextObject {
  return {
    id: uid(),
    kind,
    text,
    x: at?.x ?? 55,
    y: at?.y ?? 80,
    width: 100,
    height: 18,
    fontId: "serif",
    fontSize: 24,
    color: "#20232d",
    bold: false,
    align: "center",
    lineHeight: 1.4,
    letterSpacing: 0,
    vertical: false,
    rotation: 0,
  };
}
export const SAMPLE_CSV =
  "氏名,学校名,学年,賞名,日付\n山田太郎,西条小学校,6,優秀賞,令和8年3月15日\n佐藤花子,神拝小学校,6,最優秀賞,令和8年3月15日\n田中一郎,大町小学校,5,努力賞,令和8年3月15日";
export const sampleRows: DataRow[] = [
  {
    氏名: "山田太郎",
    学校名: "西条小学校",
    学年: "6",
    賞名: "優秀賞",
    日付: "令和8年3月15日",
  },
  {
    氏名: "佐藤花子",
    学校名: "神拝小学校",
    学年: "6",
    賞名: "最優秀賞",
    日付: "令和8年3月15日",
  },
  {
    氏名: "田中一郎",
    学校名: "大町小学校",
    学年: "5",
    賞名: "努力賞",
    日付: "令和8年3月15日",
  },
];
export function sampleProject(): Project {
  return {
    version: 1,
    name: "サンプル賞状",
    paper: paperFromPreset("A4", "portrait"),
    objects: [
      {
        ...makeObject("表 彰 状"),
        x: 35,
        y: 40,
        width: 140,
        height: 25,
        fontSize: 32,
      },
      {
        ...makeObject("{学校名}　{学年}年", "merge"),
        x: 30,
        y: 101,
        width: 150,
        height: 12,
        fontSize: 15,
      },
      {
        ...makeObject("{氏名}　殿", "merge"),
        x: 25,
        y: 122,
        width: 160,
        height: 22,
        fontSize: 27,
      },
      {
        ...makeObject(
          "あなたは{賞名}において\n優秀な成績を収めましたので\nここに表彰します",
          "merge",
        ),
        x: 25,
        y: 168,
        width: 160,
        height: 52,
        fontSize: 17,
      },
      {
        ...makeObject("{日付}", "merge"),
        x: 105,
        y: 244,
        width: 75,
        height: 12,
        fontSize: 12,
      },
      {
        ...makeObject("西条市教育委員会"),
        x: 100,
        y: 266,
        width: 80,
        height: 12,
        fontSize: 14,
      },
    ],
    background: null,
    fonts: [],
    columns: Object.keys(sampleRows[0]),
    rows: sampleRows,
    sourceName: "サンプルデータ",
    sheetName: "",
    headerRow: 1,
    dateFormat: "japanese",
    offsetX: 0,
    offsetY: 0,
    grid: false,
    guides: true,
    snap: false,
    includePersonalData: false,
  };
}
// 和暦の元号と開始日（西暦年・月・日）
const ERAS = [
  { name: "令和", abbr: "R", start: [2019, 5, 1] },
  { name: "平成", abbr: "H", start: [1989, 1, 8] },
  { name: "昭和", abbr: "S", start: [1926, 12, 25] },
  { name: "大正", abbr: "T", start: [1912, 7, 30] },
  { name: "明治", abbr: "M", start: [1868, 1, 25] },
] as const;
export const DATE_PARTS = [
  "年",
  "月",
  "日",
  "曜日",
  "元号",
  "和暦",
  "西暦",
] as const;
export type DatePart = (typeof DATE_PARTS)[number];
export type ParsedDate = {
  year: number;
  month: number;
  day: number;
  era: string;
  eraYear: number;
  japaneseSource: boolean;
};
export function parseDate(value: string): ParsedDate | null {
  const s = value.normalize("NFKC").trim();
  const sep = String.raw`\s*[年./-]\s*`;
  const jp = new RegExp(
    String.raw`^(令和|平成|昭和|大正|明治|[RHSTM])\s*(元|\d{1,2})${sep}(\d{1,2})\s*[月./-]\s*(\d{1,2})`,
    "i",
  ).exec(s);
  let year: number, month: number, day: number;
  if (jp) {
    const era = ERAS.find(
      (e) => e.name === jp[1] || e.abbr === jp[1].toUpperCase(),
    )!;
    year = era.start[0] + (jp[2] === "元" ? 1 : Number(jp[2])) - 1;
    month = Number(jp[3]);
    day = Number(jp[4]);
  } else {
    const w = new RegExp(
      String.raw`^(?:西暦)?\s*(\d{4})${sep}(\d{1,2})\s*[月./-]\s*(\d{1,2})`,
    ).exec(s);
    if (!w) return null;
    year = Number(w[1]);
    month = Number(w[2]);
    day = Number(w[3]);
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const key = year * 10000 + month * 100 + day;
  const era = ERAS.find(
    (e) => key >= e.start[0] * 10000 + e.start[1] * 100 + e.start[2],
  );
  return {
    year,
    month,
    day,
    era: era?.name ?? "",
    eraYear: era ? year - era.start[0] + 1 : year,
    japaneseSource: Boolean(jp),
  };
}
export function datePart(value: string, part: DatePart) {
  const d = parseDate(value);
  if (!d) return "";
  const eraYear = d.eraYear === 1 ? "元" : String(d.eraYear);
  switch (part) {
    case "年":
      return d.japaneseSource ? eraYear : String(d.year);
    case "月":
      return String(d.month);
    case "日":
      return String(d.day);
    case "曜日":
      return "日月火水木金土"[new Date(d.year, d.month - 1, d.day).getDay()];
    case "元号":
      return d.era;
    case "和暦":
      return eraYear;
    case "西暦":
      return String(d.year);
  }
}
// 「６年」「6年生」などから最初の数字だけを取り出す
export const NUMBER_PARTS = ["数字", "半角数字", "全角数字"] as const;
export type NumberPart = (typeof NUMBER_PARTS)[number];
export function numberPart(value: string, part: NumberPart) {
  const digits = /[0-9０-９]+/.exec(value)?.[0] ?? "";
  if (part === "数字") return digits;
  const half = digits.normalize("NFKC");
  return part === "半角数字"
    ? half
    : half.replace(/[0-9]/g, (c) =>
        String.fromCharCode(c.charCodeAt(0) + 0xfee0),
      );
}
export const hasNumberWithText = (value: string) =>
  /[0-9０-９]/.test(value) && /[^0-9０-９\s]/.test(value);
type FieldPart = DatePart | NumberPart;
// {列名} または {列名:年} {列名:数字} のような差し込み指定を列名と部分に分ける
export function parseField(spec: string): { field: string; part?: FieldPart } {
  const i = spec.lastIndexOf(":");
  const part = spec.slice(i + 1) as FieldPart;
  return i > 0 &&
    (DATE_PARTS.includes(part as DatePart) ||
      NUMBER_PARTS.includes(part as NumberPart))
    ? { field: spec.slice(0, i), part }
    : { field: spec };
}
export const mergeText = (text: string, row: DataRow) =>
  text.replace(/\{([^{}]+)\}/g, (_, spec: string) => {
    const { field, part } = parseField(spec);
    const value = row[field] ?? "";
    if (!part) return value;
    return NUMBER_PARTS.includes(part as NumberPart)
      ? numberPart(value, part as NumberPart)
      : datePart(value, part as DatePart);
  });
export const missingFields = (objects: TextObject[], columns: string[]) => [
  ...new Set(
    objects
      .flatMap((o) =>
        [...o.text.matchAll(/\{([^{}]+)\}/g)].map(
          (m) => parseField(m[1]).field,
        ),
      )
      .filter((c) => !columns.includes(c)),
  ),
];
