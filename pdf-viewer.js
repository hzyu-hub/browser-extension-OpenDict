// OpenDict PDF Viewer — renders PDFs with selectable text for translation
import * as pdfjsLib from "./lib/pdfjs/pdf.min.mjs";
import {
  buildDomRangesFromCanonicalRange,
  buildTextIndexFromTextLayer,
  findCharIndexAtPoint,
  findMatchesInIndex,
  findTokenContaining,
  normalizeCoarseText,
  normalizeSearchQuery,
} from "./pdf-text-index-core.mjs";

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

// pageNum → canonical text index built from the rendered PDF.js textLayer.
const pageTextIndexCache = new Map();

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
    // Notify search subsystem that this page's textLayer is fresh, so any
    // existing highlights can be re-attached to the new DOM nodes.
    onPageTextLayerRendered?.(pageNum);
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

// --- Custom double-click word selection ---
// Browser-default dblclick on PDF.js text spans is unreliable because the
// transparent textLayer is absolutely positioned and often split across many
// glyph spans. Use the same canonical text index as search: point → char →
// token → DOM Range.

function findPageNumAtPoint(clientX, clientY, target = null) {
  const wrapper = target?.closest?.(".pdf-page-wrapper");
  if (wrapper?.dataset?.page) return Number(wrapper.dataset.page);

  let bestPage = null;
  let bestDist = Infinity;
  for (const [pageNum, slot] of pageSlots) {
    const r = slot.wrapper.getBoundingClientRect();
    if (
      clientX >= r.left &&
      clientX <= r.right &&
      clientY >= r.top &&
      clientY <= r.bottom
    ) {
      return pageNum;
    }
    const dx = clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0;
    const dy = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) {
      bestDist = dist;
      bestPage = pageNum;
    }
  }
  return bestDist <= 24 ? bestPage : null;
}

function selectDomRanges(ranges) {
  if (!ranges || ranges.length === 0) return false;
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  const sel = window.getSelection();
  if (!sel) return false;

  const range = document.createRange();
  try {
    range.setStart(first.node, first.startOffset);
    range.setEnd(last.node, last.endOffset);
  } catch {
    return false;
  }

  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

function selectWordAtPoint(clientX, clientY, target = null) {
  const pageNum = findPageNumAtPoint(clientX, clientY, target);
  if (!pageNum) return false;

  const index = getPageTextIndex(pageNum);
  if (!index) return false;

  const charIndex = findCharIndexAtPoint(index, clientX, clientY);
  if (charIndex < 0) return false;

  const token = findTokenContaining(index, charIndex);
  if (!token) return false;

  const ranges = buildDomRangesFromCanonicalRange(index, token.start, token.end);
  return selectDomRanges(ranges);
}

container.addEventListener("dblclick", (e) => {
  if (!e.target.closest(".textLayer")) return;
  if (selectWordAtPoint(e.clientX, e.clientY, e.target)) {
    // Prevent the browser's default word selection from clobbering ours.
    e.preventDefault();
  }
}, true);

// --- In-document search (Ctrl+F) ---
// Search and double-click selection share one canonical per-page text model.
// Rendered pages get exact DOM mappings for pixel-accurate marks; unrendered
// pages keep a coarse text cache for counts and navigation until their textLayer
// is lazily rendered.

const searchBar = document.getElementById("search-bar");
const searchInput = document.getElementById("search-input");
const searchCount = document.getElementById("search-count");
const searchPrevBtn = document.getElementById("search-prev");
const searchNextBtn = document.getElementById("search-next");
const searchCloseBtn = document.getElementById("search-close");
const toggleSearchBtn = document.getElementById("toggle-search");

// pageNum → normalized coarse text. Rendered pages are upgraded to canonical
// text from PageTextIndex; unrendered pages use getTextContent() as a fallback.
const pageTextCache = new Map();
let searchTextExtracted = false;

// Each match: { page, start, end } — offsets in that page's canonical/coarse text.
let searchMatches = [];
let searchCurrentIdx = -1;

function getTextLayerForPage(pageNum) {
  const slot = pageSlots.get(pageNum);
  return slot?.wrapper?.querySelector(".textLayer") || null;
}

function clearPageTextIndex(pageNum) {
  pageTextIndexCache.delete(pageNum);
}

function getPageTextIndex(pageNum) {
  if (pageTextIndexCache.has(pageNum)) return pageTextIndexCache.get(pageNum);
  const textLayer = getTextLayerForPage(pageNum);
  if (!textLayer) return null;
  const index = buildTextIndexFromTextLayer(textLayer);
  index.page = pageNum;
  pageTextIndexCache.set(pageNum, index);
  return index;
}

async function getCoarsePageText(pageNum) {
  try {
    const page = await pdfDoc.getPage(pageNum);
    const tc = await page.getTextContent();
    return normalizeCoarseText(tc.items);
  } catch {
    return { joined: "", spaced: "" };
  }
}

async function extractAllPageTexts() {
  if (searchTextExtracted || !pdfDoc) return;
  searchTextExtracted = true;
  const fetches = [];
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    if (pageTextCache.has(i)) continue;
    const index = getPageTextIndex(i);
    if (index) {
      pageTextCache.set(i, index.canonicalText);
      continue;
    }
    // Use .catch() so one page failure doesn't kill the entire extraction.
    fetches.push(
      getCoarsePageText(i)
        .then((text) => pageTextCache.set(i, text))
        .catch(() => {})
    );
  }
  await Promise.allSettled(fetches);
}

