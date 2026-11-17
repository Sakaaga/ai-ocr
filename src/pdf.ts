import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type PdfPageResult = {
  pageNumber: number;
  blob: Blob;
  extractedText: string;
};

export async function renderPdfPages(file: File, onProgress?: (current: number, total: number) => void) {
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages: PdfPageResult[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const extractedText = textContent.items
      .map((item) => "str" in item ? item.str : "")
      .filter(Boolean)
      .join(" ")
      .trim();

    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PDFページの描画に失敗しました。");

    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("ページ画像を作成できませんでした。")), "image/png");
    });
    pages.push({ pageNumber, blob, extractedText });
    canvas.width = 0;
    canvas.height = 0;
    onProgress?.(pageNumber, pdf.numPages);
  }

  return pages;
}
