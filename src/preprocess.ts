// 画像の前処理。すべてブラウザのCanvasとピクセル配列で行い、外部には送りません。

export type Rotation = 0 | 90 | 180 | 270;

export type PreprocessOptions = {
  grayscale: boolean;
  autoContrast: boolean;
  denoise: boolean;
  sharpen: boolean;
  upscale: boolean;
  binarize: boolean;
  invert: boolean;
  rotation: Rotation;
};

export type ToggleKey = Exclude<keyof PreprocessOptions, "rotation">;

export const EMPTY_OPTIONS: PreprocessOptions = {
  grayscale: false,
  autoContrast: false,
  denoise: false,
  sharpen: false,
  upscale: false,
  binarize: false,
  invert: false,
  rotation: 0
};

export const OPTION_LABELS: Record<ToggleKey, { label: string; hint: string }> = {
  grayscale: { label: "グレースケール", hint: "色を除いて文字の輪郭を見やすくします" },
  autoContrast: { label: "コントラスト補正", hint: "薄い文字やかすれた文字を強調します" },
  denoise: { label: "ノイズ除去", hint: "スキャンのごま塩ノイズや圧縮の乱れを減らします" },
  sharpen: { label: "シャープ化", hint: "ぼけた文字の輪郭を強調します" },
  upscale: { label: "小さい画像を2倍に拡大", hint: "解像度が1200px未満の画像に適用します" },
  binarize: { label: "二値化（白黒化）", hint: "背景の影やムラを除きます。写真では逆効果になることがあります" },
  invert: { label: "色を反転", hint: "白文字・暗い背景の画像に使います" }
};

export const PRESETS: { id: string; label: string; options: PreprocessOptions }[] = [
  { id: "none", label: "なし", options: EMPTY_OPTIONS },
  {
    id: "document",
    label: "書類スキャン",
    options: { ...EMPTY_OPTIONS, grayscale: true, autoContrast: true, denoise: true, binarize: true }
  },
  {
    id: "photo",
    label: "写真",
    options: { ...EMPTY_OPTIONS, grayscale: true, autoContrast: true, sharpen: true }
  },
  {
    id: "lowquality",
    label: "低画質",
    options: { ...EMPTY_OPTIONS, grayscale: true, autoContrast: true, denoise: true, sharpen: true, upscale: true }
  }
];

export function describeOptions(options: PreprocessOptions): string[] {
  const labels = (Object.keys(OPTION_LABELS) as ToggleKey[])
    .filter((key) => options[key])
    .map((key) => OPTION_LABELS[key].label);
  if (options.rotation) labels.push(`${options.rotation}°回転`);
  return labels;
}

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("キャンバスを初期化できませんでした。");
  return { canvas, ctx };
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("前処理後の画像を作成できませんでした。"))),
      "image/png"
    );
  });
}

/** 指定した前処理を適用したPNG画像を返します。 */
export async function preprocessImage(input: Blob, options: PreprocessOptions): Promise<Blob> {
  const bitmap = await createImageBitmap(input);
  const scale = options.upscale && Math.max(bitmap.width, bitmap.height) < 1200 ? 2 : 1;
  const srcW = bitmap.width * scale;
  const srcH = bitmap.height * scale;
  const quarterTurn = options.rotation === 90 || options.rotation === 270;
  const w = quarterTurn ? srcH : srcW;
  const h = quarterTurn ? srcW : srcH;

  const { canvas, ctx } = makeCanvas(w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.translate(w / 2, h / 2);
  ctx.rotate((options.rotation * Math.PI) / 180);
  ctx.drawImage(bitmap, -srcW / 2, -srcH / 2, srcW, srcH);
  bitmap.close();

  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  const needsGray = options.grayscale || options.autoContrast || options.denoise || options.sharpen || options.binarize;

  if (needsGray) {
    let gray = toGray(data);
    if (options.denoise) gray = median3x3(gray, w, h);
    if (options.autoContrast) gray = stretchContrast(gray);
    if (options.sharpen) gray = sharpen(gray, w, h);
    if (options.binarize) gray = threshold(gray, otsuStats(histogram(gray), gray.length).threshold);
    if (options.invert) for (let i = 0; i < gray.length; i += 1) gray[i] = 255 - gray[i];
    writeGray(data, gray);
  } else if (options.invert) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i];
      data[i + 1] = 255 - data[i + 1];
      data[i + 2] = 255 - data[i + 2];
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvasToBlob(canvas);
}

export type AutoAnalysis = { options: PreprocessOptions; reasons: string[] };

/**
 * 画像の明るさ・コントラスト・ノイズ・ぼけを簡単に調べて、前処理の設定を提案します。
 * 目安の値に基づく簡易判定なので、結果は必ず確認して調整できるようにしています。
 */