function clearSearchHighlights() {
  for (const [pageNum] of pageSlots) {
    clearHighlightsFromPage(pageNum);
  }
}

function clearHighlightsFromPage(pageNum) {
  const slot = pageSlots.get(pageNum);
  if (!slot) return;
  const container = slot.wrapper.querySelector(".od-search-highlights");
  if (container) container.remove();
}

function applyHighlightsToPage(pageNum) {
  const pageMatches = [];
  for (let i = 0; i < searchMatches.length; i++) {
    const m = searchMatches[i];
    if (m.page === pageNum) {
      pageMatches.push({ ...m, isCurrent: i === searchCurrentIdx });
    }
  }

  clearHighlightsFromPage(pageNum);
  if (pageMatches.length === 0) return;

  const index = getPageTextIndex(pageNum);
  if (!index) return;
  pageTextCache.set(pageNum, index.canonicalText);

  const slot = pageSlots.get(pageNum);
  if (!slot) return;
  const wrapper = slot.wrapper;
  const wrapperRect = wrapper.getBoundingClientRect();

  const container = document.createElement("div");
  container.className = "od-search-highlights";
  container.setAttribute("data-od", "");

  for (const m of pageMatches) {
    const ranges = buildDomRangesFromCanonicalRange(index, m.start, m.end);
    const className = m.isCurrent
      ? "opendict-search-hit-current"
      : "opendict-search-hit";

    for (const r of ranges) {
      if (r.startOffset >= r.endOffset) continue;

      const range = document.createRange();
      range.setStart(r.node, r.startOffset);
      range.setEnd(r.node, r.endOffset);
      const rects = range.getClientRects();
      range.detach?.();

      for (let j = 0; j < rects.length; j++) {
        const rect = rects[j];
        if (rect.width === 0 && rect.height === 0) continue;

        const div = document.createElement("div");
        div.className = className;
        div.setAttribute("data-od", "");
        div.style.left = `${rect.left - wrapperRect.left}px`;
        div.style.top = `${rect.top - wrapperRect.top}px`;
        div.style.width = `${rect.width}px`;
        div.style.height = `${rect.height}px`;
        container.appendChild(div);
      }
    }
  }

  if (container.children.length > 0) {
    // Insert before textLayer (z-index:2) so highlights sit between
    // the canvas and the transparent text overlay.
    const textLayer = wrapper.querySelector(".textLayer");
    if (textLayer) {
      wrapper.insertBefore(container, textLayer);
    } else {
      wrapper.appendChild(container);
    }
  }
}

function refreshHighlights() {
  const pagesWithMatches = new Set(searchMatches.map((m) => m.page));
  for (const [pageNum] of pageSlots) {
    if (pagesWithMatches.has(pageNum)) {
      applyHighlightsToPage(pageNum);
    } else {
      clearHighlightsFromPage(pageNum);
    }
  }
}

