# AI OCR

Browser-based, on-device OCR for images and PDF documents.

## Stack

- React + TypeScript + Vite
- [PaddleOCR.js](https://github.com/PaddlePaddle/PaddleOCR/tree/main/paddleocr-js) for in-browser OCR
- [PDF.js](https://github.com/mozilla/pdf.js) for PDF text extraction and page rendering
- Service Worker for the app shell

## Development

```bash
npm install
npm run dev
```

Build and type-check:

```bash
npm run build
```

## Current MVP

- Image input: PNG, JPEG, WebP, BMP (browser decoder permitting)
- PDF input: extracts embedded text where available; renders scanned pages and sends them to local OCR
- OCR results can be edited, copied, and exported as TXT or JSON
- OCR runs in the browser using PaddleOCR.js (PP-OCRv6, Japanese model selection)
- No application server or OCR API is used

## Models, caching and offline behavior

- Available OCR models are defined in `src/models.ts`. Add an entry there to expose a new model in the UI.
- Each model engine is created once per session and reused.
- The Service Worker (`public/sw.js`) caches the PaddleOCR model archives (`.tar`) and the ONNX Runtime WASM/MJS files in a separate `ai-ocr-models-v1` cache, so they survive app updates.
- The "取得済み" marker in the model list is only a hint stored in localStorage. The actual cache is in the Cache Storage.
- Offline use after the first download should be verified in each target browser before advertising it.

## Preprocessing

Preprocessing runs entirely in the browser (`src/preprocess.ts`): grayscale, contrast stretch, median denoise, sharpen, 2x upscale for small images, Otsu binarization, invert, and 90-degree rotation. Presets set the checkboxes in one click, "自動判定して設定" analyzes the active page, and "取り込み時に自動判定" analyzes each new image on import. Auto decisions use simple heuristics and are shown as reasons so they can be overridden.

## Known limitations

- Layout reconstruction and table-cell structure are not implemented yet.
- Reading order is the OCR engine's returned order.
- PDF pages with embedded text use basic text extraction; visual layout is not preserved.
- Password-protected PDFs and very large documents need additional UX and memory safeguards.
- Browser support and model availability depend on the runtime, CORS, and upstream asset hosting.

## Deployment

This is a static Vite app and can be deployed to Cloudflare Pages using:

- Build command: `npm run build`
- Output directory: `dist`

No R2 bucket is required.

## Privacy

Document bytes are passed to browser-side PDF.js and PaddleOCR.js. The application does not intentionally upload document contents to an application backend. The first run may contact upstream hosts to download JavaScript dependencies and model assets.
