// OpenDict PDF Viewer — renders PDFs with selectable text for translation
import * as pdfjsLib from "./lib/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./lib/pdfjs/pdf.worker.min.mjs";

// --- DOM refs ---
const container = document.getElementById("viewer-container");
const filenameEl = document.getElementById("filename");
const pageNumInput = document.getElementById("page-num");
const pageCountEl = document.getElementById("page-count");
const zoomLevelEl = document.getElementById("zoom-level");

// --- State ---
const params = new URLSearchParams(location.search);
const pdfUrl = params.get("url");
let pdfDoc = null;
let currentScale = 1.5;
const renderedPages = new Map();

// Show filename in toolbar and page title
if (pdfUrl) {
  try {
    const name =
      decodeURIComponent(new URL(pdfUrl).pathname.split("/").pop()) || pdfUrl;
    filenameEl.textContent = name;
    document.title = `${name} — OpenDict`;
  } catch {
    filenameEl.textContent = pdfUrl;
  }
}

// --- PDF data fetching with CORS fallback ---

async function fetchPdfData(url) {
  // Extension pages with host_permissions can fetch cross-origin directly
  try {
    const resp = await fetch(url);
    if (resp.ok) return await resp.arrayBuffer();
  } catch {
    // fall through to proxy
  }

  // Fallback: proxy through background service worker (not bound by CORS)
  const response = await chrome.runtime.sendMessage({
    type: "opendict-fetch-pdf",
    url,
  });
  if (response?.error) throw new Error(response.error);
  if (!response?.data) throw new Error("Empty response from proxy");

  const binary = atob(response.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// --- Rendering ---

async function renderPage(pageNum) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: currentScale });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  // Wrapper
  const wrapper = document.createElement("div");
  wrapper.className = "pdf-page-wrapper";
  wrapper.style.width = `${viewport.width}px`;
  wrapper.style.height = `${viewport.height}px`;
  wrapper.dataset.page = pageNum;

  // Canvas
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  ctx.scale(dpr, dpr);
  await page.render({ canvasContext: ctx, viewport }).promise;
  wrapper.appendChild(canvas);

  // Text layer (selectable transparent overlay)
  const textDiv = document.createElement("div");
  textDiv.className = "textLayer";
  wrapper.appendChild(textDiv);

  try {
    const textContent = await page.getTextContent();
    if (pdfjsLib.TextLayer) {
      const tl = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textDiv,
        viewport,
      });
      await tl.render();
    } else {
      buildTextLayerFallback(textContent, textDiv, viewport);
    }
  } catch {
    // Text layer failed; canvas still works
  }

  return wrapper;
}

// Manual text-layer positioning (fallback if TextLayer class is unavailable)
function buildTextLayerFallback(textContent, el, viewport) {
  for (const item of textContent.items) {
    if (!item.str) continue;
    const span = document.createElement("span");
    span.textContent = item.str;
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]);
    if (fontHeight < 1) continue;
    span.style.fontSize = `${fontHeight}px`;
    span.style.fontFamily = "sans-serif";
    span.style.left = `${tx[4]}px`;
    span.style.top = `${tx[5] - fontHeight}px`;
    el.appendChild(span);
  }
}

async function renderAllPages() {
  container.innerHTML = "";
  renderedPages.clear();
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const wrapper = await renderPage(i);
    container.appendChild(wrapper);
    renderedPages.set(i, wrapper);
  }
}

// --- Load PDF ---

async function loadPdf() {
  if (!pdfUrl) {
    container.innerHTML =
      '<div id="loading-message">No PDF URL specified.</div>';
    return;
  }

  container.innerHTML =
    '<div id="loading-message">Loading PDF\u2026</div>';

  try {
    const data = await fetchPdfData(pdfUrl);
    pdfDoc = await pdfjsLib.getDocument({ data }).promise;

    pageCountEl.textContent = pdfDoc.numPages;
    pageNumInput.max = pdfDoc.numPages;
    container.innerHTML = "";
    await renderAllPages();
  } catch (err) {
    let msg = `Failed to load PDF: ${err.message}`;
    if (pdfUrl.startsWith("file://")) {
      msg +=
        "<br><br>For local files, enable <b>Allow access to file URLs</b> in the extension settings (chrome://extensions).";
    }
    container.innerHTML = `<div id="loading-message">${msg}</div>`;
  }
}

// --- Zoom ---

function setZoom(scale) {
  currentScale = Math.max(0.5, Math.min(5, scale));
  zoomLevelEl.textContent = `${Math.round(currentScale * 100)}%`;
  if (pdfDoc) renderAllPages();
}

document
  .getElementById("zoom-in")
  .addEventListener("click", () => setZoom(currentScale + 0.25));
document
  .getElementById("zoom-out")
  .addEventListener("click", () => setZoom(currentScale - 0.25));
document
  .getElementById("zoom-reset")
  .addEventListener("click", () => setZoom(1.5));

// --- Page navigation ---

function scrollToPage(num) {
  const el = renderedPages.get(num);
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

document.getElementById("prev-page").addEventListener("click", () => {
  const cur = parseInt(pageNumInput.value);
  if (cur > 1) {
    pageNumInput.value = cur - 1;
    scrollToPage(cur - 1);
  }
});

document.getElementById("next-page").addEventListener("click", () => {
  const cur = parseInt(pageNumInput.value);
  if (pdfDoc && cur < pdfDoc.numPages) {
    pageNumInput.value = cur + 1;
    scrollToPage(cur + 1);
  }
});

pageNumInput.addEventListener("change", () => {
  const p = parseInt(pageNumInput.value);
  if (p >= 1 && pdfDoc && p <= pdfDoc.numPages) scrollToPage(p);
});

// Track visible page while scrolling
container.addEventListener("scroll", () => {
  const midY =
    container.getBoundingClientRect().top + container.clientHeight / 2;
  for (const [num, el] of renderedPages) {
    const r = el.getBoundingClientRect();
    if (r.top <= midY && r.bottom >= midY) {
      pageNumInput.value = num;
      break;
    }
  }
});

// --- Keyboard shortcuts ---

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key === "=" || e.key === "+") {
      e.preventDefault();
      setZoom(currentScale + 0.25);
    } else if (e.key === "-") {
      e.preventDefault();
      setZoom(currentScale - 0.25);
    } else if (e.key === "0") {
      e.preventDefault();
      setZoom(1.5);
    }
  }
});

// --- Init ---
zoomLevelEl.textContent = `${Math.round(currentScale * 100)}%`;
loadPdf();