// Hook called by renderPageContent after a textLayer is freshly rendered.
function onPageTextLayerRendered(pageNum) {
  clearPageTextIndex(pageNum);
  const index = getPageTextIndex(pageNum);
  if (index) pageTextCache.set(pageNum, index.canonicalText);

  if (!searchBar.hidden && searchInput.value.trim()) {
    runSearch(searchInput.value.trim());
    return;
  }

  if (searchMatches.length === 0) return;
  if (!searchMatches.some((m) => m.page === pageNum)) return;
  refreshHighlights();
}

function runSearch(query) {
  searchMatches = [];
  searchCurrentIdx = -1;
  clearSearchHighlights();

  const needle = normalizeSearchQuery(query);
  if (!needle) {
    updateSearchCount();
    return;
  }

  for (const [page, cached] of pageTextCache) {
    const index = getPageTextIndex(page);
    if (index) {
      pageTextCache.set(page, index.canonicalText);
      for (const m of findMatchesInIndex(index, needle)) {
        searchMatches.push({ page, start: m.start, end: m.end });
      }
      continue;
    }

    // cached can be a string (from index) or { joined, spaced } (from coarse extraction)
    const haystacks =
      typeof cached === "string"
        ? [cached]
        : [cached?.joined, cached?.spaced].filter(Boolean);

    for (const haystack of haystacks) {
      let from = 0;
      while (from <= haystack.length - needle.length) {
        const start = haystack.indexOf(needle, from);
        if (start < 0) break;
        searchMatches.push({ page, start, end: start + needle.length });
        from = start + needle.length;
      }
    }
  }

  searchMatches.sort((a, b) => a.page - b.page || a.start - b.start);
  if (searchMatches.length > 0) {
    searchCurrentIdx = 0;
    jumpToMatch(0);
  } else {
    updateSearchCount();
  }
}

function jumpToMatch(idx) {
  if (idx < 0 || idx >= searchMatches.length) return;
  searchCurrentIdx = idx;
  const m = searchMatches[idx];
  scrollToPage(m.page);
  updateSearchCount();
  // Wait two frames so lazy rendering can schedule; onPageTextLayerRendered will
  // rerun search with precise DOM offsets if the target page was not rendered.
  requestAnimationFrame(() => requestAnimationFrame(refreshHighlights));
}

function updateSearchCount() {
  const total = searchMatches.length;
  if (total === 0) {
    searchCount.textContent = searchInput.value.trim() ? "0/0" : "";
  } else {
    searchCount.textContent = `${searchCurrentIdx + 1}/${total}`;
  }
  searchPrevBtn.disabled = total === 0;
  searchNextBtn.disabled = total === 0;
}

let searchDebounce = null;
function scheduleSearch() {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    runSearch(searchInput.value.trim());
  }, 180);
}

async function openSearch() {
  searchBar.hidden = false;
  searchInput.focus();
  searchInput.select();
  if (!searchTextExtracted) {
    searchCount.textContent = "Indexing…";
    await extractAllPageTexts();
    searchCount.textContent = "";
  }
  if (searchInput.value.trim()) {
    runSearch(searchInput.value.trim());
  }
}

function closeSearch() {
  searchBar.hidden = true;
  searchMatches = [];
  searchCurrentIdx = -1;
  clearSearchHighlights();
  updateSearchCount();
}

searchInput.addEventListener("input", scheduleSearch);
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    if (searchMatches.length === 0) return;
    const next = e.shiftKey
      ? (searchCurrentIdx - 1 + searchMatches.length) % searchMatches.length
      : (searchCurrentIdx + 1) % searchMatches.length;
    jumpToMatch(next);
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeSearch();
  }
});
searchPrevBtn.addEventListener("click", () => {
  if (searchMatches.length === 0) return;
  const next =
    (searchCurrentIdx - 1 + searchMatches.length) % searchMatches.length;
  jumpToMatch(next);
});
searchNextBtn.addEventListener("click", () => {
  if (searchMatches.length === 0) return;
  jumpToMatch((searchCurrentIdx + 1) % searchMatches.length);
});
searchCloseBtn.addEventListener("click", closeSearch);
toggleSearchBtn.addEventListener("click", () => {
  if (searchBar.hidden) openSearch();
  else closeSearch();
});

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    openSearch();
  }
});

// --- Init ---
zoomLevelEl.textContent = `${Math.round(currentScale * 100)}%`;
loadPdf();
