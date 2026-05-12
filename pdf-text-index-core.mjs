// OpenDict PDF text indexing helpers.
// Shared by pdf-viewer.js and lightweight Node tests.

import { fuzzySearch, fuzzyScore } from "./pdf-search-fuzzy.mjs";

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
  const gap = Math.max(0, run.rect.left - prevRun.rect.right);
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

 const nodeOffset = run._nodeOffset || 0;
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
 rawOffset: rawOffset + nodeOffset,
 rawEndOffset: rawOffset + rawCharLen + nodeOffset,
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
  const wrapperRect = textLayer.getBoundingClientRect();
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
    if (!rect) {
      runs.push({ text, node, rect: null });
      continue;
    }

    // Detect multi-line text nodes: if the rect height is much taller than
    // a single line (estimated from the parent's font size), split into
    // per-line sub-runs using per-character Range measurements.
    let estimatedLineHeight = rect.height;
    try {
      const fontSize = parseFloat(
        getComputedStyle(node.parentElement).fontSize || "12"
      );
      estimatedLineHeight = fontSize * 1.4;
    } catch {}

    const isMultiLine = rect.height > estimatedLineHeight * 1.4;

    if (!isMultiLine) {
      // Single-line fast path — store wrapper-relative rect as before
      runs.push({
        text,
        node,
        rect: {
          left: rect.left - wrapperRect.left,
          right: rect.right - wrapperRect.left,
          top: rect.top - wrapperRect.top,
          bottom: rect.bottom - wrapperRect.top,
          width: rect.width,
          height: rect.height,
        },
      });
      continue;
    }

    // Multi-line: measure each character's rect and group by line
    const charRects = [];
    const range = document.createRange();
    for (let i = 0; i < text.length; i++) {
      try {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const cr = range.getBoundingClientRect();
        charRects.push({
          index: i,
          top: cr.top - wrapperRect.top,
          bottom: cr.bottom - wrapperRect.top,
          left: cr.left - wrapperRect.left,
          right: cr.right - wrapperRect.left,
          width: cr.width,
          height: cr.height,
        });
      } catch {
        // Fallback: use the whole-node rect for this char
        charRects.push({
          index: i,
          top: rect.top - wrapperRect.top,
          bottom: rect.bottom - wrapperRect.top,
          left: rect.left - wrapperRect.left,
          right: rect.right - wrapperRect.left,
          width: rect.width / text.length,
          height: rect.height,
        });
      }
    }
    range.detach?.();

    // Group consecutive characters that share the same visual line
    // (midpoints within 65% of line height of each other)
    const groups = [];
    let currentGroup = [charRects[0]];
    for (let i = 1; i < charRects.length; i++) {
      const prev = currentGroup[currentGroup.length - 1];
      const curr = charRects[i];
      const prevMid = (prev.top + prev.bottom) / 2;
      const currMid = (curr.top + curr.bottom) / 2;
      const h = Math.max(prev.height, curr.height, 1);
      if (Math.abs(currMid - prevMid) <= h * 0.65) {
        currentGroup.push(curr);
      } else {
        groups.push(currentGroup);
        currentGroup = [curr];
      }
    }
    if (currentGroup.length) groups.push(currentGroup);

    // Emit one run per line-group
    for (const group of groups) {
      const startIdx = group[0].index;
      const endIdx = group[group.length - 1].index + 1;
      const subText = text.slice(startIdx, endIdx);
      // Compute bounding rect for this line group
      let gLeft = Infinity, gRight = -Infinity, gTop = Infinity, gBottom = -Infinity;
      for (const cr of group) {
        if (cr.left < gLeft) gLeft = cr.left;
        if (cr.right > gRight) gRight = cr.right;
        if (cr.top < gTop) gTop = cr.top;
        if (cr.bottom > gBottom) gBottom = cr.bottom;
      }
      runs.push({
        text: subText,
        node,
        rect: {
          left: gLeft,
          right: gRight,
          top: gTop,
          bottom: gBottom,
          width: gRight - gLeft,
          height: gBottom - gTop,
        },
        // Store the raw offset within the text node so charRectForRun
        // uniform division still works correctly for this sub-run
        _nodeOffset: startIdx,
      });
    }
  }
  return runs;
}

