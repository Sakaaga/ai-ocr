import { useMemo, useRef, useState } from "react";
import { DEFAULT_MODEL_ID, MODEL_PRESETS } from "./models";
import { isModelCached, loadOcrEngine, recognizeImage, type RecognizedLine } from "./ocr";
import { forEachPdfPage } from "./pdf";
import {
  OPTION_LABELS,
  PRESETS,
  analyzeForAuto,
  describeOptions,
  preprocessImage,
  type PreprocessOptions,
  type Rotation,
  type ToggleKey
} from "./preprocess";

type Kind = "scan" | "image";

type PageResult = {
  id: string;
  label: string;
  kind: Kind;
  sourceBlob: Blob;
  sourceUrl: string;
  previewUrl: string;
  width: number;
  height: number;
  lines: RecognizedLine[];
  source: "ocr" | "pdf-text";
  elapsedMs: number;
  modelLabel: string;
  appliedLabels: string[];
  reasons: string[];
};

type Progress = { done: number; total: number; label: string };

type Outcome = {
  processed: Blob;
  applied: PreprocessOptions;
  reasons: string[];
  recognized: { lines: RecognizedLine[]; width: number; height: number; elapsedMs: number };
  modelLabel: string;
};

const ACCEPT = "image/png,image/jpeg,image/webp,image/bmp,application/pdf,.pdf";
const MODEL_KEY = "ai-ocr:model";
const ROTATIONS: { value: Rotation; label: string }[] = [
  { value: 0, label: "回転なし" },
  { value: 90, label: "時計回りに90°" },
  { value: 180, label: "180°" },
  { value: 270, label: "反時計回りに90°" }
];

const isPdf = (file: File) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

const textToLines = (text: string): RecognizedLine[] =>
  text.split(/\s{2,}|\n/).filter(Boolean).map((line) => ({ id: crypto.randomUUID(), text: line, score: 1, poly: [] }));

