// OCRモデルの一覧。PaddleOCR.js の create() に渡す設定をまとめています。
// 新しいモデルを足すときはここに1件追加するだけで、UIとキャッシュに反映されます。

export type ModelPreset = {
  id: string;
  label: string;
  note: string;
  options: {
    lang: string;
    ocrVersion: string;
    textDetectionModelName?: string;
    textRecognitionModelName?: string;
  };
};

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: "japan-v6",
    label: "日本語 PP-OCRv6 (small)",
    note: "標準。精度と速度のバランスが良い推奨設定です。",
    options: { lang: "japan", ocrVersion: "PP-OCRv6" }
  },
  {
    id: "japan-v6-tiny",
    label: "日本語 PP-OCRv6 (tiny)",
    note: "最も軽量で起動が速い。古い端末や大量処理向けです。",
    options: {
      lang: "japan",
      ocrVersion: "PP-OCRv6",
      textDetectionModelName: "PP-OCRv6_tiny_det",
      textRecognitionModelName: "PP-OCRv6_tiny_rec"
    }
  },
  {
    id: "japan-v5",
    label: "日本語 PP-OCRv5",
    note: "従来世代のモデル。v6で結果が悪い場合の比較用です。",
    options: { lang: "japan", ocrVersion: "PP-OCRv5" }
  },
  {
    id: "ch-v6",
    label: "中国語（簡体字） PP-OCRv6",
    note: "簡体字の中国語と英数字の認識に向きます。",
    options: { lang: "ch", ocrVersion: "PP-OCRv6" }
  },
  {
    id: "chinese_cht-v6",
    label: "中国語（繁体字） PP-OCRv6",
    note: "繁体字の中国語と英数字の認識に向きます。",
    options: { lang: "chinese_cht", ocrVersion: "PP-OCRv6" }
  },
  {
    id: "en-v6",
    label: "英語 PP-OCRv6",
    note: "英語の文書向けです。",
    options: { lang: "en", ocrVersion: "PP-OCRv6" }
  },
  {
    id: "french-v6",
    label: "フランス語 PP-OCRv6",
    note: "フランス語（アクセント記号を含む）向けです。",
    options: { lang: "french", ocrVersion: "PP-OCRv6" }
  },
  {
    id: "german-v6",
    label: "ドイツ語 PP-OCRv6",
    note: "ドイツ語（ウムラウトを含む）向けです。",
    options: { lang: "german", ocrVersion: "PP-OCRv6" }
  }
];

export const DEFAULT_MODEL_ID = "japan-v6";
