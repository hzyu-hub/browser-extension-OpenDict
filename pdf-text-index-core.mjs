// OpenDict PDF text indexing helpers.
// Shared by pdf-viewer.js and lightweight Node tests.

const SOFT_HYPHEN_RE = /\u00ad/g;
const WHITESPACE_RE = /\s+/g;
const WORD_FALLBACK_RE = /[\p{Script=Han}]+|[\p{Script=Hiragana}\p{Script=Katakana}]+|[\p{Script=Hangul}]+|[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

export function normalizeSearchQuery(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(SOFT_HYPHEN_RE, "")
    .replace(WHITESPACE_RE, " ")
    .trim()
    .toLowerCase();
}

// Normalize text extracted by PDF.js getTextContent().
// Returns two versions: one joined without separator (preserves split-word
// concatenation like ["lower","case"]→"lowercase") and one joined with
// space (preserves word boundaries like ["lower","case"]→"lower case").
// The search layer tries both.
export function normalizeCoarseText(items) {
  if (!items || !items.length) return { joined: "", spaced: "" };
  const strs = items.map((it) => (typeof it === "string" ? it : it?.str || ""));
  return {
    joined: normalizeSearchQuery(strs.join("")),
    spaced: normalizeSearchQuery(strs.join(" ")),
  };
}

function normalizeRawChar(ch) {
  if (ch === "\u00ad") return "";
  return ch.normalize("NFKC").toLowerCase();
}

function isWhitespace(ch) {
  return /\s/.test(ch);
}

function rectHeight(rect) {
  return rect ? rect.height || Math.max(0, rect.bottom - rect.top) : 0;
}

function sameLine(a, b) {
  if (!a || !b) return false;
  const h = Math.max(rectHeight(a), rectHeight(b), 1);
  const midA = (a.top + a.bottom) / 2;
  const midB = (b.top + b.bottom) / 2;
  return Math.abs(midA - midB) <= h * 0.65;
}

function shouldInsertSyntheticSpace(prevRun, run) {
  if (!prevRun?.rect || !run?.rect) return false;
  const h = Math.max(rectHeight(prevRun.rect), rectHeight(run.rect), 1);
  if (!sameLine(prevRun.rect, run.rect)) {
    const verticalGap = Math.max(
      0,
      Math.max(run.rect.top - prevRun.rect.bottom, prevRun.rect.top - run.rect.bottom),
    );
    return verticalGap > h * 0.2;
  }
  const gap = run.rect.left - prevRun.rect.right;
  return gap > h * 0.45;
}

function charRectForRun(run, offset, normalizedCharCount = 1) {
  const rect = run.rect;
  const text = String(run.text || "");
  if (!rect || !text.length) return null;
  const width = Math.max(0, rect.right - rect.left);
  const unit = width / Math.max(text.length, 1);
  const left = rect.left + unit * offset;
  const right = rect.left + unit * Math.max(offset + 1, offset + normalizedCharCount);
  return {
    left,
    right: Math.min(right, rect.right),
    top: rect.top,
    bottom: rect.bottom,
    width: Math.max(0, Math.min(right, rect.right) - left),
    height: rect.height || Math.max(0, rect.bottom - rect.top),
  };
}

function pushCanonicalChar(index, entry) {
  entry.canonicalIndex = index.chars.length;
  index.chars.push(entry);
  index.canonicalText += entry.canonicalChar;
}

export function buildTextIndexFromRuns(runs) {
  const index = {
    canonicalText: "",
    chars: [],
    tokens: [],
  };

  let prevRun = null;
  for (const run of runs || []) {
    const text = String(run?.text || "");
    if (!text) continue;

    if (
      prevRun &&
      shouldInsertSyntheticSpace(prevRun, run) &&
      !index.canonicalText.endsWith(" ") &&
      !isWhitespace(text[0])
    ) {
      pushCanonicalChar(index, {
        rawChar: "",
        canonicalChar: " ",
        node: null,
        rawOffset: -1,
        rawEndOffset: -1,
        rect: null,
        synthetic: true,
      });
    }

    for (let rawOffset = 0; rawOffset < text.length; rawOffset++) {
      const rawChar = text[rawOffset];
      let normalized = normalizeRawChar(rawChar);
      if (!normalized) continue;
      if (isWhitespace(normalized)) normalized = " ";

      for (const canonicalChar of normalized) {
        if (canonicalChar === " " && index.canonicalText.endsWith(" ")) continue;
        pushCanonicalChar(index, {
          rawChar,
          canonicalChar,
          node: run.node || null,
          rawOffset,
          rawEndOffset: rawOffset + 1,
          rect: charRectForRun(run, rawOffset, normalized.length),
          synthetic: false,
        });
      }
    }
    prevRun = run;
  }

  // Mirror query normalization: no leading/trailing search spaces.
  while (index.chars.length && index.chars[0].canonicalChar === " ") {
    index.chars.shift();
  }
  while (index.chars.length && index.chars[index.chars.length - 1].canonicalChar === " ") {
    index.chars.pop();
  }
  index.canonicalText = index.chars.map((c, i) => {
    c.canonicalIndex = i;
    return c.canonicalChar;
  }).join("");
  index.tokens = buildTokens(index.canonicalText);
  return index;
}

export function collectTextRunsFromTextLayer(textLayer) {
  if (!textLayer || typeof document === "undefined") return [];
  const runs = [];
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent || "";
    if (!text) continue;
    let rect = null;
    try {
      const range = document.createRange();
      range.selectNodeContents(node);
      rect = range.getBoundingClientRect();
      range.detach?.();
    } catch {}
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      rect = node.parentElement?.getBoundingClientRect?.() || null;
    }
    runs.push({ text, node, rect });
  }
  return runs;
}

