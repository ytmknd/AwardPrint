import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileDown,
  FileInput,
  FilePlus2,
  FileText,
  Grid3X3,
  HelpCircle,
  Menu,
  Move,
  Printer,
  Redo2,
  Ruler,
  Save,
  Settings2,
  Trash2,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { BackgroundCanvas, inspectPdf } from "./BackgroundCanvas";
import {
  download,
  exportProject,
  fileToBase64,
  importProject,
  readCsv,
  readFont,
  readFontBlob,
  readWorkbook,
  sheetToRows,
  type SheetData,
} from "./files";
import {
  japaneseNameFromSfnt,
  listLocalFonts,
  supportsLocalFonts,
  type LocalFontChoice,
} from "./localFonts";
import { createPdf } from "./pdf";
import {
  alignTo,
  DATE_PARTS,
  hasNumberWithText,
  isSchoolName,
  makeObject,
  SCHOOL_PARTS,
  mergeText,
  parseDate,
  missingFields,
  paperFromPreset,
  roundMm,
  sampleProject,
  type PaperPreset,
  type Project,
  type TextObject,
} from "./model";

type Dialog =
  "paper" | "data" | "print" | "export" | "open" | "fonts" | "help" | null;
// スマートガイド（mm 単位の縦線 v・横線 h）と、吸着し始める距離（画面上の px）
type Guides = { v: number[]; h: number[] };
const NO_GUIDES: Guides = { v: [], h: [] };
const GUIDE_SNAP_PX = 6;
type Drag = {
  ids: string[];
  startX: number;
  startY: number;
  original: TextObject[];
  resize?: string;
};
const dayStamp = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
};
const Button = ({
  children,
  onClick,
  active,
  title,
  disabled,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  title?: string;
  disabled?: boolean;
  className?: string;
}) => (
  <button
    title={title}
    disabled={disabled}
    onClick={onClick}
    className={`tool-button ${active ? "tool-button-active" : ""} ${className}`}
  >
    {children}
  </button>
);
const NumberInput = ({
  label,
  value,
  onChange,
  step = 0.1,
  min,
  max,
  suffix = "",
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) => (
  <label className="number-field">
    <span>{label}</span>
    <span className="input-wrap">
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <em>{suffix}</em>
    </span>
  </label>
);
const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section className="panel-section">
    <h3>{title}</h3>
    {children}
  </section>
);