export function buildTextIndexFromTextLayer(textLayer, options = {}) {
 const index = buildTextIndexFromRuns(collectTextRunsFromTextLayer(textLayer), options);
 index._textLayer = textLayer;
 return index;
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

export function applyHyphenJoinHeuristic(tokens, canonicalText) {
  if (!tokens || tokens.length <= 1) return tokens || [];
  if (!canonicalText) return tokens;
  const result = [tokens[0]];
  for (let i = 1; i < tokens.length; i++) {
    const prev = result[result.length - 1];
    const curr = tokens[i];
    const gap = canonicalText.slice(prev.end, curr.start);
    // Heuristic: if gap is a hyphen (possibly followed by whitespace/newline),
    // merge the two tokens into one
    if (/^[-\u2010\u2011\u2012\u2013\u2014\u2015]\s*$/.test(gap)) {
      prev.text = prev.text + curr.text;
      prev.end = curr.end;
    } else {
      result.push(curr);
    }
  }
  return result;
}

export function findTokenContaining(index, canonicalIndex) {
  if (!index || canonicalIndex < 0) return null;
  return index.tokens.find((t) => t.start <= canonicalIndex && canonicalIndex < t.end) || null;
}

/**
 * Expand from a character index to word boundaries in canonical text.
 * - Stops at whitespace and common punctuation.
 * - CJK characters are treated as single-char words.
 * - Combining marks are kept attached to their base character.
 * Returns { start, end } (end is exclusive) or null if charIndex is out of range.
 */
export function expandToWordBoundaries(text, charIndex) {
  if (!text || charIndex < 0 || charIndex >= text.length) return null;

  const cp = text.codePointAt(charIndex);
  const ch = String.fromCodePoint(cp);

  // Whitespace: no word to select
  if (/\s/.test(ch)) return null;

  // Punctuation: no word to select
  if (isWordBoundaryPunct(cp)) return null;

  // CJK: each character is its own word
  if (isCJK(cp)) {
    return { start: charIndex, end: charIndex + ch.length };
  }

  // Expand left
  let start = charIndex;
  while (start > 0) {
    const prevCp = text.codePointAt(start - 1);
    // Handle surrogate pairs: step back 2 if we're at a low surrogate
    let prevLen = 1;
    if (start >= 2) {
      const possibleHighSurrogate = text.charCodeAt(start - 2);
      if (possibleHighSurrogate >= 0xD800 && possibleHighSurrogate <= 0xDBFF) {
        prevLen = 2;
      }
    }
    const actualCp = prevLen === 2 ? text.codePointAt(start - 2) : prevCp;
    const actualLen = String.fromCodePoint(actualCp).length;

    if (isCombiningMark(actualCp)) {
      start -= actualLen;
      continue;
    }
    if (isCJK(actualCp) || /\s/.test(String.fromCodePoint(actualCp)) || isWordBoundaryPunct(actualCp)) {
      break;
    }
    start -= actualLen;
  }

  // Expand right
  let end = charIndex + ch.length;
  while (end < text.length) {
    const nextCp = text.codePointAt(end);
    const nextCh = String.fromCodePoint(nextCp);
    const nextLen = nextCh.length;

    if (isCombiningMark(nextCp)) {
      end += nextLen;
      continue;
    }
    if (isCJK(nextCp) || /\s/.test(nextCh) || isWordBoundaryPunct(nextCp)) {
      break;
    }
    end += nextLen;
  }

  // Include any trailing combining marks
  while (end < text.length) {
    const nextCp = text.codePointAt(end);
    if (!isCombiningMark(nextCp)) break;
    end += String.fromCodePoint(nextCp).length;
  }

  return start < end ? { start, end } : null;
}

function isWordBoundaryPunct(cp) {
  // Common punctuation that should break words
  const ch = String.fromCodePoint(cp);
  return /[.,;:!?()[\]{}"'<>\/\\@#$%^&*~`|+=\u2010-\u2015\u2018-\u201F\u2026\u3001\u3002\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]/.test(ch);
}

export function buildDomRangesFromCanonicalRange(index, start, end) {
  const ranges = [];
  if (!index || start >= end) return ranges;

  for (let i = start; i < end && i < index.chars.length; i++) {
    const ch = index.chars[i];
    if (!ch || ch.synthetic || !ch.node) continue;
    const last = ranges[ranges.length - 1];
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
 index._strippedHaystack = index.canonicalText.replace(/\s+/g, "");
 }
 const strippedHaystack = index._strippedHaystack;
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

export function findMatchesFuzzy(index, query, maxEditDist, options = {}) {
  if (options.fuzzy === false) return [];
  const needle = normalizeSearchQuery(query);
  if (!index || !needle || needle.length > 64) return [];
 if (!index._wsSkipTable) {
 index._wsSkipTable = buildWhitespaceSkipTable(index.canonicalText);
 index._strippedHaystack = index.canonicalText.replace(/\s+/g, "");
 }
 const strippedHaystack = index._strippedHaystack;
 const strippedNeedle = needle.replace(/\s+/g, "");
  const skipTable = index._wsSkipTable;
  const results = fuzzySearch(strippedHaystack, strippedNeedle, maxEditDist);
  return results
    .filter(r => fuzzyScore(r.editDistance, strippedNeedle.length) >= 0.8)
    .map(r => {
      const canonicalStart = skipTable[r.start];
      const canonicalEnd =
        (r.end > 0 && r.end - 1 < skipTable.length)
          ? skipTable[r.end - 1] + 1
          : index.canonicalText.length;
      return {
        start: canonicalStart,
        end: canonicalEnd,
        editDistance: r.editDistance,
        score: fuzzyScore(r.editDistance, strippedNeedle.length),
        type: "approximate",
        ranges: buildDomRangesFromCanonicalRange(index, canonicalStart, canonicalEnd),
      };
    });
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
  // Convert viewport-relative clientX/clientY to wrapper-relative coordinates
  // to match the wrapper-relative rects stored at build time.
  if (index._textLayer) {
    const wr = index._textLayer.getBoundingClientRect();
    x = x - wr.left;
    y = y - wr.top;
  }
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
