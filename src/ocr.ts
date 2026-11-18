import { PaddleOCR } from "@paddleocr/paddleocr-js";
import { DEFAULT_MODEL_ID, MODEL_PRESETS, type ModelPreset } from "./models";

export type RecognizedLine = {
  id: string;
  text: string;
  score: number;
  poly: number[][];
};

type Engine = Awaited<ReturnType<typeof PaddleOCR.create>>;

// モデルごとにエンジンを1つだけ作って使い回します（同じモデルを2回読み込まない）。
const engines = new Map<string, Promise<Engine>>();
const LOADED_KEY = "ai-ocr:loaded-models";

export function getPreset(id: string): ModelPreset {
  return MODEL_PRESETS.find((preset) => preset.id === id)
    ?? MODEL_PRESETS.find((preset) => preset.id === DEFAULT_MODEL_ID)
    ?? MODEL_PRESETS[0];
}

/** 一度でも読み込みに成功したモデルかどうか（UI表示の目安。実際のキャッシュはService Workerが担当） */
export function isModelCached(id: string): boolean {
  try {
    const list: string[] = JSON.parse(localStorage.getItem(LOADED_KEY) ?? "[]");
    return list.includes(id);
  } catch {
    return false;
  }
}

function markLoaded(id: string) {
  try {
    const list: string[] = JSON.parse(localStorage.getItem(LOADED_KEY) ?? "[]");
    if (!list.includes(id)) localStorage.setItem(LOADED_KEY, JSON.stringify([...list, id]));
  } catch {
    // localStorage が使えない環境では表示だけ諦める
  }
}

export function loadOcrEngine(modelId: string, onStatus?: (message: string) => void): Promise<Engine> {
  const preset = getPreset(modelId);
  const existing = engines.get(preset.id);
  if (existing) return existing;

  onStatus?.(`${preset.label} を読み込んでいます…`);
  const created = PaddleOCR.create({
    ...preset.options,
    worker: true,
    ortOptions: { backend: "auto" }
  } as unknown as Parameters<typeof PaddleOCR.create>[0])
    .then((engine) => {
      markLoaded(preset.id);
      return engine;
    })
    .catch((error: unknown) => {
      engines.delete(preset.id);
      throw error;
    });
  engines.set(preset.id, created);
  return created;
}

export async function recognizeImage(
  input: Blob,
  modelId: string,
  onStatus?: (message: string) => void
): Promise<{ lines: RecognizedLine[]; width: number; height: number; elapsedMs: number }> {
  const engine = await loadOcrEngine(modelId, onStatus);
  onStatus?.("文字を認識しています…");
  const started = performance.now();
  const [result] = await engine.predict(input);
  const lines = result.items.map((item) => ({
    id: crypto.randomUUID(),
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
