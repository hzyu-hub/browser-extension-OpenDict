// OpenDict PDF text indexing helpers.
// Shared by pdf-viewer.js and lightweight Node tests.

const SOFT_HYPHEN_RE = /\u00ad/g;
const WHITESPACE_RE = /\s+/g;
const MN_MC_RE = /\p{Mn}|\p{Mc}/gu;
const WORD_FALLBACK_RE = /[\p{Script=Han}]+|[\p{Script=Hiragana}\p{Script=Katakana}]+|[\p{Script=Hangul}]+|[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

export function isCombiningMark(cp) {
  return (cp >= 0x0300 && cp <= 0x036F) || // Combining Diacritical Marks
    (cp >= 0x0483 && cp <= 0x0489) || // Cyrillic combining
    (cp >= 0x0591 && cp <= 0x05BD) || // Hebrew
    (cp >= 0x05C1 && cp <= 0x05C2) ||
    (cp >= 0x05C4 && cp <= 0x05C5) ||
    (cp >= 0x05C7 && cp <= 0x05C7) ||
    (cp >= 0x0610 && cp <= 0x061A) || // Arabic
    (cp >= 0x064B && cp <= 0x065F) || // Arabic diacritics
    (cp >= 0x0670 && cp <= 0x0670) || // Arabic superscript alif
    (cp >= 0x06D6 && cp <= 0x06DC) ||
    (cp >= 0x06DF && cp <= 0x06E4) ||
    (cp >= 0x06E7 && cp <= 0x06E8) ||
    (cp >= 0x06EA && cp <= 0x06ED) ||
    (cp >= 0x093A && cp <= 0x093C) || // Devanagari
    (cp >= 0x093E && cp <= 0x094F) ||
    (cp >= 0x0951 && cp <= 0x0957) ||
    (cp >= 0x0962 && cp <= 0x0963) ||
    (cp >= 0x1AB0 && cp <= 0x1AFF) || // Combining Diacritical Marks Extended
    (cp >= 0x1DC0 && cp <= 0x1DFF) || // Combining Diacritical Marks Supplement
    (cp >= 0x20D0 && cp <= 0x20FF) || // Combining Diacritical Marks for Symbols
    (cp >= 0xFE20 && cp <= 0xFE2F) || // Combining Half Marks
    false;
}

export function normalizeSearchQuery(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(MN_MC_RE, "")
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
  const decomposed = ch.normalize("NFKD");
  let result = "";
  for (const c of decomposed) {
    const cp = c.codePointAt(0);
    if (!isCombiningMark(cp)) result += c;
  }
  return result.toLowerCase();
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

export function buildTextIndexFromRuns(runs, options = {}) {
 const index = {
 canonicalText: "",
 chars: [],
 tokens: [],
 reverseOffsets: null,
 forwardOffsets: null,
 };

 const canonicalRawMap = [];
 let globalRawPos = 0;

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
 canonicalRawMap.push(0xFFFFFFFF);
 }

 for (let rawOffset = 0; rawOffset < text.length; ) {
 const cp = text.codePointAt(rawOffset);
 const rawChar = String.fromCodePoint(cp);
 const rawCharLen = rawChar.length;
 let normalized = normalizeRawChar(rawChar);
 if (!normalized) {
 globalRawPos += rawCharLen;
 rawOffset += rawCharLen;
 continue;
 }
 if (isWhitespace(normalized)) normalized = " ";

 for (const canonicalChar of normalized) {
 if (canonicalChar === " " && index.canonicalText.endsWith(" ")) continue;
 pushCanonicalChar(index, {
 rawChar,
 canonicalChar,
 node: run.node || null,
 rawOffset,
 rawEndOffset: rawOffset + rawCharLen,
 rect: charRectForRun(run, rawOffset, normalized.length),
 synthetic: false,
 });
 canonicalRawMap.push(globalRawPos);
 }
 globalRawPos += rawCharLen;
 rawOffset += rawCharLen;
 }
 prevRun = run;
 }

 // Mirror query normalization: no leading/trailing search spaces.
 while (index.chars.length && index.chars[0].canonicalChar === " ") {
 index.chars.shift();
 canonicalRawMap.shift();
 }
 while (index.chars.length && index.chars[index.chars.length - 1].canonicalChar === " ") {
 index.chars.pop();
 canonicalRawMap.pop();
 }
 index.canonicalText = index.chars.map((c, i) => {
 c.canonicalIndex = i;
 return c.canonicalChar;
 }).join("");
 index.tokens = buildTokens(index.canonicalText);

 // Build reverseOffsets: canonicalIdx → globalRawPos
 index.reverseOffsets = new Uint32Array(index.chars.length);
 for (let i = 0; i < index.chars.length; i++) {
 index.reverseOffsets[i] = canonicalRawMap[i];
 }

 // Build forwardOffsets: globalRawPos → canonicalIdx (0xFFFFFFFF for synthetic/unused)
 if (globalRawPos > 0) {
 index.forwardOffsets = new Uint32Array(globalRawPos).fill(0xFFFFFFFF);
 for (let ci = 0; ci < index.chars.length; ci++) {
 if (!index.chars[ci].synthetic) {
 index.forwardOffsets[index.reverseOffsets[ci]] = ci;
 }
 }
 } else {
 index.forwardOffsets = new Uint32Array(0);
 }

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

export function buildTextIndexFromTextLayer(textLayer, options = {}) {
 return buildTextIndexFromRuns(collectTextRunsFromTextLayer(textLayer), options);
}

function isCJK(cp) {
  return (cp >= 0x4E00 && cp <= 0x9FFF) || // CJK Unified Ideographs
    (cp >= 0x3400 && cp <= 0x4DBF) || // CJK Extension A
    (cp >= 0x3040 && cp <= 0x309F) || // Hiragana
    (cp >= 0x30A0 && cp <= 0x30FF) || // Katakana
    (cp >= 0xAC00 && cp <= 0xD7AF) || // Hangul Syllables
    (cp >= 0xF900 && cp <= 0xFAFF) || // CJK Compatibility Ideographs
    (cp >= 0x31F0 && cp <= 0x31FF) || // Katakana Phonetic Extensions
    (cp >= 0xFF66 && cp <= 0xFF9F);   // Halfwidth Katakana
}

function isLatinWordChar(cp) {
  return (cp >= 0x0041 && cp <= 0x005A) || // A-Z
    (cp >= 0x0061 && cp <= 0x007A) || // a-z
    (cp >= 0x00C0 && cp <= 0x024F) || // Latin Extended
    (cp >= 0x0400 && cp <= 0x04FF) || // Cyrillic
    (cp >= 0x0370 && cp <= 0x03FF);   // Greek
}

function isDigit(cp) {
  return cp >= 0x0030 && cp <= 0x0039;
}

function buildTokensV2(text) {
  if (!text) return [];
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const chLen = ch.length;

    if (isCJK(cp)) {
      tokens.push({ text: ch, start: i, end: i + chLen });
      i += chLen;
      continue;
    }

    // Try number-unit compound (digit-led)
    if (isDigit(cp)) {
      const rest = text.slice(i);
      const m = rest.match(/^(\d+(?:\.\d+)*(?:[\/\-:]\d+(?:\.\d+)*)*[a-zA-Z\/]+)/);
      if (m) {
        tokens.push({ text: m[1], start: i, end: i + m[1].length });
        i += m[1].length;
        continue;
      }
      // Pure number
      const m2 = rest.match(/^(\d+(?:\.\d+)*(?:[\/\-:]\d+(?:\.\d+)*)*)/);
      if (m2) {
        tokens.push({ text: m2[1], start: i, end: i + m2[1].length });
        i += m2[1].length;
        continue;
      }
    }

    // Try letter-led number compound (v2.0, pH7)
    if (isLatinWordChar(cp)) {
      const rest = text.slice(i);
      const m = rest.match(/^([a-zA-Z]+\d+(?:\.\d+)*(?:[\/\-:]\d+(?:\.\d+)*)*)/);
      if (m && m[1].length > 1) {
        tokens.push({ text: m[1], start: i, end: i + m[1].length });
        i += m[1].length;
        continue;
      }
      // Latin word with internal apostrophe/hyphen
      const m2 = rest.match(/^([a-zA-Z\u00C0-\u024F\u0400-\u04FF\u0370-\u03FF]+(?:['\u2019\u2018\-][a-zA-Z\u00C0-\u024F\u0400-\u04FF\u0370-\u03FF]+)*)/);
      if (m2) {
        tokens.push({ text: m2[1], start: i, end: i + m2[1].length });
        i += m2[1].length;
        continue;
      }
    }

    i += chLen; // skip punctuation, whitespace
  }
  return tokens;
}

function buildTokensLegacy(text) {
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

export function buildTokens(canonicalText, options = {}) {
  const text = String(canonicalText || "");
  if (!text) return [];
  if (options.v2) return buildTokensV2(text);
  return buildTokensLegacy(text);
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

export function resolveCanonicalToRaw(index, canonicalIdx) {
  if (!index || canonicalIdx < 0 || canonicalIdx >= index.reverseOffsets.length) return -1;
  return index.reverseOffsets[canonicalIdx];
}

export function buildWhitespaceSkipTable(canonicalText) {
  let nonWsCount = 0;
  for (let i = 0; i < canonicalText.length; i++) {
    if (!isWhitespace(canonicalText[i])) nonWsCount++;
  }
  const TableType = nonWsCount <= 65535 ? Uint16Array : Uint32Array;
  const table = new TableType(nonWsCount);
  let sIdx = 0;
  for (let cIdx = 0; cIdx < canonicalText.length; cIdx++) {
    if (!isWhitespace(canonicalText[cIdx])) {
      table[sIdx++] = cIdx;
    }
  }
  return table;
}

export function findMatchesWhitespaceTolerant(index, query) {
  const needle = normalizeSearchQuery(query);
  if (!index || !needle) return [];
  const strippedNeedle = needle.replace(/\s+/g, "");
  if (!strippedNeedle) return [];
  if (!index._wsSkipTable) {
    index._wsSkipTable = buildWhitespaceSkipTable(index.canonicalText);
  }
  const strippedHaystack = index.canonicalText.replace(/\s+/g, "");
  const skipTable = index._wsSkipTable;
  const matches = [];
  let from = 0;
  while (from <= strippedHaystack.length - strippedNeedle.length) {
    const strippedStart = strippedHaystack.indexOf(strippedNeedle, from);
    if (strippedStart < 0) break;
    const strippedEnd = strippedStart + strippedNeedle.length;
    const canonicalStart = skipTable[strippedStart];
    const canonicalEnd =
      strippedEnd > 0 && strippedEnd - 1 < skipTable.length
        ? skipTable[strippedEnd - 1] + 1
        : index.canonicalText.length;
    matches.push({
      start: canonicalStart,
      end: canonicalEnd,
      type: "whitespace",
      ranges: buildDomRangesFromCanonicalRange(index, canonicalStart, canonicalEnd),
    });
    from = strippedEnd;
  }
  return matches;
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