export async function analyzeForAuto(source: Blob, kind: "scan" | "image"): Promise<AutoAnalysis> {
  const bitmap = await createImageBitmap(source);
  const fullMax = Math.max(bitmap.width, bitmap.height);
  const k = Math.min(1, 800 / fullMax);
  const w = Math.max(1, Math.round(bitmap.width * k));
  const h = Math.max(1, Math.round(bitmap.height * k));
  const { ctx } = makeCanvas(w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const gray = toGray(ctx.getImageData(0, 0, w, h).data);
  const n = gray.length;
  const hist = histogram(gray);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += gray[i];
  const mean = sum / n;
  const spread = percentile(hist, n, 0.99) - percentile(hist, n, 0.01);
  const { separation } = otsuStats(hist, n);

  const smooth = median3x3(gray, w, h);
  let noise = 0;
  let edge = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const c = y * w + x;
      noise += Math.abs(gray[c] - smooth[c]);
      edge += Math.abs(4 * gray[c] - gray[c - 1] - gray[c + 1] - gray[c - w] - gray[c + w]);
    }
  }
  noise /= n;
  const edgeRatio = edge / n / Math.max(spread, 1);

  const options: PreprocessOptions = { ...EMPTY_OPTIONS, grayscale: true };
  const reasons = ["色を除いてグレースケール化"];

  if (mean < 80) {
    options.invert = true;
    reasons.push("全体が暗いため、背景が暗いと判定して反転");
  }
  if (spread < 150) {
    options.autoContrast = true;
    reasons.push("明暗の差が小さいためコントラストを補正");
  }
  if (noise > 3 && (kind === "scan" || source.type === "image/jpeg")) {
    options.denoise = true;
    reasons.push("ノイズや圧縮の乱れを検出したため除去");
  }
  if (spread > 40 && edgeRatio < 0.12) {
    options.sharpen = true;
    reasons.push("輪郭がぼけ気味のためシャープ化");
  }
  if (fullMax < 1200) {
    options.upscale = true;
    reasons.push("解像度が低いため2倍に拡大");
  }
  if (kind === "scan" && separation > 0.85) {
    options.binarize = true;
    reasons.push("文字と背景がはっきり分かれているため二値化");
  }
  return { options, reasons };
}

// ---- ピクセル処理（内部用） ----

function toGray(data: Uint8ClampedArray): Uint8Array {
  const n = data.length / 4;
  const gray = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i += 1, j += 4) {
    gray[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  }
  return gray;
}

function writeGray(data: Uint8ClampedArray, gray: Uint8Array) {
  for (let i = 0, j = 0; i < gray.length; i += 1, j += 4) {
    data[j] = gray[i];
    data[j + 1] = gray[i];
    data[j + 2] = gray[i];
    data[j + 3] = 255;
  }
}

function median3x3(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(src);
  const buf = new Uint8Array(9);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) buf[n++] = src[(y + dy) * w + x + dx];
      }
      buf.sort();
      out[y * w + x] = buf[4];
    }
  }
  return out;
}

function sharpen(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(src);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const c = y * w + x;
      const v = 5 * src[c] - src[c - 1] - src[c + 1] - src[c - w] - src[c + w];
      out[c] = Math.min(255, Math.max(0, v));
    }
  }
  return out;
}

function histogram(gray: Uint8Array): number[] {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i += 1) hist[gray[i]] += 1;
  return hist;
}

function percentile(hist: number[], n: number, p: number): number {
  const target = n * p;
  let cumulative = 0;
  for (let v = 0; v < 256; v += 1) {
    cumulative += hist[v];
    if (cumulative >= target) return v;
  }
  return 255;
}

function stretchContrast(gray: Uint8Array): Uint8Array {
  const hist = histogram(gray);
  const lo = percentile(hist, gray.length, 0.01);
  const hi = percentile(hist, gray.length, 0.99);
  if (hi - lo < 16) return gray;
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v += 1) {
    lut[v] = Math.min(255, Math.max(0, Math.round(((v - lo) * 255) / (hi - lo))));
  }
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) out[i] = lut[gray[i]];
  return out;
}

/** Otsuの方法で最適な二値化しきい値と、2クラスの分離度（0〜1）を求めます。 */
function otsuStats(hist: number[], n: number): { threshold: number; separation: number } {
  let sumAll = 0;
  for (let t = 0; t < 256; t += 1) sumAll += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxBetween = 0;
  let threshold = 127;
  let totalVar = 0;
  const mean = sumAll / n;
  for (let t = 0; t < 256; t += 1) totalVar += hist[t] * (t - mean) ** 2;
  totalVar /= n;

  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > maxBetween) {
      maxBetween = between;
      threshold = t;
    }
  }
  const separation = totalVar > 0 ? maxBetween / n / totalVar : 0;
  return { threshold, separation: Math.min(1, separation) };
}

function threshold(gray: Uint8Array, t: number): Uint8Array {
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) out[i] = gray[i] > t ? 255 : 0;
  return out;
}
