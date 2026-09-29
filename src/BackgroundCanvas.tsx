import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { base64ToBytes } from "./files";
import type { Background } from "./model";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export async function inspectPdf(data: string, pageNumber = 1) {
  const doc = await pdfjs.getDocument({ data: base64ToBytes(data) }).promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const result = {
    pageCount: doc.numPages,
    width: (viewport.width * 25.4) / 72,
    height: (viewport.height * 25.4) / 72,
  };
  await doc.destroy();
  return result;
}
export function BackgroundCanvas({
  background,
  width,
  height,
  mmScale,
}: {
  background: Background | null;
  width: number;
  height: number;
  mmScale: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!background || !background.visible || !ref.current) return;
    let canceled = false;
    let task: ReturnType<pdfjs.PDFPageProxy["render"]> | undefined;
    let doc: pdfjs.PDFDocumentProxy | undefined;
    (async () => {
      try {
        doc = await pdfjs.getDocument({ data: base64ToBytes(background.data) })
          .promise;
        const page = await doc.getPage(background.page);
        const viewport = page.getViewport({
          scale: Math.min(
            2,
            Math.max(width / page.view[2], height / page.view[3]),
          ),
        });
        const canvas = ref.current;
        if (!canvas || canceled) return;
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        task = page.render({
          canvasContext: canvas.getContext("2d")!,
          viewport,
        });
        await task.promise;
        setError("");
      } catch (e) {
        if (!canceled) setError(String(e));
      }
    })();
    return () => {
      canceled = true;
      task?.cancel();
      void doc?.destroy();
    };
  }, [background?.data, background?.page, background?.visible, width, height]);
  if (!background?.visible) return null;
  return (
    <>
      {error && (
        <span className="absolute inset-0 p-4 text-red-600">{error}</span>
      )}
      {/* 位置調整でずらした下絵が用紙の外に出ないよう切り抜く */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <canvas
          ref={ref}
          className="absolute inset-0 h-full w-full"
          style={{
            opacity: background.opacity,
            transform: `translate(${(background.offsetX ?? 0) * mmScale}px, ${(background.offsetY ?? 0) * mmScale}px)`,
          }}
        />
      </div>
    </>
  );
}
