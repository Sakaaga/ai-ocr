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

## Model delivery and offline behavior

The app uses PaddleOCR.js built-in model assets by default. It does not require Cloudflare R2. The SDK downloads its model assets from its configured upstream model host.

The Service Worker caches the same-origin application shell. Browser HTTP caching of cross-origin model/WASM assets is controlled by the upstream server and browser cache policy; **this initial MVP does not yet guarantee durable offline model availability**. A follow-up implementation should add an explicit model-cache/download manager and verify offline startup in supported browsers before advertising full offline support.

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