export function buildTextIndexFromTextLayer(textLayer) {
  return buildTextIndexFromRuns(collectTextRunsFromTextLayer(textLayer));
}

export function buildTokens(canonicalText) {
  const text = String(canonicalText || "");
  if (!text) return [];

  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    try {
      const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
      return Array.from(segmenter.segment(text))
        .filter((s) => s.isWordLike)
        .map((s) => ({
          text: s.segment,
          start: s.index,
          end: s.index + s.segment.length,
        }));
    } catch {}
  }

  const tokens = [];
  for (const match of text.matchAll(WORD_FALLBACK_RE)) {
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
}

export function findTokenContaining(index, canonicalIndex) {
  if (!index || canonicalIndex < 0) return null;
  return index.tokens.find((t) => t.start <= canonicalIndex && canonicalIndex < t.end) || null;
}

export function buildDomRangesFromCanonicalRange(index, start, end) {
  const ranges = [];
  if (!index || start >= end) return ranges;

  for (let i = start; i < end && i < index.chars.length; i++) {
    const ch = index.chars[i];
    if (!ch || ch.synthetic || !ch.node) continue;
    const last = ranges[ranges.length - 1];
    if (last && last.node === ch.node && ch.rawOffset <= last.endOffset) {
      last.endOffset = Math.max(last.endOffset, ch.rawEndOffset);
      continue;
    }
    if (last && last.node === ch.node && ch.rawOffset === last.endOffset) {
      last.endOffset = ch.rawEndOffset;
      continue;
    }
    ranges.push({
      node: ch.node,
      startOffset: ch.rawOffset,
      endOffset: ch.rawEndOffset,
    });
  }
  return ranges;
}

export function findMatchesInIndex(index, query) {
  const needle = normalizeSearchQuery(query);
  if (!index || !needle) return [];
  const matches = [];
  let from = 0;
  while (from <= index.canonicalText.length - needle.length) {
    const start = index.canonicalText.indexOf(needle, from);
    if (start < 0) break;
    const end = start + needle.length;
    matches.push({
      start,
      end,
      ranges: buildDomRangesFromCanonicalRange(index, start, end),
    });
    from = end;
  }
  return matches;
}

function pointInRect(x, y, rect) {
  return rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function distanceToRect(x, y, rect) {
  const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
  const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
  return Math.hypot(dx, dy);
}

export function findCharIndexAtPoint(index, x, y, maxDistance = 8) {
  if (!index) return -1;
  let best = null;
  let bestDist = Infinity;
  for (const ch of index.chars) {
    if (!ch || ch.synthetic || !ch.rect) continue;
    if (pointInRect(x, y, ch.rect)) return ch.canonicalIndex;
    const midY = (ch.rect.top + ch.rect.bottom) / 2;
    const lineTolerance = Math.max(ch.rect.height || 1, 1) * 0.8;
    if (Math.abs(y - midY) > lineTolerance) continue;
    const dist = distanceToRect(x, y, ch.rect);
    if (dist < bestDist) {
      best = ch;
      bestDist = dist;
    }
  }
  return best && bestDist <= maxDistance ? best.canonicalIndex : -1;
}
