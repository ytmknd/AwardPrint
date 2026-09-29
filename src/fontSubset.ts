import wasmUrl from "harfbuzzjs/dist/harfbuzz-subset.wasm?url";

// pdf-lib（fontkit）の「使う文字だけ埋め込む」処理は、Noto CJK のような大きな日本語フォントで
// 壊れたフォントを作り、Chrome などで日本語が表示・印刷されない。
// そのため HarfBuzz（hb-subset）で使う文字だけのフォントを作り、それを pdf-lib に丸ごと埋め込む。

type HbSubset = {
  memory: WebAssembly.Memory;
  _initialize(): void;
  malloc(size: number): number;
  free(ptr: number): void;
  hb_blob_create(
    data: number,
    length: number,
    mode: number,
    userData: number,
    destroy: number,
  ): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_length(blob: number): number;
  hb_blob_get_data(blob: number, length: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_set_add(set: number, codepoint: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_unicode_set(input: number): number;
  hb_subset_or_fail(face: number, input: number): number;
};

const HB_MEMORY_MODE_WRITABLE = 2;
let hbPromise: Promise<HbSubset> | null = null;

function loadHarfBuzz(): Promise<HbSubset> {
  hbPromise ??= (async () => {
    const response = await fetch(wasmUrl);
    if (!response.ok)
      throw new Error("フォント処理モジュールを読み込めませんでした");
    const { instance } = await WebAssembly.instantiate(
      await response.arrayBuffer(),
    );
    const hb = instance.exports as unknown as HbSubset;
    hb._initialize();
    return hb;
  })();
  hbPromise.catch(() => (hbPromise = null));
  return hbPromise;
}

/** font から text に含まれる文字だけを残したフォントファイルを作る */
export async function subsetFont(
  font: ArrayBuffer | Uint8Array,
  text: Iterable<string>,
): Promise<Uint8Array> {
  const hb = await loadHarfBuzz();
  const bytes = font instanceof Uint8Array ? font : new Uint8Array(font);
  const fontPtr = hb.malloc(bytes.byteLength);
  new Uint8Array(hb.memory.buffer).set(bytes, fontPtr);
  const blob = hb.hb_blob_create(
    fontPtr,
    bytes.byteLength,
    HB_MEMORY_MODE_WRITABLE,
    0,
    0,
  );
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);
  const input = hb.hb_subset_input_create_or_fail();
  try {
    if (!input) throw new Error("フォントの切り出しを開始できませんでした");
    const unicodes = hb.hb_subset_input_unicode_set(input);
    for (const char of text) hb.hb_set_add(unicodes, char.codePointAt(0)!);
    const subset = hb.hb_subset_or_fail(face, input);
    if (!subset) throw new Error("フォントの切り出しに失敗しました");
    const result = hb.hb_face_reference_blob(subset);
    const offset = hb.hb_blob_get_data(result, 0);
    const length = hb.hb_blob_get_length(result);
    // wasm のメモリは処理中に拡張されることがあるので、ここで改めて参照してコピーする
    const out = new Uint8Array(hb.memory.buffer, offset, length).slice();
    hb.hb_blob_destroy(result);
    hb.hb_face_destroy(subset);
    if (!out.length) throw new Error("フォントの切り出しに失敗しました");
    return out;
  } finally {
    if (input) hb.hb_subset_input_destroy(input);
    hb.hb_face_destroy(face);
    hb.free(fontPtr);
  }
}
