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
// Browser-default dblclick on PDF.js text spans is unreliable: spans
// frequently contain multiple words (e.g. "Section 4, with lowercase") and
// the word-boundary detection can pick up trailing punctuation/whitespace
// or stop at a span boundary mid-word. We override it with a deterministic
// caret-based selection that walks across sibling spans when needed.
const WORD_CHAR = /[\p{L}\p{N}_'’\-]/u;

function expandWordWithinNode(text, offset) {
  let start = offset;
  let end = offset;
  // If the click landed on a non-word char, try the previous char.
  if (start > 0 && !WORD_CHAR.test(text[start] || "")) {
    if (WORD_CHAR.test(text[start - 1])) start -= 1;
    else return null;
  }
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start -= 1;
  end = start;
  while (end < text.length && WORD_CHAR.test(text[end])) end += 1;
  if (start === end) return null;
  return { start, end };
}

function findFirstTextNode(el) {
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) return child;
    if (child.nodeType === Node.ELEMENT_NODE) {
      const inner = findFirstTextNode(child);
      if (inner) return inner;
    }
  }
  return null;
}

function findLastTextNode(el) {
  for (let i = el.childNodes.length - 1; i >= 0; i--) {
    const child = el.childNodes[i];
    if (child.nodeType === Node.TEXT_NODE) return child;
    if (child.nodeType === Node.ELEMENT_NODE) {
      const inner = findLastTextNode(child);
      if (inner) return inner;
    }
  }
  return null;
}

function selectWordAtPoint(clientX, clientY) {
  const range = document.caretRangeFromPoint
    ? document.caretRangeFromPoint(clientX, clientY)
    : null;
  if (!range) return false;

  let node = range.startContainer;
  let offset = range.startOffset;

  // If the caret landed on an element, descend to the first text node.
  if (node.nodeType !== Node.TEXT_NODE) {
    const inner = findFirstTextNode(node);
    if (!inner) return false;
    node = inner;
    offset = 0;
  }

  const text = node.textContent || "";
  const within = expandWordWithinNode(text, Math.min(offset, text.length));
  if (!within) return false;

  let startNode = node;
  let startOffset = within.start;
  let endNode = node;
  let endOffset = within.end;

  // Word may extend past the current text node when PDF.js splits a glyph
  // run mid-word. Walk siblings on both sides while the boundary char of the
  // adjacent node is still a word char, and the spans visually touch.
  if (startOffset === 0) {
    let cursor = node.parentNode;
    while (cursor) {
      let prev = cursor.previousSibling;
      while (prev && prev.nodeType !== Node.ELEMENT_NODE && prev.nodeType !== Node.TEXT_NODE) {
        prev = prev.previousSibling;
      }
      if (!prev) break;
      const lastText = prev.nodeType === Node.TEXT_NODE ? prev : findLastTextNode(prev);
      if (!lastText) break;
      const t = lastText.textContent || "";
      if (!t.length || !WORD_CHAR.test(t[t.length - 1])) break;
      let i = t.length;
      while (i > 0 && WORD_CHAR.test(t[i - 1])) i -= 1;
      startNode = lastText;
      startOffset = i;
      if (i > 0) break; // word definitely starts in this node
      cursor = prev;
    }
  }

  if (endOffset === text.length) {
    let cursor = node.parentNode;
    while (cursor) {
      let next = cursor.nextSibling;
      while (next && next.nodeType !== Node.ELEMENT_NODE && next.nodeType !== Node.TEXT_NODE) {
        next = next.nextSibling;
      }
      if (!next) break;
      const firstText = next.nodeType === Node.TEXT_NODE ? next : findFirstTextNode(next);
      if (!firstText) break;
      const t = firstText.textContent || "";
      if (!t.length || !WORD_CHAR.test(t[0])) break;
      let i = 0;
      while (i < t.length && WORD_CHAR.test(t[i])) i += 1;
      endNode = firstText;
      endOffset = i;
      if (i < t.length) break;
      cursor = next;
    }
  }

  const sel = window.getSelection();
  if (!sel) return false;
  const finalRange = document.createRange();
  try {
    finalRange.setStart(startNode, startOffset);
    finalRange.setEnd(endNode, endOffset);
  } catch {
    return false;
  }
  sel.removeAllRanges();
  sel.addRange(finalRange);
  return true;
}

container.addEventListener("dblclick", (e) => {
  if (!e.target.closest(".textLayer")) return;
  if (selectWordAtPoint(e.clientX, e.clientY)) {
    // Prevent the browser's default word selection from clobbering ours.
    e.preventDefault();
  }
}, true);

