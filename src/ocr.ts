import { PaddleOCR } from "@paddleocr/paddleocr-js";

export type RecognizedLine = {
  id: string;
  text: string;
  score: number;
  poly: number[][];
};

let enginePromise: Promise<Awaited<ReturnType<typeof PaddleOCR.create>>> | null = null;

export function loadOcrEngine(onStatus?: (message: string) => void) {
  if (!enginePromise) {
    onStatus?.("OCRエンジンとモデルを準備しています…");
    enginePromise = PaddleOCR.create({
      lang: "japan",
      ocrVersion: "PP-OCRv6",
      worker: true,
      ortOptions: { backend: "auto" }
    }).catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

export async function recognizeImage(
  input: Blob,
  onStatus?: (message: string) => void
): Promise<{ lines: RecognizedLine[]; width: number; height: number; elapsedMs: number }> {
  const engine = await loadOcrEngine(onStatus);
  onStatus?.("文字を認識しています…");
  const started = performance.now();
  const [result] = await engine.predict(input);
  const lines = result.items.map((item, index) => ({
    id: crypto.randomUUID?.() ?? `line-${index}-${Date.now()}`,
    text: item.text,
    score: item.score,
    poly: item.poly
  }));
  return {
    lines,
    width: result.image.width,
    height: result.image.height,
    elapsedMs: Math.round(performance.now() - started)
  };
}
