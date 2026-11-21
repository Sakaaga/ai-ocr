import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type PdfPage = {
  pageNumber: number;
  blob: Blob;
  extractedText: string;
};

type ForEachOptions = {
  scale: number;
  isCancelled?: () => boolean;
  onTotal?: (pageCount: number) => void;
  /** 1ページずつ描画してコールバックに渡す（全ページを一度にメモリへ載せない） */
  onPage: (page: PdfPage) => Promise<void>;
};

export async function forEachPdfPage(file: File, { scale, isCancelled, onTotal, onPage }: ForEachOptions) {
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  onTotal?.(pdf.numPages);

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    if (isCancelled?.()) break;
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const extractedText = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join(" ")
      .trim();

    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PDFページの描画に失敗しました。");

    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("ページ画像を作成できませんでした。"))), "image/png");
    });
    canvas.width = 0;
    canvas.height = 0;

    await onPage({ pageNumber, blob, extractedText });
  }
  await pdf.destroy();
}
