// OpenDict PDF Viewer — renders PDFs with selectable text for translation
import * as pdfjsLib from "./lib/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./lib/pdfjs/pdf.worker.min.mjs";

// --- DOM refs ---
const container = document.getElementById("viewer-container");
const filenameEl = document.getElementById("filename");
const pageNumInput = document.getElementById("page-num");
const pageCountEl = document.getElementById("page-count");
const zoomLevelEl = document.getElementById("zoom-level");
const sidebar = document.getElementById("sidebar");
const sidebarContent = document.getElementById("sidebar-content");

// --- State ---
const params = new URLSearchParams(location.search);
const pdfUrl = params.get("url");
let pdfDoc = null;
let currentScale = 1.5;

// Base (scale=1) dimensions per page
const baseDims = new Map();

// Per-page state: { wrapper, rendered, renderedScale }
const pageSlots = new Map();

// The scale at which pages were last fully rendered
let renderedScale = 1.5;

// Debounce timer for high-quality re-render after zoom settles
let rerenderTimer = null;

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
  try {
    const resp = await fetch(url);
    if (resp.ok) return await resp.arrayBuffer();
  } catch {
    // fall through to proxy
  }

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

// --- Cache base (scale=1) dimensions for every page ---

async function cacheBaseDims() {
  baseDims.clear();
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    baseDims.set(i, { width: vp.width, height: vp.height });
  }
}

// --- Lazy rendering with IntersectionObserver ---

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const pageNum = parseInt(entry.target.dataset.page);
        const slot = pageSlots.get(pageNum);
        if (slot && !slot.rendered) {
          renderPageContent(pageNum, currentScale);
        }
      }
    }
  },
  { root: container, rootMargin: "200px" }
);

// Create empty placeholders for all pages (synchronous, no rendering)
function createPageSlots() {
  container.innerHTML = "";
  pageSlots.forEach((s) => observer.unobserve(s.wrapper));
  pageSlots.clear();

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const dim = baseDims.get(i);
    const w = dim.width * currentScale;
    const h = dim.height * currentScale;

    const wrapper = document.createElement("div");
    wrapper.className = "pdf-page-wrapper";
    wrapper.style.width = `${w}px`;
    wrapper.style.height = `${h}px`;
    wrapper.dataset.page = i;
    container.appendChild(wrapper);

    pageSlots.set(i, { wrapper, rendered: false, renderedScale: 0 });
    observer.observe(wrapper);
  }
}

// Render canvas + text layer into a placeholder at a given scale
async function renderPageContent(pageNum, scale) {
  const slot = pageSlots.get(pageNum);
  if (!slot) return;

  // Mark as rendered at this scale
  slot.rendered = true;
  slot.renderedScale = scale;

  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  ctx.scale(dpr, dpr);
  await page.render({ canvasContext: ctx, viewport }).promise;

  const textDiv = document.createElement("div");
  textDiv.className = "textLayer";
  textDiv.style.setProperty("--scale-factor", viewport.scale);

  // Check if scale changed while we were rendering — if so, discard
  if (currentScale !== scale) return;

  // Clear old content and insert new
  slot.wrapper.innerHTML = "";
  slot.wrapper.appendChild(canvas);
  slot.wrapper.appendChild(textDiv);

  try {
    const textContent = await page.getTextContent();
    const tl = new pdfjsLib.TextLayer({
      textContentSource: textContent,
      container: textDiv,
      viewport,
    });
    await tl.render();
  } catch {
    // Text layer failed; canvas still works
  }
}

// --- Zoom ---
// Phase 1 (instant): CSS transform scales existing content, resize wrappers
// Phase 2 (debounced): re-render visible pages at new scale for crisp text

function setZoom(scale) {
  currentScale = Math.max(0.5, Math.min(5, Math.round(scale * 100) / 100));
  pendingScale = currentScale;
  zoomLevelEl.textContent = `${Math.round(currentScale * 100)}%`;
  if (!pdfDoc) return;

  const scrollRatio =
    container.scrollHeight > 0
      ? container.scrollTop / container.scrollHeight
      : 0;

  const cssRatio = currentScale / renderedScale;

  // Phase 1: instantly resize wrappers + CSS-scale existing canvas/textLayer
  for (const [i, slot] of pageSlots) {
    const dim = baseDims.get(i);
    const w = dim.width * currentScale;
    const h = dim.height * currentScale;
    slot.wrapper.style.width = `${w}px`;
    slot.wrapper.style.height = `${h}px`;

    if (slot.rendered) {
      const inner = slot.wrapper.querySelector("canvas");
      if (inner) {
        // Scale existing content via CSS transform (instant, no re-render)
        const ratio = currentScale / slot.renderedScale;
        inner.style.transformOrigin = "0 0";
        inner.style.transform = `scale(${ratio})`;
      }
      const text = slot.wrapper.querySelector(".textLayer");
      if (text) {
        const ratio = currentScale / slot.renderedScale;
        text.style.transformOrigin = "0 0";
        text.style.transform = `scale(${ratio})`;
      }
    }
  }

  // Restore scroll position
  container.scrollTop = scrollRatio * container.scrollHeight;

  // Phase 2: debounced high-quality re-render
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => {
    renderedScale = currentScale;
    // Re-render only visible (already rendered) pages at new scale
    for (const [num, slot] of pageSlots) {
      if (slot.rendered) {
        slot.rendered = false; // allow re-render
        slot.renderedScale = 0;
      }
    }
    // Trigger observer to pick up visible pages
    observer.disconnect();
    for (const [, slot] of pageSlots) {
      observer.observe(slot.wrapper);
    }
  }, 300);
}