// --- In-document search (Ctrl+F) ---
//
// Custom search since the bundled lib only ships PDF.js core (no
// PDFFindController). We extract per-page text via getTextContent (cached),
// run substring search across pages, and use the CSS Custom Highlight API
// (CSS.highlights) to paint matches without mutating the textLayer DOM.

const searchBar = document.getElementById("search-bar");
const searchInput = document.getElementById("search-input");
const searchCount = document.getElementById("search-count");
const searchPrevBtn = document.getElementById("search-prev");
const searchNextBtn = document.getElementById("search-next");
const searchCloseBtn = document.getElementById("search-close");
const toggleSearchBtn = document.getElementById("toggle-search");

// pageNum → string of plain text (concatenated from getTextContent items)
const pageTextCache = new Map();
let searchTextExtracted = false;

// Each match: { page, start, end } — char offsets within pageTextCache.get(page)
let searchMatches = [];
let searchCurrentIdx = -1;

const SEARCH_MARK_CLASSES = ["opendict-search-hit", "opendict-search-hit-current"];

// Read the actual rendered text of a page's textLayer. This matches DOM
// offsets exactly (which is what buildRangeForMatch walks), unlike
// `getTextContent().items.join("")` whose result can disagree with the
// DOM by inserted whitespace / merged items.
function readPageTextFromDom(pageNum) {
  const slot = pageSlots.get(pageNum);
  if (!slot) return null;
  const tl = slot.wrapper.querySelector(".textLayer");
  if (!tl) return null;
  return tl.textContent || "";
}

async function extractAllPageTexts() {
  if (searchTextExtracted || !pdfDoc) return;
  searchTextExtracted = true;
  const fetches = [];
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    if (pageTextCache.has(i)) continue;
    // Already-rendered pages: read straight from DOM (precise).
    const dom = readPageTextFromDom(i);
    if (dom !== null) {
      pageTextCache.set(i, dom);
      continue;
    }
    // Unrendered pages: fall back to getTextContent join. May not align
    // perfectly with what the future DOM will show, but lets navigation
    // count + jump-to-page still work. Once the page actually renders,
    // onPageTextLayerRendered upgrades the cache to DOM-precise text.
    fetches.push(
      pdfDoc
        .getPage(i)
        .then((page) => page.getTextContent())
        .then((tc) => {
          pageTextCache.set(i, tc.items.map((it) => it.str || "").join(""));
        })
        .catch(() => {
          pageTextCache.set(i, "");
        }),
    );
  }
  await Promise.all(fetches);
}

function clearSearchHighlights() {
  for (const [pageNum] of pageSlots) {
    clearMarksFromPage(pageNum);
  }
}

function clearMarksFromPage(pageNum) {
  const slot = pageSlots.get(pageNum);
  if (!slot) return;
  const textLayer = slot.wrapper.querySelector(".textLayer");
  if (!textLayer) return;
  const sel = SEARCH_MARK_CLASSES.map((c) => `mark.${c}`).join(",");
  const marks = textLayer.querySelectorAll(sel);
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  }
  textLayer.normalize();
}

// Wrap matched characters in a <mark> element. Using DOM marks (instead of
// CSS Custom Highlight API or ::selection) is the only way to get pixel-
// perfect highlight bounds inside a PDF.js text layer: spans carry a
// `transform: scaleX(N)` to align text with canvas glyphs, and Range-based
// rendering does not measure the post-transform geometry precisely. A child
// <mark> element inherits the same transform, so its background rectangle
// aligns with the visible glyphs character-for-character.
function splitAndMark(textNode, localStart, localEnd, className) {
  const parent = textNode.parentNode;
  if (!parent) return null;
  const text = textNode.textContent || "";
  const before = text.slice(0, localStart);
  const middle = text.slice(localStart, localEnd);
  const after = text.slice(localEnd);
  if (!middle) return null;

  const mark = document.createElement("mark");
  mark.className = className;
  mark.textContent = middle;

  if (after) {
    const afterNode = document.createTextNode(after);
    parent.insertBefore(afterNode, textNode.nextSibling);
  }
  parent.insertBefore(mark, textNode);
  if (before) textNode.textContent = before;
  else parent.removeChild(textNode);
  return mark;
}