export default function App() {
  const [project, setProject] = useState<Project>(sampleProject);
  const [past, setPast] = useState<Project[]>([]),
    [future, setFuture] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string[]>([]),
    [record, setRecord] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null),
    [preview, setPreview] = useState(false),
    [showBackground, setShowBackground] = useState(true);
  const [zoom, setZoom] = useState(1),
    [fit, setFit] = useState(true),
    [notice, setNotice] = useState(""),
    [dirty, setDirty] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [sheets, setSheets] = useState<SheetData[]>([]),
    [sheetIndex, setSheetIndex] = useState(0),
    [csvFile, setCsvFile] = useState<File | null>(null),
    [encoding, setEncoding] = useState<"auto" | "utf-8" | "shift_jis">("auto");
  const [scope, setScope] = useState<"current" | "all" | "range" | "selected">(
      "current",
    ),
    [range, setRange] = useState("1-3"),
    [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [exportBackground, setExportBackground] = useState(false);
  const [clipboard, setClipboard] = useState<TextObject[]>([]);
  const [localFonts, setLocalFonts] = useState<LocalFontChoice[]>([]);
  const [fontSearch, setFontSearch] = useState("");
  const [localFontError, setLocalFontError] = useState("");
  const [loadingFonts, setLoadingFonts] = useState(false);
  const [fontNameProgress, setFontNameProgress] = useState({
    done: 0,
    total: 0,
  });
  const fontQueryId = useRef(0);
  const japaneseFontNameCache = useRef(new Map<string, string>());
  const [pageWidth, setPageWidth] = useState(1000);
  // レイアウト一覧のドラッグ並べ替え（to は挿入位置）
  const [listDrag, setListDrag] = useState<{ from: number; to: number } | null>(
    null,
  );
  // 用紙上で直接編集中の枠（確定するまで履歴に積まない）
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null,
  );
  const cancelEditing = useRef(false);
  const [guides, setGuides] = useState<Guides>(NO_GUIDES);
  const pageRef = useRef<HTMLDivElement>(null),
    workspaceRef = useRef<HTMLDivElement>(null),
    dragRef = useRef<Drag | null>(null);
  const pdfInput = useRef<HTMLInputElement>(null),
    dataInput = useRef<HTMLInputElement>(null),
    fontInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null);

  const change = useCallback((fn: (p: Project) => Project) => {
    setProject((old) => {
      const next = fn(old);
      if (next !== old) {
        setPast((history) => [...history.slice(-49), old]);
        setFuture([]);
        setDirty(true);
      }
      return next;
    });
  }, []);
  const updateObject = (id: string, patch: Partial<TextObject>) =>
    change((p) => ({
      ...p,
      objects: p.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }));
  const selectedObject = project.objects.find((o) => o.id === selected[0]);
  // 列ごとに差し込める部分（日付なら年・月・日…、「６年」のような値なら数字）
  const columnParts = useMemo(() => {
    const parts = new Map<string, readonly string[]>();
    for (const c of project.columns) {
      const values = project.rows.slice(0, 5).map((r) => r[c] ?? "");
      if (values.some((v) => parseDate(v))) parts.set(c, DATE_PARTS);
      else if (values.some(isSchoolName)) parts.set(c, SCHOOL_PARTS);
      else if (values.some(hasNumberWithText)) parts.set(c, ["数字"]);
    }
    return parts;
  }, [project.columns, project.rows]);
  const finishEditing = () => {
    if (!editing) return;
    const original = project.objects.find((o) => o.id === editing.id);
    if (!cancelEditing.current && original && original.text !== editing.text)
      updateObject(editing.id, { text: editing.text });
    cancelEditing.current = false;
    setEditing(null);
  };
  const moveObject = (from: number, to: number) => {
    const target = to > from ? to - 1 : to;
    if (target === from) return;
    change((p) => {
      const objects = [...p.objects];
      const [moved] = objects.splice(from, 1);
      objects.splice(target, 0, moved);
      return { ...p, objects };
    });
  };
  const missing = useMemo(
    () => missingFields(project.objects, project.columns),
    [project.objects, project.columns],
  );
  const currentRow = project.rows[record] ?? {};
  const mmScale = pageWidth / project.paper.width;

  useEffect(() => {
    const container = workspaceRef.current;
    if (!container) return;
    const resize = () => {
      if (fit)
        setPageWidth(
          Math.min(
            container.clientWidth - 120,
            ((container.clientHeight - 130) * project.paper.width) /
              project.paper.height,
          ),
        );
      else setPageWidth(((project.paper.width * 96) / 25.4) * zoom);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [fit, zoom, project.paper]);
  useEffect(() => {
    const listener = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [dirty]);
  useEffect(() => {
    if (notice) {
      const id = setTimeout(() => setNotice(""), 6000);
      return () => clearTimeout(id);
    }
  }, [notice]);
  useEffect(() => {
    for (const font of project.fonts) {
      const face = new FontFace(
        font.id,
        `url(data:font/${font.type};base64,${font.data})`,
      );
      void face
        .load()
        .then((loaded) => document.fonts.add(loaded))
        .catch(() => setNotice(`${font.name} を表示できません`));
    }
  }, [project.fonts]);

  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [project, ...f]);
    setProject(past.at(-1)!);
    setPast(past.slice(0, -1));
    setDirty(true);
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, project]);
    setProject(future[0]);
    setFuture(future.slice(1));
    setDirty(true);
  };
  const save = () => {
    exportProject(project);
    setDirty(false);
    setNotice(
      project.includePersonalData
        ? "差し込みデータを含むJSONを保存しました"
        : "レイアウトJSONを保存しました（差し込みデータは除外）",
    );
  };
  const reset = () => {
    if (dirty && !confirm("未保存の変更があります。新規作成しますか？")) return;
    setProject({
      ...sampleProject(),
      name: "無題のプロジェクト",
      objects: [],
      rows: [],
      columns: [],
      sourceName: "",
    });
    setSelected([]);
    setPast([]);
    setFuture([]);
    setDirty(false);
    setDialog(null);
  };
  const addText = (
    text = "新しい文字",
    kind: TextObject["kind"] = "fixed",
    x?: number,
    y?: number,
  ) => {
    const obj = makeObject(text, kind, { x, y });
    change((p) => ({ ...p, objects: [...p.objects, obj] }));
    setSelected([obj.id]);
  };
  const removeSelected = () => {
    if (!selected.length) return;
    change((p) => ({
      ...p,
      objects: p.objects.filter((o) => !selected.includes(o.id)),
    }));
    setSelected([]);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        e.preventDefault();
        setClipboard(project.objects.filter((o) => selected.includes(o.id)));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        e.preventDefault();
        const copies = clipboard.map((o) => ({
          ...o,
          id: crypto.randomUUID(),
          x: roundMm(o.x + 5),
          y: roundMm(o.y + 5),
        }));
        if (copies.length) {
          change((p) => ({ ...p, objects: [...p.objects, ...copies] }));
          setSelected(copies.map((o) => o.id));
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        removeSelected();
        return;
      }
      if (e.key.startsWith("Arrow") && selected.length) {
        e.preventDefault();
        const amount = e.shiftKey ? 1 : 0.1,
          dx =
            e.key === "ArrowLeft"
              ? -amount
              : e.key === "ArrowRight"
                ? amount
                : 0,
          dy =
            e.key === "ArrowUp" ? -amount : e.key === "ArrowDown" ? amount : 0;
        change((p) => ({
          ...p,
          objects: p.objects.map((o) =>
            selected.includes(o.id)
              ? { ...o, x: roundMm(o.x + dx), y: roundMm(o.y + dy) }
              : o,
          ),
        }));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const onPdf = async (file?: File) => {
    if (!file) return;
    try {
      const data = await fileToBase64(file);
      const info = await inspectPdf(data);
      change((p) => ({
        ...p,
        background: {
          name: file.name,
          data,
          page: 1,
          ...info,
          visible: true,
          opacity: 0.7,
        },
      }));
      if (
        Math.abs(info.width - project.paper.width) > 1 ||
        Math.abs(info.height - project.paper.height) > 1
      )
        setNotice(
          `下絵は ${info.width.toFixed(1)} × ${info.height.toFixed(1)} mm です。用紙サイズとの差を確認してください。`,
        );
      else setNotice("PDF下絵を読み込みました");
    } catch (e) {
      setNotice(`PDFを読み込めません: ${String(e)}`);
    }
  };
  const onData = async (file?: File) => {
    if (!file) return;
    try {
      if (/\.xlsx$/i.test(file.name)) {
        const all = await readWorkbook(file);
        setSheets(all);
        setSheetIndex(0);
        const first = sheetToRows(all[0], 1, project.dateFormat);
        change((p) => ({
          ...p,
          ...first,
          sourceName: file.name,
          sheetName: all[0].name,
          headerRow: 1,
        }));
        setCsvFile(null);
      } else {
        setCsvFile(file);
        setSheets([]);
        const data = await readCsv(file, encoding);
        change((p) => ({
          ...p,
          columns: data.columns,
          rows: data.rows,
          sourceName: file.name,
          sheetName: "",
          headerRow: 1,
        }));
        setEncoding(data.encoding as typeof encoding);
      }
      setRecord(0);
      setDialog("data");
    } catch (e) {
      setNotice(String(e));
    }
  };
  const reloadCsv = async (value: typeof encoding) => {
    setEncoding(value);
    if (csvFile) {
      try {
        const data = await readCsv(csvFile, value);
        change((p) => ({ ...p, columns: data.columns, rows: data.rows }));
        setRecord(0);
      } catch (e) {
        setNotice(String(e));
      }
    }
  };
  const reloadSheet = (
    index: number,
    header: number,
    format: Project["dateFormat"],
  ) => {
    const parsed = sheetToRows(sheets[index], header, format);
    setSheetIndex(index);
    change((p) => ({
      ...p,
      ...parsed,
      sheetName: sheets[index].name,
      headerRow: header,
      dateFormat: format,
    }));
    setRecord(0);
  };
  const onFont = async (file?: File) => {
    if (!file) return;
    try {
      const font = await readFont(file);
      if (!font.embeddingAllowed)
        return setNotice(
          "このフォントは埋め込みが制限されているため追加できません",
        );
      change((p) => ({
        ...p,
        fonts: [...p.fonts, font],
        objects: p.objects.map((o) =>
          o.id === selected[0] ? { ...o, fontId: font.id } : o,
        ),
      }));
      setNotice(`${font.name} を追加しました`);
    } catch (e) {
      setNotice(String(e));
    }
  };
  const showLocalFonts = async () => {
    const queryId = ++fontQueryId.current;
    setDialog("fonts");
    setLoadingFonts(true);
    setLocalFontError("");
    setFontNameProgress({ done: 0, total: 0 });
    try {
      const fonts = await listLocalFonts();
      if (queryId !== fontQueryId.current) return;
      setLocalFonts(
        fonts.map((font) => ({
          font,
          displayName:
            japaneseFontNameCache.current.get(font.postscriptName) ||
            font.fullName,
        })),
      );
      setLoadingFonts(false);
      setFontNameProgress({ done: 0, total: fonts.length });
      for (let start = 0; start < fonts.length; start += 4) {
        const names = await Promise.all(
          fonts.slice(start, start + 4).map(async (font, offset) => {
            const index = start + offset;
            if (/[\u3040-\u30ff\u3400-\u9fff]/u.test(font.fullName))
              return { index, name: font.fullName };
            const cached = japaneseFontNameCache.current.get(
              font.postscriptName,
            );
            if (cached) return { index, name: cached };
            try {
              const name = await japaneseNameFromSfnt(await font.blob());
              if (name)
                japaneseFontNameCache.current.set(font.postscriptName, name);
              return { index, name };
            } catch {
              return { index, name: null };
            }
          }),
        );
        if (queryId !== fontQueryId.current) return;
        setLocalFonts((previous) =>
          previous.map((choice, index) => {
            const found = names.find((item) => item.index === index);
            return found?.name
              ? { ...choice, displayName: found.name }
              : choice;
          }),
        );
        setFontNameProgress({
          done: Math.min(start + 4, fonts.length),
          total: fonts.length,
        });
      }
    } catch (error) {
      setLocalFontError(error instanceof Error ? error.message : String(error));
    } finally {
      if (queryId === fontQueryId.current) setLoadingFonts(false);
    }
  };
  const chooseLocalFont = async (candidate: LocalFontChoice) => {
    try {
      setLoadingFonts(true);
      const asset = await readFontBlob(
        await candidate.font.blob(),
        candidate.displayName,
      );
      if (!asset.embeddingAllowed)
        throw new Error(
          "このPCフォントはPDFへの埋め込みが制限されているため選べません",
        );
      change((p) => ({
        ...p,
        fonts: [...p.fonts, asset],
        objects: p.objects.map((o) =>
          o.id === selected[0] ? { ...o, fontId: asset.id } : o,
        ),
      }));
      setDialog(null);
      setNotice(`${asset.name} を選択しました。PDFとJSONにも埋め込まれます。`);
    } catch (error) {
      setLocalFontError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingFonts(false);
    }
  };

  const pagePosition = (event: React.DragEvent | React.PointerEvent) => {
    const rect = pageRef.current!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / mmScale,
      y: (event.clientY - rect.top) / mmScale,
    };
  };
  const startDrag = (e: React.PointerEvent, id: string, resize?: string) => {
    e.stopPropagation();
    const ids = e.shiftKey
      ? selected.includes(id)
        ? selected
        : [...selected, id]
      : selected.includes(id)
        ? selected
        : [id];
    setSelected(ids);
    dragRef.current = {
      ids,
      startX: e.clientX,
      startY: e.clientY,
      original: project.objects.filter((o) => ids.includes(o.id)),
      resize,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const dragMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    let dx = (e.clientX - d.startX) / mmScale,
      dy = (e.clientY - d.startY) / mmScale;
    const grid = (v: number) =>
      project.snap ? Math.round(v / 5) * 5 : roundMm(v);
    const exact = (v: number) => Math.round(v * 100) / 100;
    let snapX = grid,
      snapY = grid;
    const left = d.resize?.includes("w") ?? false,
      right = d.resize?.includes("e") ?? false,
      top = d.resize?.includes("n") ?? false,
      bottom = d.resize?.includes("s") ?? false;
    // スマートガイド：用紙の端・中央、他の枠の端・中央に揃える（Alt を押している間は無効）
    const found: Guides = { v: [], h: [] };
    if (!e.altKey && (!d.resize || d.original.length === 1)) {
      const { width: W, height: H } = project.paper;
      const others = project.objects.filter((o) => !d.ids.includes(o.id));
      const xs = [
        0,
        W / 2,
        W,
        ...others.flatMap((o) => [o.x, o.x + o.width / 2, o.x + o.width]),
      ];
      const ys = [
        0,
        H / 2,
        H,
        ...others.flatMap((o) => [o.y, o.y + o.height / 2, o.y + o.height]),
      ];
      const x1 = Math.min(...d.original.map((o) => o.x)),
        x2 = Math.max(...d.original.map((o) => o.x + o.width)),
        y1 = Math.min(...d.original.map((o) => o.y)),
        y2 = Math.max(...d.original.map((o) => o.y + o.height));
      // ドラッグで動く辺（移動なら左・中央・右すべて、サイズ変更ならつまんだ辺だけ）
      const xEdges = d.resize
        ? [...(left ? [x1] : []), ...(right ? [x2] : [])]
        : [x1, (x1 + x2) / 2, x2];
      const yEdges = d.resize
        ? [...(top ? [y1] : []), ...(bottom ? [y2] : [])]
        : [y1, (y1 + y2) / 2, y2];
      const tolerance = GUIDE_SNAP_PX / mmScale;
      const sx = alignTo(
        xEdges.map((v) => v + dx),
        xs,
        tolerance,
      );
      const sy = alignTo(
        yEdges.map((v) => v + dy),
        ys,
        tolerance,
      );
      if (sx) {
        dx += sx.delta;
        snapX = exact;
        found.v = sx.lines;
      }
      if (sy) {
        dy += sy.delta;
        snapY = exact;
        found.h = sy.lines;
      }
    }
    setGuides(found);
    setProject((p) => ({
      ...p,
      objects: p.objects.map((o) => {
        const old = d.original.find((item) => item.id === o.id);
        if (!old) return o;
        if (!d.resize)
          return { ...o, x: snapX(old.x + dx), y: snapY(old.y + dy) };
        const nx = left ? snapX(old.x + dx) : old.x,
          ny = top ? snapY(old.y + dy) : old.y;
        return {
          ...o,
          x: nx,
          y: ny,
          width: Math.max(1, snapX(old.width + (right ? dx : left ? -dx : 0))),
          height: Math.max(
            1,
            snapY(old.height + (bottom ? dy : top ? -dy : 0)),
          ),
        };
      }),
    }));
  };
  const endDrag = () => {
    const d = dragRef.current;
    setGuides(NO_GUIDES);
    if (!d) return;
    const changed = project.objects.some((o) => {
      const old = d.original.find((x) => x.id === o.id);
      return (
        old &&
        (o.x !== old.x ||
          o.y !== old.y ||
          o.width !== old.width ||
          o.height !== old.height)
      );
    });
    if (changed) {
      setPast((p) => [
        ...p.slice(-49),
        {
          ...project,
          objects: project.objects.map(
            (o) => d.original.find((x) => x.id === o.id) ?? o,
          ),
        },
      ]);
      setFuture([]);
      setDirty(true);
    }
    dragRef.current = null;
  };
  const align = (mode: string) => {
    const objects = project.objects.filter((o) => selected.includes(o.id));
    if (objects.length < 2) return;
    const minX = Math.min(...objects.map((o) => o.x)),
      maxX = Math.max(...objects.map((o) => o.x + o.width)),
      minY = Math.min(...objects.map((o) => o.y)),
      maxY = Math.max(...objects.map((o) => o.y + o.height));
    const sorted = [...objects].sort((a, b) => a.x - b.x);
    change((p) => ({
      ...p,
      objects: p.objects.map((o) => {
        if (!selected.includes(o.id)) return o;
        const i = sorted.findIndex((s) => s.id === o.id);
        if (mode === "left") return { ...o, x: minX };
        if (mode === "center")
          return { ...o, x: roundMm((minX + maxX - o.width) / 2) };
        if (mode === "right") return { ...o, x: roundMm(maxX - o.width) };
        if (mode === "top") return { ...o, y: minY };
        if (mode === "middle")
          return { ...o, y: roundMm((minY + maxY - o.height) / 2) };
        if (mode === "bottom") return { ...o, y: roundMm(maxY - o.height) };
        return {
          ...o,
          x: roundMm(
            minX +
              i * ((maxX - minX - o.width) / Math.max(1, objects.length - 1)),
          ),
        };
      }),
    }));
  };
  const indices = () => {
    if (!project.rows.length) return [0];
    if (scope === "current") return [record];
    if (scope === "all") return project.rows.map((_, i) => i);
    if (scope === "selected")
      return selectedRows.length ? selectedRows : [record];
    const chosen = new Set<number>();
    for (const part of range.split(",")) {
      const [a, b] = part.trim().split("-").map(Number);
      if (!Number.isInteger(a) || a < 1) continue;
      for (let n = a; n <= Math.min(b || a, project.rows.length); n++)
        chosen.add(n - 1);
    }
    if (!chosen.size) throw new Error("有効な印刷範囲を入力してください");
    return [...chosen].sort((a, b) => a - b);
  };
  const generate = async (
    withBg: boolean,
    action: "download" | "print" | "test",
  ) => {
    try {
      const pages = action === "test" ? [0] : indices();
      setProgress({ done: 0, total: pages.length });
      const pdf = await createPdf(
        project,
        pages,
        withBg,
        (done, total) => setProgress({ done, total }),
        action === "test",
      );
      const filename = `AwardPrint_${withBg ? "確認用" : "印刷用"}_${dayStamp()}.pdf`;
      if (action === "download")
        download(new Uint8Array(pdf), filename, "application/pdf");
      else {
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(pdf)], { type: "application/pdf" }),
        );
        const frame = document.createElement("iframe");
        frame.style.position = "fixed";
        frame.style.width = "1px";
        frame.style.height = "1px";
        frame.style.opacity = "0";
        frame.src = url;
        document.body.append(frame);
        frame.onload = () => {
          setTimeout(() => {
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
          }, 500);
        };
        setTimeout(() => {
          frame.remove();
          URL.revokeObjectURL(url);
        }, 120_000);
      }
      setDialog(null);
      setNotice(`${pages.length} ページのPDFを生成しました`);
    } catch (e) {
      setNotice(`PDF生成エラー: ${String(e)}`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            A<span>✦</span>
          </div>
          <div>
            <strong>AwardPrint</strong>
            <small>賞状差し込み印刷</small>
          </div>
        </div>
        <div className="toolbar-group">
          <Button onClick={reset} title="新規作成">
            <FilePlus2 />
            新規
          </Button>
          <Button
            onClick={() => setDialog("open")}
            title="レイアウトのJSONを開く"
          >
            <FileInput />
            レイアウトを開く
          </Button>
          <Button onClick={save} title="レイアウトをJSONで保存（Ctrl+S）">
            <Save />
            レイアウト保存
          </Button>
          <span className="toolbar-divider" />
          <Button onClick={() => setDialog("paper")}>
            <Settings2 />
            用紙設定
          </Button>
          <Button onClick={() => pdfInput.current?.click()}>
            <Upload />
            PDF下絵
          </Button>
          <Button onClick={() => dataInput.current?.click()}>
            <FileText />
            CSV / Excel
          </Button>
        </div>
        <div className="toolbar-group right-actions">
          <Button onClick={() => setPreview((v) => !v)} active={preview}>
            <Eye />
            プレビュー
          </Button>
          <Button
            onClick={() => {
              setExportBackground(false);
              setDialog("print");
            }}
            className="primary"
          >
            <Printer />
            印刷
          </Button>
          <Button onClick={() => setDialog("export")}>
            <FileDown />
            PDF出力
          </Button>
          <Button onClick={() => setDialog("help")} title="ヘルプ">
            <HelpCircle />
          </Button>
        </div>
      </header>
      <div className="subbar">
        <div className="project-title">
          <span className="status-dot" />
          <input
            value={project.name}
            onChange={(e) => change((p) => ({ ...p, name: e.target.value }))}
            aria-label="プロジェクト名"
          />
          <span className="muted">{dirty ? "未保存の変更" : "保存済み"}</span>
        </div>
        <div className="toolbar-group">
          <Button
            onClick={undo}
            disabled={!past.length}
            title="元に戻す Ctrl+Z"
          >
            <Undo2 />
          </Button>
          <Button
            onClick={redo}
            disabled={!future.length}
            title="やり直す Ctrl+Y"
          >
            <Redo2 />
          </Button>
          <span className="toolbar-divider" />
          <Button onClick={() => addText()}>＋ 固定文字</Button>
          <Button onClick={() => addText("{氏名}", "merge")}>
            ＋ 差し込み
          </Button>
          <span className="toolbar-divider" />
          <Button
            onClick={() => change((p) => ({ ...p, grid: !p.grid }))}
            active={project.grid}
            title="グリッド"
          >
            <Grid3X3 />
          </Button>
          <Button
            onClick={() => change((p) => ({ ...p, guides: !p.guides }))}
            active={project.guides}
            title="ガイド線"
          >
            <Ruler />
          </Button>
          <Button
            onClick={() => change((p) => ({ ...p, snap: !p.snap }))}
            active={project.snap}
            title="スナップ"
          >
            吸着
          </Button>
          <Button
            onClick={() => setShowBackground((v) => !v)}
            active={showBackground}
            title="下絵の表示／非表示"
          >
            <Eye />
          </Button>
        </div>
        <div className="toolbar-group zoom-controls">
          <Button
            onClick={() => {
              setFit(false);
              setZoom((z) => Math.max(0.25, z - 0.1));
            }}
          >
            <ZoomOut />
          </Button>
          <span>
            {Math.round((pageWidth / project.paper.width / (96 / 25.4)) * 100)}%
          </span>
          <Button
            onClick={() => {
              setFit(false);
              setZoom((z) => Math.min(2, z + 0.1));
            }}
          >
            <ZoomIn />
          </Button>
          <Button onClick={() => setFit(true)}>画面に合わせる</Button>
          <Button
            onClick={() => {
              setFit(false);
              setZoom(1);
            }}
          >
            実寸
          </Button>
        </div>
      </div>
      <main className="main-grid">
        <aside className="left-panel">
          <div className="panel-heading">
            <span>差し込みフィールド</span>
            <Menu size={15} />
          </div>
          <div className="left-scroll">
            <div className="hint-card">
              <strong>フィールドを配置</strong>
              <p>フィールドを用紙にドラッグするか、クリックして追加します。</p>
            </div>
            <Section title={`利用できる列 · ${project.columns.length}`}>
              <div className="field-list">
                {project.columns.length ? (
                  project.columns.map((column, i) => (
                    <div key={`${column}-${i}`} className="field-group">
                      <button
                        draggable
                        onDragStart={(e) =>
                          e.dataTransfer.setData("text/plain", column)
                        }
                        onClick={() => addText(`{${column}}`, "merge")}
                        className="field-item"
                      >
                        <span className="field-icon">&#123; &#125;</span>
                        <span>{column}</span>
                        <span className="field-add">＋</span>
                      </button>
                      {columnParts.has(column) && (
                        <div
                          className="date-parts"
                          title="値の一部だけを差し込みます"
                        >
                          {columnParts.get(column)!.map((part) => (
                            <button
                              key={part}
                              className="date-part"
                              draggable
                              onDragStart={(e) =>
                                e.dataTransfer.setData(
                                  "text/plain",
                                  `${column}:${part}`,
                                )
                              }
                              onClick={() =>
                                addText(`{${column}:${part}}`, "merge")
                              }
                            >
                              {part}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="empty-note">
                    CSV / Excelを読み込むと列名が表示されます。
                  </p>
                )}
              </div>
            </Section>
            <Section title="データソース">
              <div className="source-box">
                <FileText size={18} />
                <div>
                  <strong>{project.sourceName || "未読み込み"}</strong>
                  <small>
                    {project.rows.length} 件 · {project.columns.length} 列
                  </small>
                </div>
              </div>
              <button className="text-link" onClick={() => setDialog("data")}>
                データ一覧を開く →
              </button>
            </Section>
            <Section title="レイアウト">
              <div className="object-list">
                {project.objects.map((o, i) => (
                  <button
                    key={o.id}
                    className={`object-list-item ${selected.includes(o.id) ? "selected" : ""} ${listDrag?.from === i ? "dragging" : ""} ${listDrag && listDrag.to === i ? "drop-before" : ""} ${listDrag && listDrag.to === i + 1 && i === project.objects.length - 1 ? "drop-after" : ""}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData(
                        "application/x-awardprint-object",
                        o.id,
                      );
                      setListDrag({ from: i, to: i });
                    }}
                    onDragOver={(e) => {
                      if (!listDrag) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const to =
                        e.clientY < rect.top + rect.height / 2 ? i : i + 1;
                      if (to !== listDrag.to) setListDrag({ ...listDrag, to });
                    }}
                    onDrop={(e) => {
                      if (!listDrag) return;
                      e.preventDefault();
                      e.stopPropagation();
                      moveObject(listDrag.from, listDrag.to);
                      setListDrag(null);
                    }}
                    onDragEnd={() => setListDrag(null)}
                    onClick={(e) =>
                      setSelected(e.shiftKey ? [...selected, o.id] : [o.id])
                    }
                  >
                    <span className="object-type">
                      {o.kind === "merge" ? "ƒ" : "T"}
                    </span>
                    <span className="truncate">
                      {o.text.replaceAll("\n", " ") || `文字 ${i + 1}`}
                    </span>
                  </button>
                ))}
              </div>
            </Section>
          </div>
        </aside>
        <section
          className="workspace"
          ref={workspaceRef}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (
              file?.type === "application/pdf" ||
              file?.name.toLowerCase().endsWith(".pdf")
            ) {
              void onPdf(file);
              return;
            }
            if (file && /\.(csv|xlsx)$/i.test(file.name)) {
              void onData(file);
              return;
            }
            const field = e.dataTransfer.getData("text/plain");
            if (field && pageRef.current) {
              const { x, y } = pagePosition(e);
              addText(`{${field}}`, "merge", roundMm(x), roundMm(y));
            }
          }}
        >
          <div className="workspace-head">
            <div>
              <span className="eyebrow">LAYOUT EDITOR</span>
              <h2>
                {preview ? "差し込みプレビュー" : "レイアウト編集"}{" "}
                <span>
                  {project.paper.preset === "custom"
                    ? "ユーザー定義"
                    : project.paper.preset}{" "}
                  · {project.paper.orientation === "landscape" ? "横" : "縦"}
                </span>
              </h2>
            </div>
            <div className="preview-nav">
              <Button
                onClick={() => setRecord((r) => Math.max(0, r - 1))}
                disabled={record === 0}
              >
                <ChevronLeft />
                前へ
              </Button>
              <span>
                <strong>{project.rows.length ? record + 1 : 0}</strong> /{" "}
                {project.rows.length} 件
              </span>
              <Button
                onClick={() =>
                  setRecord((r) => Math.min(project.rows.length - 1, r + 1))
                }
                disabled={record >= project.rows.length - 1}
              >
                次へ
                <ChevronRight />
              </Button>
            </div>
          </div>
          <div className="canvas-scroller">
            <div className="ruler-top" style={{ width: pageWidth }}>
              {Array.from(
                { length: Math.floor(project.paper.width / 10) + 1 },
                (_, i) => (
                  <span
                    key={i}
                    style={{
                      left: `${((i * 10) / project.paper.width) * 100}%`,
                    }}
                  >
                    {i * 10}
                  </span>
                ),
              )}
            </div>
            <div className="page-row">
              <div
                className="ruler-side"
                style={{
                  height:
                    (pageWidth * project.paper.height) / project.paper.width,
                }}
              >
                {Array.from(
                  { length: Math.floor(project.paper.height / 10) + 1 },
                  (_, i) => (
                    <span
                      key={i}
                      style={{
                        top: `${((i * 10) / project.paper.height) * 100}%`,
                      }}
                    >
                      {i * 10}
                    </span>
                  ),
                )}
              </div>
              <div className="paper-frame">
                <div
                  className="paper"
                  ref={pageRef}
                  style={{
                    width: pageWidth,
                    height:
                      (pageWidth * project.paper.height) / project.paper.width,
                  }}
                  onPointerDown={() => setSelected([])}
                >
                  <BackgroundCanvas
                    background={showBackground ? project.background : null}
                    width={pageWidth}
                    height={
                      (pageWidth * project.paper.height) / project.paper.width
                    }
                  />
                  {project.grid && (
                    <div
                      className="grid-overlay"
                      style={{
                        backgroundSize: `${5 * mmScale}px ${5 * mmScale}px`,
                      }}
                    />
                  )}
                  {project.guides && (
                    <>
                      <div className="center-guide vertical-guide" />
                      <div className="center-guide horizontal-guide" />
                    </>
                  )}
                  {project.objects.map((o) => {
                    const text = preview
                      ? mergeText(o.text, currentRow)
                      : o.text;
                    const maxChars = Math.max(
                      1,
                      Math.floor((o.width * 2.835) / (o.fontSize * 0.9)),
                    );
                    const lineCount = text
                      .split("\n")
                      .reduce(
                        (sum, line) =>
                          sum + Math.max(1, Math.ceil(line.length / maxChars)),
                        0,
                      );
                    const overflow = o.vertical
                      ? (text.length * o.fontSize) / 2.835 >
                        o.height *
                          Math.max(
                            1,
                            Math.floor(
                              (o.width * 2.835) / (o.fontSize * o.lineHeight),
                            ),
                          )
                      : (lineCount * o.fontSize * o.lineHeight) / 2.835 >
                        o.height + 3;
                    return (
                      <div
                        key={o.id}
                        className={`text-object ${selected.includes(o.id) ? "text-selected" : ""} ${overflow ? "text-overflow" : ""} ${o.vertical ? "text-vertical" : ""}`}
                        style={{
                          left: o.x * mmScale,
                          top: o.y * mmScale,
                          width: o.width * mmScale,
                          height: o.height * mmScale,
                          fontFamily:
                            o.fontId === "serif"
                              ? "Noto Serif CJK JP"
                              : o.fontId === "sans"
                                ? "Noto Sans CJK JP"
                                : o.fontId,
                          fontSize: (o.fontSize * mmScale * 25.4) / 72,
                          color: o.color,
                          fontWeight: o.bold ? 700 : 400,
                          textAlign: o.align,
                          lineHeight: o.lineHeight,
                          letterSpacing: `${o.letterSpacing * mmScale}px`,
                          writingMode: o.vertical
                            ? "vertical-rl"
                            : "horizontal-tb",
                          transform: `rotate(${o.rotation}deg)`,
                        }}
                        title={
                          overflow
                            ? "文字が領域を超える可能性があります"
                            : undefined
                        }
                        onPointerDown={(e) => {
                          if (editing?.id === o.id) e.stopPropagation();
                          else startDrag(e, o.id);
                        }}
                        onPointerMove={dragMove}
                        onPointerUp={endDrag}
                        onDoubleClick={() => {
                          setSelected([o.id]);
                          setEditing({ id: o.id, text: o.text });
                        }}
                      >
                        {editing?.id === o.id ? (
                          <textarea
                            className="inline-editor"
                            autoFocus
                            value={editing.text}
                            onFocus={(e) => {
                              const end = e.currentTarget.value.length;
                              e.currentTarget.setSelectionRange(end, end);
                            }}
                            onChange={(e) =>
                              setEditing({ id: o.id, text: e.target.value })
                            }
                            onBlur={finishEditing}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                e.preventDefault();
                                cancelEditing.current = true;
                                e.currentTarget.blur();
                              } else if (e.key === "Enter" && e.ctrlKey) {
                                e.preventDefault();
                                e.currentTarget.blur();
                              }
                            }}
                          />
                        ) : (
                          <div className="text-content">{text || " "}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* 選択枠とハンドルは用紙の外にはみ出しても操作できるよう、切り抜かれない別レイヤーに描く */}
                <div className="selection-layer">
                  {guides.v.map((x) => (
                    <div
                      key={`v${x}`}
                      className="smart-guide smart-guide-v"
                      style={{ left: x * mmScale }}
                    />
                  ))}
                  {guides.h.map((y) => (
                    <div
                      key={`h${y}`}
                      className="smart-guide smart-guide-h"
                      style={{ top: y * mmScale }}
                    />
                  ))}
                  {project.objects
                    .filter((o) => selected.includes(o.id))
                    .map((o) => (
                      <div
                        key={o.id}
                        className="selection-box"
                        style={{
                          left: o.x * mmScale,
                          top: o.y * mmScale,
                          width: o.width * mmScale,
                          height: o.height * mmScale,
                          transform: `rotate(${o.rotation}deg)`,
                        }}
                      >
                        {["nw", "n", "ne", "e", "se", "s", "sw", "w"].map(
                          (handle) => (
                            <span
                              key={handle}
                              className={`resize-handle handle-${handle}`}
                              onPointerDown={(e) => startDrag(e, o.id, handle)}
                              onPointerMove={dragMove}
                              onPointerUp={endDrag}
                            />
                          ),
                        )}
                      </div>
                    ))}
                </div>
              </div>
            </div>
            <div className="canvas-caption">
              <span>原点 (0, 0) は用紙の左上 · 座標単位 mm</span>
              <span>
                {project.paper.width.toFixed(1)} ×{" "}
                {project.paper.height.toFixed(1)} mm
              </span>
            </div>
          </div>
        </section>
        <aside className="right-panel">
          <div className="panel-heading">
            プロパティ <Settings2 size={15} />
          </div>
          <div className="right-scroll">
            {selectedObject ? (
              <>
                <Section title="内容">
                  <label className="stacked-label">
                    種類
                    <select
                      value={selectedObject.kind}
                      onChange={(e) =>
                        updateObject(selectedObject.id, {
                          kind: e.target.value as TextObject["kind"],
                        })
                      }
                    >
                      <option value="fixed">固定文字</option>
                      <option value="merge">差し込み文字</option>
                    </select>
                  </label>
                  <label className="stacked-label">
                    文字列
                    <textarea
                      value={selectedObject.text}
                      onChange={(e) =>
                        updateObject(selectedObject.id, {
                          text: e.target.value,
                        })
                      }
                      rows={5}
                    />
                  </label>
                  <p className="panel-tip">
                    差し込みには &#123;列名&#125; を使用します。 日付の一部は
                    &#123;日付:年&#125; &#123;日付:月&#125; &#123;日付:日&#125;
                    のように指定できます（ほかに 曜日・元号・和暦・西暦）。
                    「６年」から数字だけを取り出すには &#123;学年:数字&#125;
                    （半角数字・全角数字 も指定可）を使います。
                    「○○小学校」の「○○」だけなら &#123;学校名:校名&#125;、
                    「小学校」だけなら &#123;学校名:種別&#125;、「小」だけなら
                    &#123;学校名:種別略&#125; です。
                  </p>
                </Section>
                <Section title="位置とサイズ">
                  <div className="two-col">
                    <NumberInput
                      label="X 座標"
                      value={selectedObject.x}
                      onChange={(x) => updateObject(selectedObject.id, { x })}
                      suffix="mm"
                    />
                    <NumberInput
                      label="Y 座標"
                      value={selectedObject.y}
                      onChange={(y) => updateObject(selectedObject.id, { y })}
                      suffix="mm"
                    />
                    <NumberInput
                      label="幅"
                      value={selectedObject.width}
                      onChange={(width) =>
                        updateObject(selectedObject.id, { width })
                      }
                      min={1}
                      suffix="mm"
                    />
                    <NumberInput
                      label="高さ"
                      value={selectedObject.height}
                      onChange={(height) =>
                        updateObject(selectedObject.id, { height })
                      }
                      min={1}
                      suffix="mm"
                    />
                  </div>
                  <Button
                    onClick={() =>
                      updateObject(selectedObject.id, {
                        x: roundMm(
                          (project.paper.width - selectedObject.width) / 2,
                        ),
                        y: roundMm(
                          (project.paper.height - selectedObject.height) / 2,
                        ),
                      })
                    }
                    className="wide"
                  >
                    用紙の中央に配置
                  </Button>
                </Section>
                <Section title="文字のスタイル">
                  <label className="stacked-label">
                    フォント
                    <select
                      value={selectedObject.fontId}
                      onChange={(e) =>
                        updateObject(selectedObject.id, {
                          fontId: e.target.value,
                        })
                      }
                    >
                      <option value="serif">Noto Serif CJK JP（明朝）</option>
                      <option value="sans">Noto Sans CJK JP（ゴシック）</option>
                      {project.fonts.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="text-link"
                    onClick={() => fontInput.current?.click()}
                  >
                    ＋ TTF / OTFを追加
                  </button>
                  <button
                    className="text-link"
                    onClick={() => void showLocalFonts()}
                  >
                    ＋ PCにインストール済みのフォントから選ぶ
                  </button>
                  <div className="two-col">
                    <NumberInput
                      label="サイズ"
                      value={selectedObject.fontSize}
                      onChange={(fontSize) =>
                        updateObject(selectedObject.id, { fontSize })
                      }
                      step={1}
                      min={1}
                      suffix="pt"
                    />
                    <NumberInput
                      label="回転"
                      value={selectedObject.rotation}
                      onChange={(rotation) =>
                        updateObject(selectedObject.id, { rotation })
                      }
                      step={1}
                      suffix="°"
                    />
                    <NumberInput
                      label="字間"
                      value={selectedObject.letterSpacing}
                      onChange={(letterSpacing) =>
                        updateObject(selectedObject.id, { letterSpacing })
                      }
                      suffix="mm"
                    />
                    <NumberInput
                      label="行間"
                      value={selectedObject.lineHeight}
                      onChange={(lineHeight) =>
                        updateObject(selectedObject.id, { lineHeight })
                      }
                      step={0.1}
                      min={0.5}
                    />
                  </div>
                  <div className="inline-setting">
                    <span>文字色</span>
                    <input
                      type="color"
                      value={selectedObject.color}
                      onChange={(e) =>
                        updateObject(selectedObject.id, {
                          color: e.target.value,
                        })
                      }
                    />
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedObject.bold}
                        onChange={(e) =>
                          updateObject(selectedObject.id, {
                            bold: e.target.checked,
                          })
                        }
                      />{" "}
                      太字
                    </label>
                  </div>
                  <div className="segmented">
                    {(["left", "center", "right"] as const).map((a, i) => (
                      <button
                        key={a}
                        className={selectedObject.align === a ? "active" : ""}
                        onClick={() =>
                          updateObject(selectedObject.id, { align: a })
                        }
                      >
                        {[<AlignLeft />, <AlignCenter />, <AlignRight />][i]}
                      </button>
                    ))}
                  </div>
                  <div className="segmented text-segments">
                    <button
                      className={!selectedObject.vertical ? "active" : ""}
                      onClick={() =>
                        updateObject(selectedObject.id, { vertical: false })
                      }
                    >
                      横書き
                    </button>
                    <button
                      className={selectedObject.vertical ? "active" : ""}
                      onClick={() =>
                        updateObject(selectedObject.id, { vertical: true })
                      }
                    >
                      縦書き
                    </button>
                  </div>
                </Section>
                <Section title="操作">
                  <Button onClick={removeSelected} className="wide danger">
                    <Trash2 />
                    選択した文字を削除
                  </Button>
                </Section>
              </>
            ) : (
              <div className="selection-empty">
                <Move size={30} />
                <strong>文字を選択してください</strong>
                <p>
                  用紙上の文字をクリックすると、位置やフォントを編集できます。
                </p>
              </div>
            )}
            {selected.length > 1 && (
              <Section title="整列">
                <div className="align-grid">
                  {[
                    ["left", "左"],
                    ["center", "中央"],
                    ["right", "右"],
                    ["top", "上"],
                    ["middle", "上下中央"],
                    ["bottom", "下"],
                    ["space", "等間隔"],
                  ].map(([mode, label]) => (
                    <button key={mode} onClick={() => align(mode)}>
                      {label}
                    </button>
                  ))}
                </div>
              </Section>
            )}
            {missing.length > 0 && (
              <div className="warning-box">
                存在しないフィールド: {missing.join("、")}
              </div>
            )}
          </div>
        </aside>
      </main>
      <footer className="statusbar">
        <span>● ブラウザ内で処理 · 外部送信なし</span>
        <span>{project.objects.length} 個の文字オブジェクト</span>
        <span>{project.rows.length} 件のデータ</span>
        <span className="grow" />
        <span>矢印キー 0.1mm · Shift + 矢印 1mm</span>
      </footer>
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button onClick={() => setNotice("")}>×</button>
        </div>
      )}
      {progress && (
        <div className="progress-modal">
          <div>
            <strong>PDF生成中</strong>
            <p>
              {progress.done} / {progress.total} 件
            </p>
            <progress value={progress.done} max={progress.total} />
          </div>
        </div>
      )}
      <input
        hidden
        ref={pdfInput}
        type="file"
        accept="application/pdf,.pdf"
        onChange={(e) => {
          void onPdf(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={dataInput}
        type="file"
        accept=".csv,.xlsx"
        onChange={(e) => {
          void onData(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={fontInput}
        type="file"
        accept=".ttf,.otf"
        onChange={(e) => {
          void onFont(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={projectInput}
        type="file"
        accept=".json,.awardprint,application/json"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file)
            try {
              if (
                dirty &&
                !confirm("未保存の変更があります。JSONを読み込みますか？")
              )
                return;
              setProject(await importProject(file));
              setPast([]);
              setFuture([]);
              setSelected([]);
              setRecord(0);
              setDialog(null);
              setDirty(false);
            } catch (error) {
              setNotice(String(error));
            }
          e.target.value = "";
        }}
      />
      {dialog && (
        <div
          className="dialog-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDialog(null);
          }}
        >
          <div className={`dialog dialog-${dialog}`}>
            <div className="dialog-head">
              <h2>
                {dialog === "paper"
                  ? "用紙設定"
                  : dialog === "data"
                    ? "差し込みデータ"
                    : dialog === "print"
                      ? "印刷用PDFを作成"
                      : dialog === "export"
                        ? "PDF出力"
                        : dialog === "open"
                          ? "レイアウトを開く・保存"
                          : dialog === "fonts"
                            ? "PCのフォントを選ぶ"
                            : "使い方"}
              </h2>
              <button onClick={() => setDialog(null)}>×</button>
            </div>
            <div className="dialog-body">
              {dialog === "paper" && (
                <>
                  <div className="form-row">
                    <label>
                      用紙サイズ
                      <select
                        value={project.paper.preset}
                        onChange={(e) =>
                          change((p) => ({
                            ...p,
                            paper: paperFromPreset(
                              e.target.value as PaperPreset,
                              p.paper.orientation,
                              [p.paper.width, p.paper.height],
                            ),
                          }))
                        }
                      >
                        {[
                          "A3",
                          "A4",
                          "A5",
                          "B4",
                          "B5",
                          "postcard",
                          "custom",
                        ].map((v) => (
                          <option key={v} value={v}>
                            {v === "postcard"
                              ? "はがき"
                              : v === "custom"
                                ? "ユーザー定義"
                                : v}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      向き
                      <select
                        value={project.paper.orientation}
                        onChange={(e) =>
                          change((p) => ({
                            ...p,
                            paper: paperFromPreset(
                              p.paper.preset,
                              e.target.value as Project["paper"]["orientation"],
                              [p.paper.width, p.paper.height],
                            ),
                          }))
                        }
                      >
                        <option value="portrait">縦</option>
                        <option value="landscape">横</option>
                      </select>
                    </label>
                  </div>
                  <div className="form-row">
                    <NumberInput
                      label="幅"
                      value={project.paper.width}
                      onChange={(width) =>
                        change((p) => ({
                          ...p,
                          paper: { ...p.paper, preset: "custom", width },
                        }))
                      }
                      suffix="mm"
                    />
                    <NumberInput
                      label="高さ"
                      value={project.paper.height}
                      onChange={(height) =>
                        change((p) => ({
                          ...p,
                          paper: { ...p.paper, preset: "custom", height },
                        }))
                      }
                      suffix="mm"
                    />
                  </div>
                  <div className="form-row">
                    <NumberInput
                      label="印刷 X オフセット"
                      value={project.offsetX}
                      onChange={(offsetX) => change((p) => ({ ...p, offsetX }))}
                      suffix="mm"
                    />
                    <NumberInput
                      label="印刷 Y オフセット"
                      value={project.offsetY}
                      onChange={(offsetY) => change((p) => ({ ...p, offsetY }))}
                      suffix="mm"
                    />
                  </div>
                  {project.background && (
                    <div className="background-settings">
                      <h3>PDF下絵</h3>
                      <strong>{project.background.name}</strong>
                      <p>
                        {project.background.width.toFixed(1)} ×{" "}
                        {project.background.height.toFixed(1)} mm /{" "}
                        {project.background.pageCount} ページ
                      </p>
                      <div className="form-row">
                        <NumberInput
                          label="表示ページ"
                          value={project.background.page}
                          onChange={(page) =>
                            change((p) => ({
                              ...p,
                              background: p.background && {
                                ...p.background,
                                page: Math.max(
                                  1,
                                  Math.min(page, p.background.pageCount),
                                ),
                              },
                            }))
                          }
                          step={1}
                          min={1}
                          max={project.background.pageCount}
                        />
                        <NumberInput
                          label="透明度"
                          value={Math.round(project.background.opacity * 100)}
                          onChange={(opacity) =>
                            change((p) => ({
                              ...p,
                              background: p.background && {
                                ...p.background,
                                opacity: Math.max(
                                  0,
                                  Math.min(opacity / 100, 1),
                                ),
                              },
                            }))
                          }
                          step={5}
                          suffix="%"
                        />
                      </div>
                      <div className="form-row">
                        <Button
                          onClick={() =>
                            change((p) => ({
                              ...p,
                              paper: {
                                ...p.paper,
                                preset: "custom",
                                width: roundMm(p.background!.width),
                                height: roundMm(p.background!.height),
                                orientation:
                                  p.background!.width > p.background!.height
                                    ? "landscape"
                                    : "portrait",
                              },
                            }))
                          }
                        >
                          PDFのサイズを用紙に設定
                        </Button>
                        <Button
                          onClick={() =>
                            change((p) => ({
                              ...p,
                              background: p.background && {
                                ...p.background,
                                visible: !p.background.visible,
                              },
                            }))
                          }
                        >
                          {project.background.visible
                            ? "下絵を非表示"
                            : "下絵を表示"}
                        </Button>
                        <Button
                          onClick={() =>
                            change((p) => ({ ...p, background: null }))
                          }
                        >
                          下絵を削除
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
              {dialog === "data" && (
                <>
                  <div className="dialog-actions">
                    <Button onClick={() => dataInput.current?.click()}>
                      <Upload />
                      CSV / Excelを選択
                    </Button>
                    <span>
                      {project.sourceName || "サンプルデータ"} ·{" "}
                      {project.rows.length} 件
                    </span>
                  </div>
                  {csvFile && (
                    <label>
                      文字コード{" "}
                      <select
                        value={encoding}
                        onChange={(e) =>
                          void reloadCsv(e.target.value as typeof encoding)
                        }
                      >
                        <option value="auto">自動判定</option>
                        <option value="utf-8">UTF-8</option>
                        <option value="shift_jis">
                          Shift_JIS / Windows-31J
                        </option>
                      </select>
                    </label>
                  )}
                  {sheets.length > 0 && (
                    <div className="form-row">
                      <label>
                        シート
                        <select
                          value={sheetIndex}
                          onChange={(e) =>
                            reloadSheet(
                              Number(e.target.value),
                              project.headerRow,
                              project.dateFormat,
                            )
                          }
                        >
                          {sheets.map((s, i) => (
                            <option key={s.name} value={i}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <NumberInput
                        label="ヘッダー行"
                        value={project.headerRow}
                        onChange={(n) =>
                          reloadSheet(
                            sheetIndex,
                            Math.max(1, n),
                            project.dateFormat,
                          )
                        }
                        step={1}
                        min={1}
                      />
                      <label>
                        日付形式
                        <select
                          value={project.dateFormat}
                          onChange={(e) =>
                            reloadSheet(
                              sheetIndex,
                              project.headerRow,
                              e.target.value as Project["dateFormat"],
                            )
                          }
                        >
                          <option value="western">2026年3月15日</option>
                          <option value="japanese">令和8年3月15日</option>
                          <option value="japaneseWeekday">
                            令和8年3月15日（日）
                          </option>
                        </select>
                      </label>
                    </div>
                  )}
                  <div className="data-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>選択</th>
                          <th>No.</th>
                          {project.columns.map((c, i) => (
                            <th key={i}>{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {project.rows.slice(0, 200).map((row, i) => (
                          <tr
                            key={i}
                            className={record === i ? "current-row" : ""}
                            onClick={() => {
                              setRecord(i);
                              setPreview(true);
                            }}
                          >
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedRows.includes(i)}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  setSelectedRows((s) =>
                                    e.target.checked
                                      ? [...s, i]
                                      : s.filter((n) => n !== i),
                                  )
                                }
                              />
                            </td>
                            <td>{i + 1}</td>
                            {project.columns.map((c, j) => (
                              <td key={j}>{row[c]}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {project.rows.length > 200 && (
                    <p className="panel-tip">
                      最初の200件を表示しています。すべての行はPDF出力に使用できます。
                    </p>
                  )}
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={project.includePersonalData}
                      onChange={(e) =>
                        change((p) => ({
                          ...p,
                          includePersonalData: e.target.checked,
                        }))
                      }
                    />
                    プロジェクト保存に差し込みデータを含める
                  </label>
                  <p className="panel-tip">
                    Excelで数値化された先頭ゼロは復元できません。セルを文字列として保存してください。
                  </p>
                </>
              )}
              {(dialog === "print" || dialog === "export") && (
                <>
                  <div className="output-card">
                    <strong>
                      {dialog === "print"
                        ? "印刷用PDF · 下絵なし"
                        : exportBackground
                          ? "確認用PDF · 下絵あり"
                          : "印刷用PDF · 下絵なし"}
                    </strong>
                    <p>
                      {dialog === "print"
                        ? "賞状用紙に重ねる文字だけを印刷します。"
                        : exportBackground
                          ? "共有・確認用。PDF下絵と文字を含みます。"
                          : "実際の印刷に使う文字だけのPDFです。"}
                    </p>
                  </div>
                  {dialog === "export" && (
                    <div className="segmented text-segments">
                      <button
                        className={!exportBackground ? "active" : ""}
                        onClick={() => setExportBackground(false)}
                      >
                        印刷用 · 下絵なし
                      </button>
                      <button
                        className={exportBackground ? "active" : ""}
                        onClick={() => setExportBackground(true)}
                      >
                        確認用 · 下絵あり
                      </button>
                    </div>
                  )}
                  <label>
                    対象レコード
                    <select
                      value={scope}
                      onChange={(e) => setScope(e.target.value as typeof scope)}
                    >
                      <option value="current">現在のレコードのみ</option>
                      <option value="all">すべてのレコード</option>
                      <option value="range">指定範囲</option>
                      <option value="selected">
                        データ一覧で選択したレコード
                      </option>
                    </select>
                  </label>
                  {scope === "range" && (
                    <label>
                      範囲（例: 1-10, 12, 15-20）
                      <input
                        value={range}
                        onChange={(e) => setRange(e.target.value)}
                      />
                    </label>
                  )}
                  {scope === "selected" && (
                    <p>{selectedRows.length} 件を選択中</p>
                  )}
                  <div className="print-notice">
                    <strong>印刷前に確認</strong>
                    <ul>
                      <li>用紙サイズを確認してください。</li>
                      <li>
                        印刷倍率は「実際のサイズ」または100%にしてください。
                      </li>
                      <li>「用紙に合わせる」は使用しないでください。</li>
                      <li>プリンターの印刷可能領域を確認してください。</li>
                    </ul>
                  </div>
                  <div className="dialog-actions bottom">
                    <Button onClick={() => void generate(false, "test")}>
                      位置確認用テスト印刷
                    </Button>
                    <Button
                      className="primary"
                      onClick={() =>
                        void generate(
                          dialog === "print" ? false : exportBackground,
                          dialog === "print" ? "print" : "download",
                        )
                      }
                    >
                      {dialog === "print" ? (
                        <>
                          <Printer />
                          印刷ダイアログを開く
                        </>
                      ) : (
                        <>
                          <Download />
                          PDFを保存
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="panel-tip">
                    テスト印刷には普通紙を使用してください。ブラウザでプリンターや給紙トレイは自動選択できません。
                  </p>
                </>
              )}
              {dialog === "open" && (
                <>
                  <p>
                    レイアウトをJSONファイルから復元します。以前の .awardprint
                    ファイルも読み込めます。
                  </p>
                  <div className="dialog-actions">
                    <Button onClick={() => projectInput.current?.click()}>
                      レイアウトを開く
                    </Button>
                  </div>
                  <hr />
                  <p>現在のレイアウトをJSONファイルに保存します。</p>
                  <Button onClick={save}>
                    <Download />
                    レイアウト保存
                  </Button>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={project.includePersonalData}
                      onChange={(e) =>
                        change((p) => ({
                          ...p,
                          includePersonalData: e.target.checked,
                        }))
                      }
                    />
                    差し込みデータを保存ファイルに含める
                  </label>
                </>
              )}
              {dialog === "fonts" && (
                <>
                  <p className="panel-tip">
                    Chrome・Edgeのアクセス許可後、PCにあるフォントを表示します。選んだフォントはPDFとプロジェクトJSONに埋め込まれます。
                  </p>
                  {!supportsLocalFonts() && (
                    <div className="warning-box">
                      このブラウザはPCフォント一覧に対応していません。TTF/OTFファイルから追加してください。
                    </div>
                  )}
                  {localFontError && (
                    <div className="warning-box">{localFontError}</div>
                  )}
                  {loadingFonts && <p>フォントを読み込み中…</p>}
                  <label>
                    フォントを検索
                    <input
                      value={fontSearch}
                      onChange={(e) => setFontSearch(e.target.value)}
                      placeholder="例: 游明朝、IPA、Noto"
                    />
                  </label>
                  <p className="panel-tip">
                    {localFonts.length} 件のフォントをすべて表示します。
                    {fontNameProgress.total > 0 &&
                      fontNameProgress.done < fontNameProgress.total &&
                      ` 日本語名を確認中 ${fontNameProgress.done} / ${fontNameProgress.total} 件`}
                  </p>
                  <div className="local-font-list">
                    {localFonts
                      .filter((choice) =>
                        `${choice.displayName} ${choice.font.family} ${choice.font.fullName} ${choice.font.style}`
                          .toLocaleLowerCase()
                          .includes(fontSearch.toLocaleLowerCase()),
                      )
                      .map((choice) => (
                        <button
                          key={choice.font.postscriptName}
                          disabled={loadingFonts}
                          onClick={() => void chooseLocalFont(choice)}
                        >
                          <strong>{choice.displayName}</strong>
                          <span>
                            {choice.font.fullName !== choice.displayName
                              ? `${choice.font.fullName} · `
                              : ""}
                            {choice.font.style}
                          </span>
                        </button>
                      ))}
                  </div>
                  <Button
                    onClick={() => {
                      setDialog(null);
                      fontInput.current?.click();
                    }}
                  >
                    TTF / OTFファイルから追加
                  </Button>
                </>
              )}
              {dialog === "help" && (
                <>
                  <p>1. PDF下絵を読み込むか、サンプル賞状から始めます。</p>
                  <p>2. CSV / Excelの列名を用紙にドラッグして配置します。</p>
                  <p>
                    3.
                    右側で文字、座標、フォントを調整します。座標は用紙左上からのmmです。
                  </p>
                  <p>
                    4. レコードを切り替えて確認し、印刷用PDFから印刷します。
                  </p>
                  <p>
                    印刷用PDFに下絵は含まれません。確認用PDFには下絵が含まれます。
                  </p>
                  <Button
                    onClick={() =>
                      download(
                        "氏名,学校名,学年,賞名,日付\n山田太郎,西条小学校,6,優秀賞,令和8年3月15日\n佐藤花子,神拝小学校,6,最優秀賞,令和8年3月15日\n田中一郎,大町小学校,5,努力賞,令和8年3月15日",
                        "sample.csv",
                        "text/csv;charset=utf-8",
                      )
                    }
                  >
                    <Download />
                    サンプルCSVを保存
                  </Button>
                </>
              )}
            </div>
            <div className="dialog-footer">
              <Button onClick={() => setDialog(null)}>閉じる</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