document
  .getElementById("zoom-in")
  .addEventListener("click", () => setZoom(currentScale + 0.1));
document
  .getElementById("zoom-out")
  .addEventListener("click", () => setZoom(currentScale - 0.1));
document
  .getElementById("zoom-reset")
  .addEventListener("click", () => setZoom(1.5));

// --- Prevent browser native zoom — only zoom the document area ---

document.addEventListener(
  "keydown",
  (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "=" || e.key === "+" || e.key === "-" || e.key === "0") {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "=" || e.key === "+") setZoom(currentScale + 0.1);
        else if (e.key === "-") setZoom(currentScale - 0.1);
        else if (e.key === "0") setZoom(1.5);
      }
    }
  },
  true
);

// Prevent Ctrl+scroll (pinch) browser zoom — debounced, fine-grained
let zoomTimer = null;
let pendingScale = currentScale;

document.addEventListener(
  "wheel",
  (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const step = Math.abs(e.deltaY) < 10 ? 0.02 : 0.05;
      pendingScale += e.deltaY > 0 ? -step : step;
      pendingScale = Math.max(0.5, Math.min(5, pendingScale));

      if (!zoomTimer) {
        zoomTimer = setTimeout(() => {
          zoomTimer = null;
          setZoom(pendingScale);
        }, 50);
      }
    }
  },
  { passive: false }
);

// --- Sidebar outline ---

async function buildOutline() {
  if (!pdfDoc) return;
  const outline = await pdfDoc.getOutline();
  sidebarContent.innerHTML = "";

  if (!outline || outline.length === 0) {
    sidebarContent.innerHTML =
      '<div class="outline-no-items">No outline available</div>';
    return;
  }

  function renderItems(items, depth) {
    for (const item of items) {
      const btn = document.createElement("button");
      btn.className = "outline-item";
      btn.textContent = item.title;
      btn.style.paddingLeft = `${14 + depth * 16}px`;
      btn.addEventListener("click", () => navigateToOutlineItem(item));
      sidebarContent.appendChild(btn);

      if (item.items && item.items.length > 0) {
        renderItems(item.items, depth + 1);
      }
    }
  }

  renderItems(outline, 0);
}

async function navigateToOutlineItem(item) {
  if (!item.dest) return;

  try {
    let dest = item.dest;
    if (typeof dest === "string") {
      dest = await pdfDoc.getDestination(dest);
    }
    if (!dest) return;

    const pageIndex = await pdfDoc.getPageIndex(dest[0]);
    const pageNum = pageIndex + 1;
    pageNumInput.value = pageNum;
    scrollToPage(pageNum);
  } catch {
    // Failed to navigate
  }
}

// --- Sidebar toggle ---

document.getElementById("toggle-sidebar").addEventListener("click", () => {
  sidebar.classList.toggle("open");
});

// --- Eye care mode ---

const eyeCareBtn = document.getElementById("toggle-eye-care");
let eyeCareOn = localStorage.getItem("opendict-eye-care") === "1";

function applyEyeCare() {
  container.classList.toggle("eye-care", eyeCareOn);
  eyeCareBtn.textContent = eyeCareOn ? "\u263E" : "\u263C";
  eyeCareBtn.classList.toggle("active", eyeCareOn);
  eyeCareBtn.title = eyeCareOn ? "Eye care mode (on)" : "Eye care mode (off)";
}

eyeCareBtn.addEventListener("click", () => {
  eyeCareOn = !eyeCareOn;
  localStorage.setItem("opendict-eye-care", eyeCareOn ? "1" : "0");
  applyEyeCare();
});

applyEyeCare();

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

    buildOutline();
    await cacheBaseDims();
    renderedScale = currentScale;
    createPageSlots();
  } catch (err) {
    let msg = `Failed to load PDF: ${err.message}`;
    if (pdfUrl.startsWith("file://")) {
      msg +=
        "<br><br>For local files, enable <b>Allow access to file URLs</b> in the extension settings (chrome://extensions).";
    }
    container.innerHTML = `<div id="loading-message">${msg}</div>`;
  }
}

// --- Page navigation ---

function scrollToPage(num) {
  const slot = pageSlots.get(num);
  if (slot) slot.wrapper.scrollIntoView({ behavior: "smooth" });
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
  if (p >= 1 && pdfDoc && p <= pdfDoc.numPages) {
    scrollToPage(p);
  } else {
    pageNumInput.value = pageNumInput.dataset.current || "1";
  }
});

pageNumInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    pageNumInput.blur();
    e.preventDefault();
  }
});

container.addEventListener("scroll", () => {
  const midY =
    container.getBoundingClientRect().top + container.clientHeight / 2;
  for (const [num, slot] of pageSlots) {
    const r = slot.wrapper.getBoundingClientRect();
    if (r.top <= midY && r.bottom >= midY) {
      pageNumInput.value = num;
      pageNumInput.dataset.current = num;
      break;
    }
  }
});

// --- Init ---
zoomLevelEl.textContent = `${Math.round(currentScale * 100)}%`;
loadPdf();
