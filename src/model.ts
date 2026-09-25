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
    paper: paperFromPreset("A4", "landscape"),
    objects: [
      {
        ...makeObject("表 彰 状"),
        x: 87,
        y: 26,
        width: 123,
        height: 23,
        fontSize: 32,
      },
      {
        ...makeObject("{学校名}　{学年}年", "merge"),
        x: 80,
        y: 68,
        width: 137,
        height: 11,
        fontSize: 15,
      },
      {
        ...makeObject("{氏名}　殿", "merge"),
        x: 75,
        y: 86,
        width: 147,
        height: 20,
        fontSize: 27,
      },
      {
        ...makeObject(
          "あなたは{賞名}において\n優秀な成績を収めましたので\nここに表彰します",
          "merge",
        ),
        x: 55,
        y: 120,
        width: 187,
        height: 43,
        fontSize: 17,
      },
      {
        ...makeObject("{日付}", "merge"),
        x: 155,
        y: 173,
        width: 91,
        height: 10,
        fontSize: 12,
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
export const mergeText = (text: string, row: DataRow) =>
  text.replace(/\{([^{}]+)\}/g, (_, field: string) => row[field] ?? "");
export const missingFields = (objects: TextObject[], columns: string[]) => [
  ...new Set(
    objects
      .flatMap((o) => [...o.text.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]))
      .filter((c) => !columns.includes(c)),
  ),
];
