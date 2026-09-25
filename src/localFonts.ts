export type LocalFontData = {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob(): Promise<Blob>;
};
export type LocalFontChoice = { font: LocalFontData; displayName: string };
type LocalFontWindow = Window & {
  queryLocalFonts?: () => Promise<LocalFontData[]>;
};
export const supportsLocalFonts = () =>
  typeof (window as LocalFontWindow).queryLocalFonts === "function";
export async function listLocalFonts(): Promise<LocalFontData[]> {
  const query = (window as LocalFontWindow).queryLocalFonts;
  if (!query)
    throw new Error(
      "このブラウザはPCフォントの一覧取得に対応していません。TTF/OTFファイルから追加してください。",
    );
  const fonts = await query.call(window);
  return fonts.sort((a, b) => a.fullName.localeCompare(b.fullName, "ja"));
}

export async function japaneseNameFromSfnt(blob: Blob): Promise<string | null> {
  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (header.length < 12) return null;
  const numTables = new DataView(header.buffer).getUint16(4);
  if (numTables > 256 || 12 + numTables * 16 > blob.size) return null;
  const directory = new Uint8Array(
    await blob.slice(12, 12 + numTables * 16).arrayBuffer(),
  );
  const dirView = new DataView(directory.buffer);
  let nameOffset = -1;
  let nameLength = 0;
  for (let i = 0; i < numTables; i++) {
    const at = i * 16;
    if (String.fromCharCode(...directory.slice(at, at + 4)) === "name") {
      nameOffset = dirView.getUint32(at + 8);
      nameLength = dirView.getUint32(at + 12);
      break;
    }
  }
  if (
    nameOffset < 0 ||
    nameLength < 6 ||
    nameLength > 2_000_000 ||
    nameOffset + nameLength > blob.size
  )
    return null;
  const table = new Uint8Array(
    await blob.slice(nameOffset, nameOffset + nameLength).arrayBuffer(),
  );
  const view = new DataView(table.buffer);
  const count = view.getUint16(2);
  const stringsAt = view.getUint16(4);
  const candidates: { priority: number; text: string }[] = [];
  for (let i = 0; i < count && 6 + (i + 1) * 12 <= table.length; i++) {
    const at = 6 + i * 12;
    const platform = view.getUint16(at);
    const language = view.getUint16(at + 4);
    const nameId = view.getUint16(at + 6);
    if (![1, 4, 16].includes(nameId)) continue;
    if (!(
      (platform === 3 && language === 0x0411) ||
      (platform === 1 && language === 11)
    ))
      continue;
    const length = view.getUint16(at + 8);
    const offset = stringsAt + view.getUint16(at + 10);
    if (offset + length > table.length || !length) continue;
    try {
      const encoding = platform === 3 ? "utf-16be" : "shift_jis";
      const text = new TextDecoder(encoding)
        .decode(table.slice(offset, offset + length))
        .trim();
      if (/[\u3040-\u30ff\u3400-\u9fff]/u.test(text)) {
        candidates.push({
          priority: nameId === 4 ? 0 : nameId === 16 ? 1 : 2,
          text,
        });
      }
    } catch {
      /* Keep the browser-provided name when a legacy encoding is unsupported. */
    }
  }
  return candidates.sort((a, b) => a.priority - b.priority)[0]?.text ?? null;
}