const resultFields = (outcome: Outcome) => ({
  previewUrl: URL.createObjectURL(outcome.processed),
  width: outcome.recognized.width,
  height: outcome.recognized.height,
  lines: outcome.recognized.lines,
  source: "ocr" as const,
  elapsedMs: outcome.recognized.elapsedMs,
  modelLabel: outcome.modelLabel,
  appliedLabels: describeOptions(outcome.applied),
  reasons: outcome.reasons
});

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const [pages, setPages] = useState<PageResult[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState("ファイルを追加してOCRを開始できます");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [previewMode, setPreviewMode] = useState<"processed" | "original">("processed");
  const [reasons, setReasons] = useState<string[]>([]);
  const [modelId, setModelId] = useState(() => localStorage.getItem(MODEL_KEY) ?? DEFAULT_MODEL_ID);
  const [options, setOptions] = useState<PreprocessOptions>(PRESETS[1].options);
  const [importAuto, setImportAuto] = useState(true);
  const [pdfScale, setPdfScale] = useState(2);
  const [, setCacheVersion] = useState(0);

  // 長時間の処理中でも最新の設定を参照できるようにrefに保持する
  const settingsRef = useRef({ modelId, options, importAuto, pdfScale });
  settingsRef.current = { modelId, options, importAuto, pdfScale };

  const activePage = useMemo(() => pages.find((page) => page.id === activeId) ?? pages[0], [pages, activeId]);
  const fullText = pages.map((page) => page.lines.map((line) => line.text).join("\n")).join("\n\n");
  const progressPercent = progress && progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  const addPage = (page: PageResult) => {
    setPages((old) => [...old, page]);
    setActiveId(page.id);
  };

  /** 1枚の画像に対して 判定→前処理→OCR を行う */
  const runOcr = async (source: Blob, kind: Kind, report: (label: string) => void): Promise<Outcome> => {
    const current = settingsRef.current;
    let applied = current.options;
    let notes: string[] = [];
    if (current.importAuto) {
      report("画像を自動判定しています…");
      const analysis = await analyzeForAuto(source, kind);
      applied = analysis.options;
      notes = analysis.reasons;
    }
    report("前処理をしています…");
    const processed = await preprocessImage(source, applied);
    const recognized = await recognizeImage(processed, current.modelId, report);
    setCacheVersion((v) => v + 1);
    const modelLabel = MODEL_PRESETS.find((preset) => preset.id === current.modelId)?.label ?? current.modelId;
    return { processed, applied, reasons: notes, recognized, modelLabel };
  };

  const processFiles = async (files: File[]) => {
    if (!files.length || busy) return;
    setBusy(true);
    setError("");
    cancelRef.current = false;

    const counter = { done: 0, total: files.filter((file) => !isPdf(file)).length };
    const failures: string[] = [];
    const report = (label: string) => {
      setStatus(label);
      setProgress({ done: counter.done, total: counter.total, label });
    };
    report("処理を開始しています…");

    for (const file of files) {
      if (cancelRef.current) break;
      try {
        if (isPdf(file)) {
          await forEachPdfPage(file, {
            scale: settingsRef.current.pdfScale,
            isCancelled: () => cancelRef.current,
            onTotal: (count) => {
              counter.total += count;
              report(`${file.name} を開きました（${count}ページ）`);
            },
            onPage: async ({ pageNumber, blob, extractedText }) => {
              const id = crypto.randomUUID();
              const label = `${file.name} · ${pageNumber}ページ`;
              if (extractedText.length > 12) {
                const url = URL.createObjectURL(blob);
                addPage({
                  id, label, kind: "scan", sourceBlob: blob, sourceUrl: url, previewUrl: url,
                  width: 0, height: 0, lines: textToLines(extractedText), source: "pdf-text",
                  elapsedMs: 0, modelLabel: "", appliedLabels: [], reasons: []
                });
              } else {
                const outcome = await runOcr(blob, "scan", (message) => report(`${label}：${message}`));
                addPage({
                  id, label, kind: "scan", sourceBlob: blob, sourceUrl: URL.createObjectURL(blob),
                  ...resultFields(outcome)
                });
              }
              counter.done += 1;
              report(`${label} 完了`);
            }
          });
        } else if (file.type.startsWith("image/")) {
          const outcome = await runOcr(file, "image", (message) => report(`${file.name}：${message}`));
          addPage({
            id: crypto.randomUUID(), label: file.name, kind: "image", sourceBlob: file,
            sourceUrl: URL.createObjectURL(file), ...resultFields(outcome)
          });
          counter.done += 1;
          report(`${file.name} 完了`);
        } else {
          throw new Error(`${file.name}: 対応していないファイル形式です。`);
        }
      } catch (cause) {
        failures.push(cause instanceof Error ? cause.message : `${file.name}: 処理に失敗しました。`);
        if (!isPdf(file)) counter.done += 1;
      }
    }

    setBusy(false);
    setProgress(null);
    setStatus(cancelRef.current ? "処理を停止しました" : "処理が完了しました");
    if (failures.length) setError(failures.join("\n"));
  };

  /** 既存ページを現在の設定で再認識する（元画像は保持したまま） */
  const rerunPages = async (targets: PageResult[]) => {
    if (!targets.length || busy) return;
    setBusy(true);
    setError("");
    cancelRef.current = false;

    const counter = { done: 0, total: targets.length };
    const failures: string[] = [];
    const report = (label: string) => {
      setStatus(label);
      setProgress({ done: counter.done, total: counter.total, label });
    };

    for (const page of targets) {
      if (cancelRef.current) break;
      try {
        const outcome = await runOcr(page.sourceBlob, page.kind, (message) => report(`${page.label}：${message}`));
        if (page.previewUrl !== page.sourceUrl) URL.revokeObjectURL(page.previewUrl);
        const fields = resultFields(outcome);
        setPages((old) => old.map((item) => (item.id === page.id ? { ...item, ...fields } : item)));
      } catch (cause) {
        failures.push(cause instanceof Error ? cause.message : `${page.label}: 再認識に失敗しました。`);
      }
      counter.done += 1;
      report(`${page.label} 完了`);
    }

    setBusy(false);
    setProgress(null);
    setStatus(cancelRef.current ? "処理を停止しました" : "再認識が完了しました");
    if (failures.length) setError(failures.join("\n"));
  };

  const applyAutoToActive = async () => {
    if (!activePage) return;
    setError("");
    try {
      const analysis = await analyzeForAuto(activePage.sourceBlob, activePage.kind);
      setOptions(analysis.options);
      setReasons(analysis.reasons);
      setStatus("自動判定の結果を設定に反映しました。内容を確認して再認識できます");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "自動判定に失敗しました。");
    }
  };

  const preloadModel = async () => {
    setBusy(true);
    setError("");
    setProgress({ done: 0, total: 0, label: "モデルを準備しています…" });
    try {
      await loadOcrEngine(modelId, (message) => setStatus(message));
      setStatus("モデルの準備ができました。次回以降は素早く開始できます");
    } catch (cause) {
      setError(cause instanceof Error ? `モデルの読み込みに失敗しました: ${cause.message}` : "モデルの読み込みに失敗しました。");
    } finally {
      setBusy(false);
      setProgress(null);
      setCacheVersion((v) => v + 1);
    }
  };

  const updateLine = (pageId: string, lineId: string, text: string) => {
    setPages((old) => old.map((page) => page.id !== pageId ? page : {
      ...page, lines: page.lines.map((line) => line.id === lineId ? { ...line, text } : line)
    }));
  };

  const exportText = () => download(new Blob([fullText], { type: "text/plain;charset=utf-8" }), "ocr-result.txt");

  const exportJson = () => {
    const payload = pages.map(({ label, width, height, source, modelLabel, appliedLabels, lines }) => ({
      label, width, height, source, model: modelLabel, preprocessing: appliedLabels, lines
    }));
    download(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), "ocr-result.json");
  };

  const copyText = async () => {
    await navigator.clipboard.writeText(fullText);
    setStatus("OCR結果をコピーしました");
  };

  const removePage = (id: string) => {
    const target = pages.find((page) => page.id === id);
    if (target) {
      URL.revokeObjectURL(target.sourceUrl);
      if (target.previewUrl !== target.sourceUrl) URL.revokeObjectURL(target.previewUrl);
    }
    const next = pages.filter((page) => page.id !== id);
    setPages(next);
    setActiveId(next[0]?.id ?? null);
  };

  const showOverlay = previewMode === "processed" && activePage?.source === "ocr" && activePage.width > 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="AI OCR ホーム"><span className="brand-mark">文</span><span>AI OCR</span></a>
        <div className="topbar-right"><span className="privacy-pill"><i /> ON-DEVICE</span><span className="version">MVP 0.2</span></div>
      </header>

      <section className="intro">
        <div className="eyebrow">PRIVATE DOCUMENT READER</div>
        <h1>文字を、すばやくデータに。</h1>
        <p>画像やPDFから文字を抽出。AIによる認識処理はブラウザ内で実行します。</p>
      </section>

      <section className={`dropzone ${dragging ? "dragging" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); void processFiles(Array.from(event.dataTransfer.files)); }}>
        <div className="upload-icon">↑</div>
        <h2>ファイルをドロップ</h2>
        <p>PNG、JPG、WebP、BMP、PDFに対応</p>
        <button className="primary-button" onClick={() => inputRef.current?.click()} disabled={busy}>ファイルを選択</button>
        <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden
          onChange={(event) => { if (event.target.files) void processFiles(Array.from(event.target.files)); event.target.value = ""; }} />
        <span className="upload-note">複数ファイル対応 · ファイルは外部サーバーにアップロードされません</span>
      </section>

      <section className="settings-panel" aria-label="OCRと前処理の設定">
        <div className="settings-block">
          <label className="field-label" htmlFor="model-select">OCRモデル</label>
          <div className="inline-row">
            <select id="model-select" value={modelId} disabled={busy}
              onChange={(event) => { setModelId(event.target.value); localStorage.setItem(MODEL_KEY, event.target.value); }}>
              {MODEL_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.label}{isModelCached(preset.id) ? "（取得済み）" : ""}</option>
              ))}
            </select>
            <button className="secondary-button" onClick={() => void preloadModel()} disabled={busy}>事前読み込み</button>
          </div>
          <span className="hint">{MODEL_PRESETS.find((preset) => preset.id === modelId)?.note}</span>
        </div>

        <div className="settings-block">
          <span className="field-label">前処理プリセット</span>
          <div className="chip-row">
            {PRESETS.map((preset) => (
              <button key={preset.id} className="chip" disabled={busy}
                onClick={() => { setOptions(preset.options); setReasons([]); }}>{preset.label}</button>
            ))}
          </div>
          <div className="inline-row">
            <button className="primary-button small" onClick={() => void applyAutoToActive()} disabled={!activePage || busy}>
              自動判定して設定
            </button>
            <label className="checkbox">
              <input type="checkbox" checked={importAuto} onChange={(event) => setImportAuto(event.target.checked)} />
              取り込み時に自動判定
            </label>
          </div>
          {reasons.length > 0 && <ul className="reason-list">{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
        </div>

        <div className="settings-block wide">
          <span className="field-label">前処理の項目</span>
          <div className="option-grid">
            {(Object.keys(OPTION_LABELS) as ToggleKey[]).map((key) => (
              <label key={key} className={`option-card ${options[key] ? "on" : ""}`}>
                <input type="checkbox" checked={options[key]} disabled={busy}
                  onChange={(event) => setOptions((old) => ({ ...old, [key]: event.target.checked }))} />
                <span><strong>{OPTION_LABELS[key].label}</strong><small>{OPTION_LABELS[key].hint}</small></span>
              </label>
            ))}
          </div>
          <div className="inline-row">
            <label className="field-inline">回転
              <select value={options.rotation} disabled={busy}
                onChange={(event) => setOptions((old) => ({ ...old, rotation: Number(event.target.value) as Rotation }))}>
                {ROTATIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="field-inline">PDFの画質
              <select value={pdfScale} disabled={busy} onChange={(event) => setPdfScale(Number(event.target.value))}>
                <option value={2}>標準</option>
                <option value={3}>高精細（処理は遅くなります）</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      <div className="status-block">
        <div className="status-row"><span className={busy ? "spinner" : "status-dot"} />{status}</div>
        {progress && (
          <div className="progress-wrap" role="progressbar" aria-label="処理の進捗" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
            <div className="progress-meta">
              <span>{progress.label}</span>
              <span>{progress.total ? `${progress.done} / ${progress.total} ページ` : ""}</span>
            </div>
            <div className={`progress-track ${progress.total ? "" : "indeterminate"}`}>
              <div className="progress-fill" style={{ width: `${progress.total ? progressPercent : 100}%` }} />
            </div>
            {busy && <button className="secondary-button small" onClick={() => { cancelRef.current = true; }}>停止</button>}
          </div>
        )}
      </div>
      {error && <div className="error-banner" role="alert">{error}</div>}

      <section className="workspace">
        <aside className="panel file-panel">
          <div className="panel-heading"><h3>ドキュメント</h3><span>{pages.length} ページ</span></div>
          {pages.length === 0 ? <div className="empty-small">読み込んだファイルは<br />ここに表示されます。</div> :
            <ul className="page-list">{pages.map((page, index) => <li key={page.id}>
              <button className={`page-button ${activePage?.id === page.id ? "selected" : ""}`} onClick={() => setActiveId(page.id)}>
                <span className="page-number">{String(index + 1).padStart(2, "0")}</span><span className="page-name">{page.label}</span>
              </button>
              <button className="remove-button" title="削除" disabled={busy} onClick={() => removePage(page.id)}>×</button>
            </li>)}</ul>}
          {pages.length > 0 && <div className="file-actions">
            <button className="secondary-button small full" onClick={() => void rerunPages(pages)} disabled={busy}>全ページを再認識</button>
          </div>}
        </aside>

        <section className="panel preview-panel">
          <div className="panel-heading">
            <h3>プレビュー</h3>
            {activePage?.source === "ocr" ? (
              <div className="mini-toggle">
                <button className={previewMode === "processed" ? "on" : ""} onClick={() => setPreviewMode("processed")}>前処理後</button>
                <button className={previewMode === "original" ? "on" : ""} onClick={() => setPreviewMode("original")}>元画像</button>
              </div>
            ) : <span>{activePage ? "PDFテキスト抽出" : "ファイル未選択"}</span>}
          </div>
          {activePage ? <div className="preview-canvas"><div className="preview-image-wrap">
            <img src={previewMode === "original" ? activePage.sourceUrl : activePage.previewUrl} alt="読み込んだページ" />
            {showOverlay && <svg className="ocr-overlay" viewBox={`0 0 ${activePage.width} ${activePage.height}`} preserveAspectRatio="none" aria-label="OCR認識領域">
              {activePage.lines.map((line) => line.poly.length > 0 && <polygon key={line.id} points={line.poly.map(([x, y]) => `${x},${y}`).join(" ")} />)}
            </svg>}
          </div></div> :
            <div className="preview-empty"><div className="document-icon">▧</div><span>プレビューがここに表示されます</span></div>}
        </section>

        <section className="panel result-panel">
          <div className="panel-heading"><h3>認識結果</h3><span>{activePage?.lines.length ?? 0} 行</span></div>
          {activePage ? <div className="result-content">
            <div className="result-meta">
              {activePage.source === "ocr" ? `${activePage.modelLabel} · ${activePage.elapsedMs} ms` : "PDF内のテキストを抽出"} · 編集できます
            </div>
            {activePage.source === "ocr" && <>
              <div className="applied">適用: {activePage.appliedLabels.length ? activePage.appliedLabels.join("、") : "前処理なし"}</div>
              {activePage.reasons.length > 0 && <div className="applied-reasons">自動判定: {activePage.reasons.join(" / ")}</div>}
              <button className="secondary-button small rerun" onClick={() => void rerunPages([activePage])} disabled={busy}>この設定で再認識</button>
            </>}
            {activePage.lines.map((line) => <div className="result-line" key={line.id}>
              <textarea value={line.text} rows={Math.max(1, Math.min(5, Math.ceil(line.text.length / 34)))}
                onChange={(event) => updateLine(activePage.id, line.id, event.target.value)} />
              <span className="confidence">{activePage.source === "ocr" ? `${Math.round(line.score * 100)}%` : "PDF"}</span>
            </div>)}
            {activePage.lines.length === 0 && <div className="empty-small">文字は検出されませんでした。</div>}
          </div> : <div className="preview-empty"><span>OCR結果はまだありません</span></div>}
        </section>
      </section>

      <section className="export-bar">
        <div><strong>エクスポート</strong><span>認識結果をファイルに保存</span></div>
        <div className="export-actions">
          <button className="secondary-button" onClick={() => void copyText()} disabled={!pages.length}>コピー</button>
          <button className="secondary-button" onClick={exportText} disabled={!pages.length}>TXT</button>
          <button className="primary-button small" onClick={exportJson} disabled={!pages.length}>JSONを書き出す</button>
        </div>
      </section>

      <footer><span>AI OCR</span><span>画像データはこのブラウザ内で処理されます。</span><a href="https://github.com/Sakaaga/ai-ocr" target="_blank" rel="noreferrer">GitHub</a></footer>
    </main>
  );
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
