import { useCallback, useMemo, useRef, useState } from "react";
import { recognizeImage, type RecognizedLine } from "./ocr";
import { renderPdfPages } from "./pdf";

type PageResult = {
  id: string;
  label: string;
  previewUrl: string;
  width: number;
  height: number;
  lines: RecognizedLine[];
  source: "ocr" | "pdf-text";
  elapsedMs: number;
};

const ACCEPT = "image/png,image/jpeg,image/webp,image/bmp,application/pdf,.pdf";

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<PageResult[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState("ファイルを追加してOCRを開始できます");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  const activePage = useMemo(() => pages.find((page) => page.id === activeId) ?? pages[0], [pages, activeId]);
  const fullText = pages.map((page) => page.lines.map((line) => line.text).join("\n")).join("\n\n");

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (!files.length) return;
    setBusy(true);
    setError("");
    try {
      for (const file of files) {
        if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
          setStatus(`${file.name} を解析しています…`);
          const pdfPages = await renderPdfPages(file, (current, total) => setProgress(`PDFページ ${current} / ${total}`));
          for (const page of pdfPages) {
            const id = crypto.randomUUID();
            const previewUrl = URL.createObjectURL(page.blob);
            if (page.extractedText.length > 12) {
              const lines = page.extractedText.split(/\s{2,}|\n/).filter(Boolean).map((text, index) => ({
                id: `${id}-${index}`, text, score: 1, poly: []
              }));
              const result: PageResult = { id, label: `${file.name} · ${page.pageNumber}ページ`, previewUrl, width: 0, height: 0, lines, source: "pdf-text", elapsedMs: 0 };
              setPages((old) => [...old, result]);
              setActiveId(id);
            } else {
              setStatus("スキャンページをOCRしています…");
              const recognized = await recognizeImage(page.blob, setStatus);
              const result: PageResult = { id, label: `${file.name} · ${page.pageNumber}ページ`, previewUrl, ...recognized, source: "ocr" };
              setPages((old) => [...old, result]);
              setActiveId(id);
            }
          }
        } else if (file.type.startsWith("image/")) {
          const previewUrl = URL.createObjectURL(file);
          const recognized = await recognizeImage(file, setStatus);
          const id = crypto.randomUUID();
          const result: PageResult = { id, label: file.name, previewUrl, ...recognized, source: "ocr" };
          setPages((old) => [...old, result]);
          setActiveId(id);
        } else {
          throw new Error(`${file.name}: 対応していないファイル形式です。`);
        }
      }
      setStatus("処理が完了しました");
      setProgress("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "処理中にエラーが発生しました。");
      setStatus("処理に失敗しました");
    } finally {
      setBusy(false);
    }
  }, []);

  const updateLine = (pageId: string, lineId: string, text: string) => {
    setPages((old) => old.map((page) => page.id !== pageId ? page : {
      ...page, lines: page.lines.map((line) => line.id === lineId ? { ...line, text } : line)
    }));
  };

  const exportText = () => {
    const blob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
    download(blob, "ocr-result.txt");
  };

  const exportJson = () => {
    const payload = pages.map(({ label, width, height, source, lines }) => ({ label, width, height, source, lines }));
    download(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), "ocr-result.json");
  };

  const copyText = async () => {
    await navigator.clipboard.writeText(fullText);
    setStatus("OCR結果をコピーしました");
  };

  const removePage = (id: string) => {
    setPages((old) => {
      const target = old.find((page) => page.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      const next = old.filter((page) => page.id !== id);
      setActiveId(next[0]?.id ?? null);
      return next;
    });
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="AI OCR ホーム"><span className="brand-mark">文</span><span>AI OCR</span></a>
        <div className="topbar-right"><span className="privacy-pill"><i /> ON-DEVICE</span><span className="version">MVP 0.1</span></div>
      </header>

      <section className="intro">
        <div className="eyebrow">PRIVATE DOCUMENT READER</div>
        <h1>文字を、すばやくデータに。</h1>
        <p>画像やPDFから文字を抽出。AIによる認識処理はブラウザ内で実行します。</p>
      </section>

      <section className={`dropzone ${dragging ? "dragging" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); void addFiles(event.dataTransfer.files); }}>
        <div className="upload-icon">↑</div>
        <h2>ファイルをドロップ</h2>
        <p>PNG、JPG、WebP、BMP、PDFに対応</p>
        <button className="primary-button" onClick={() => inputRef.current?.click()} disabled={busy}>ファイルを選択</button>
        <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden onChange={(event) => { if (event.target.files) void addFiles(event.target.files); event.target.value = ""; }} />
        <span className="upload-note">複数ファイル対応 · ファイルは外部サーバーにアップロードされません</span>
      </section>

      <div className="status-row"><span className={busy ? "spinner" : "status-dot"} />{status}{progress && <span className="progress-label">{progress}</span>}</div>
      {error && <div className="error-banner" role="alert">{error}</div>}

      <section className="workspace">
        <aside className="panel file-panel">
          <div className="panel-heading"><h3>ドキュメント</h3><span>{pages.length} ページ</span></div>
          {pages.length === 0 ? <div className="empty-small">読み込んだファイルは<br />ここに表示されます。</div> :
            <ul className="page-list">{pages.map((page, index) => <li key={page.id}>
              <button className={`page-button ${activePage?.id === page.id ? "selected" : ""}`} onClick={() => setActiveId(page.id)}>
                <span className="page-number">{String(index + 1).padStart(2, "0")}</span><span className="page-name">{page.label}</span>
              </button>
              <button className="remove-button" title="削除" onClick={() => removePage(page.id)}>×</button>
            </li>)}</ul>}
        </aside>

        <section className="panel preview-panel">
          <div className="panel-heading"><h3>プレビュー</h3><span>{activePage ? activePage.source === "ocr" ? "AI OCR" : "PDFテキスト抽出" : "ファイル未選択"}</span></div>
          {activePage ? <div className="preview-canvas"><div className="preview-image-wrap"><img src={activePage.previewUrl} alt="読み込んだページ" />{activePage.source === "ocr" && activePage.width > 0 && <svg className="ocr-overlay" viewBox={`0 0 ${activePage.width} ${activePage.height}`} preserveAspectRatio="none" aria-label="OCR認識領域">{activePage.lines.map((line) => line.poly.length > 0 && <polygon key={line.id} points={line.poly.map(([x, y]) => `${x},${y}`).join(" ")} />)}</svg>}</div></div> :
            <div className="preview-empty"><div className="document-icon">▧</div><span>プレビューがここに表示されます</span></div>}
        </section>

        <section className="panel result-panel">
          <div className="panel-heading"><h3>認識結果</h3><span>{activePage?.lines.length ?? 0} 行</span></div>
          {activePage ? <div className="result-content">
            <div className="result-meta">{activePage.source === "ocr" ? `処理時間 ${activePage.elapsedMs} ms` : "PDF内のテキストを抽出"} · 編集できます</div>
            {activePage.lines.map((line) => <div className="result-line" key={line.id}>
              <textarea value={line.text} rows={Math.max(1, Math.min(5, Math.ceil(line.text.length / 34)))} onChange={(event) => updateLine(activePage.id, line.id, event.target.value)} />
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
