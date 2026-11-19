// アプリ本体（同一オリジン）とOCRモデル・WASM（外部）をキャッシュします。
// モデルのキャッシュは SHELL とは別の名前で保持し、アプリ更新時にも消えないようにしています。
const SHELL_CACHE = "ai-ocr-shell-v2";
const MODEL_CACHE = "ai-ocr-models-v1";
const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest"];

// PaddleOCR.js が取得する外部アセット（モデルの .tar、onnxruntime の .wasm/.mjs）
function isModelAsset(url) {
  if (url.hostname === "paddle-model-ecology.bj.bcebos.com") return url.pathname.endsWith(".tar");
  if (url.hostname === "cdn.jsdelivr.net") {
    return url.pathname.includes("onnxruntime-web") && (url.pathname.endsWith(".wasm") || url.pathname.endsWith(".mjs"));
  }
  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith("ai-ocr-shell-") && key !== SHELL_CACHE)
        .map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      }))
    );
    return;
  }

  if (isModelAsset(url)) {
    event.respondWith(cacheFirst(request, MODEL_CACHE));
  }
});