function applyHighlightsToPage(pageNum) {
  clearMarksFromPage(pageNum);
  const slot = pageSlots.get(pageNum);
  if (!slot) return;
  const textLayer = slot.wrapper.querySelector(".textLayer");
  if (!textLayer) return;

  // Collect matches that belong to this page.
  const pageMatches = [];
  for (let i = 0; i < searchMatches.length; i++) {
    const m = searchMatches[i];
    if (m.page === pageNum) {
      pageMatches.push({
        start: m.start,
        end: m.end,
        isCurrent: i === searchCurrentIdx,
      });
    }
  }
  if (pageMatches.length === 0) return;

  // First, walk every text node once to collect (textNode, localStart,
  // localEnd, className) tuples for each match overlap. We must collect
  // before mutating, otherwise the walker gets confused by inserted nodes.
  const ops = [];
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  let cursor = 0;
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent || "";
    const len = text.length;
    const ns = cursor;
    const ne = cursor + len;
    cursor = ne;
    if (len === 0) continue;
    for (const m of pageMatches) {
      if (m.end <= ns) continue;
      if (m.start >= ne) continue;
      const localStart = Math.max(0, m.start - ns);
      const localEnd = Math.min(len, m.end - ns);
      if (localStart >= localEnd) continue;
      ops.push({
        node,
        localStart,
        localEnd,
        className: m.isCurrent
          ? "opendict-search-hit-current"
          : "opendict-search-hit",
      });
    }
  }

  // Group ops by node, then process each node's ops in descending order so
  // earlier slices don't shift later offsets within the same node.
  const byNode = new Map();
  for (const op of ops) {
    if (!byNode.has(op.node)) byNode.set(op.node, []);
    byNode.get(op.node).push(op);
  }
  for (const [n, list] of byNode) {
    list.sort((a, b) => b.localStart - a.localStart);
    for (const op of list) {
      // The text node may have been replaced by an earlier op on the same
      // node. After splitAndMark, the residual text node holds the BEFORE
      // slice. Subsequent (smaller localStart) ops on this node act on the
      // SAME node since they only touch the BEFORE region.
      splitAndMark(op.node, op.localStart, op.localEnd, op.className);
    }
  }
}

function refreshHighlights() {
  const pagesWithMatches = new Set(searchMatches.map((m) => m.page));
  for (const [pageNum] of pageSlots) {
    if (pagesWithMatches.has(pageNum)) {
      applyHighlightsToPage(pageNum);
    } else {
      clearMarksFromPage(pageNum);
    }
  }
}

// Hook called by renderPageContent after a textLayer is freshly rendered.
function onPageTextLayerRendered(pageNum) {
  // If we have a search session, upgrade this page's cached text to the
  // DOM-precise version. PDF.js may have inserted spaces / merged items
  // when building the layer, so the DOM string can differ from the
  // getTextContent join we used as fallback.
  if (searchTextExtracted) {
    const domText = readPageTextFromDom(pageNum);
    if (domText !== null && pageTextCache.get(pageNum) !== domText) {
      pageTextCache.set(pageNum, domText);
      // Pageʼs text changed → rerun search so match offsets line up with
      // the now-authoritative DOM text. runSearch handles refreshHighlights.
      if (!searchBar.hidden && searchInput.value.trim()) {
        runSearch(searchInput.value.trim());
        return;
      }
    }
  }
  if (searchMatches.length === 0) return;
  if (!searchMatches.some((m) => m.page === pageNum)) return;
  refreshHighlights();
}

function runSearch(query) {
  searchMatches = [];
  searchCurrentIdx = -1;
  if (!query) {
    updateSearchCount();
    clearSearchHighlights();
    return;
  }
  const needle = query.toLowerCase();
  for (const [page, text] of pageTextCache) {
    const haystack = text.toLowerCase();
    let from = 0;
    while (from <= haystack.length - needle.length) {
      const idx = haystack.indexOf(needle, from);
      if (idx < 0) break;
      searchMatches.push({ page, start: idx, end: idx + needle.length });
      from = idx + needle.length;
    }
  }
  // Sort by page, then by start offset.
  searchMatches.sort((a, b) => a.page - b.page || a.start - b.start);
  if (searchMatches.length > 0) {
    searchCurrentIdx = 0;
    jumpToMatch(0);
  } else {
    updateSearchCount();
    clearSearchHighlights();
  }
}

function jumpToMatch(idx) {
  if (idx < 0 || idx >= searchMatches.length) return;
  searchCurrentIdx = idx;
  const m = searchMatches[idx];
  scrollToPage(m.page);
  updateSearchCount();
  // Wait one frame so the page slot is at least scheduled to render, then
  // refresh highlights. Pages that aren't yet rendered will be picked up
  // again via onPageTextLayerRendered.
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
