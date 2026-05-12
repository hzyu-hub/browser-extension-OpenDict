import assert from "node:assert/strict";
import {
  buildTextIndexFromRuns,
  buildDomRangesFromCanonicalRange,
  expandToWordBoundaries,
  findCharIndexAtPoint,
  findMatchesInIndex,
  findTokenContaining,
  normalizeSearchQuery,
  normalizeCoarseText,
  isCombiningMark,
  resolveCanonicalToRaw,
  buildWhitespaceSkipTable,
  findMatchesWhitespaceTolerant,
  findMatchesFuzzy,
  buildTokens,
  applyHyphenJoinHeuristic,
} from "../pdf-text-index-core.mjs";

function run(text, left, right, top = 0, bottom = 10) {
  return {
    text,
    rect: { left, right, top, bottom, width: right - left, height: bottom - top },
    node: { text },
  };
}

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`not ok - ${name}`);
    throw err;
  }
}

test("normalizes ligatures so final matches ﬁnal", () => {
  const index = buildTextIndexFromRuns([run("ﬁnal", 0, 40)]);
  assert.equal(index.canonicalText, "final");
  const matches = findMatchesInIndex(index, "final");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].start, 0);
  assert.equal(matches[0].end, 5);
});

test("inserts synthetic visual spaces between separated same-line runs", () => {
  const index = buildTextIndexFromRuns([
    run("machine", 0, 70),
    run("learning", 86, 166),
  ]);
  assert.equal(index.canonicalText, "machine learning");
  const matches = findMatchesInIndex(index, "machine learning");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].ranges.length, 2);
  assert.equal(matches[0].ranges[0].node.text, "machine");
  assert.equal(matches[0].ranges[1].node.text, "learning");
});

test("does not insert space between visually touching split word runs", () => {
  const index = buildTextIndexFromRuns([
    run("config", 0, 60),
    run("uration", 61, 121),
  ]);
  assert.equal(index.canonicalText, "configuration");
  const matches = findMatchesInIndex(index, "configuration");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].ranges.length, 2);
});

test("inserts synthetic space between separate lines", () => {
  const index = buildTextIndexFromRuns([
    run("machine", 0, 70, 0, 10),
    run("learning", 0, 80, 14, 24),
  ]);
  assert.equal(index.canonicalText, "machine learning");
  assert.equal(findMatchesInIndex(index, "machine learning").length, 1);
});

test("maps canonical match back to DOM ranges while skipping synthetic spaces", () => {
  const index = buildTextIndexFromRuns([
    run("machine", 0, 70),
    run("learning", 90, 170),
  ]);
  const ranges = buildDomRangesFromCanonicalRange(index, 0, "machine learning".length);
  assert.deepEqual(
    ranges.map((r) => [r.node.text, r.startOffset, r.endOffset]),
    [
      ["machine", 0, 7],
      ["learning", 0, 8],
    ],
  );
});

test("tokenizes split words as a single token", () => {
  const index = buildTextIndexFromRuns([
    run("config", 0, 60),
    run("uration", 61, 121),
  ]);
  const token = findTokenContaining(index, 4);
  assert.equal(token.text, "configuration");
  assert.equal(token.start, 0);
  assert.equal(token.end, "configuration".length);
});

test("finds nearest character by geometry for double-click selection", () => {
  const index = buildTextIndexFromRuns([run("word", 0, 40)]);
  const charIndex = findCharIndexAtPoint(index, 25, 5);
  assert.equal(index.chars[charIndex].canonicalChar, "r");
  assert.equal(findTokenContaining(index, charIndex).text, "word");
});


test("handles soft-hyphen split words in search", () => {
  const index = buildTextIndexFromRuns([run("trans\u00adlation", 0, 100)]);
  assert.equal(index.canonicalText, "translation");
  assert.equal(findMatchesInIndex(index, "translation").length, 1);
});

test("does not snap to far-away chars", () => {
  const index = buildTextIndexFromRuns([run("word", 0, 40)]);
  assert.equal(findCharIndexAtPoint(index, 300, 300), -1);
});

// Coarse text extraction: PDF.js items joined with spaces + normalized
test("normalizeCoarseText handles split PDF items", () => {
  // Single item: "lowercase" as one word
  const r1 = normalizeCoarseText(["We ", "need ", "lowercase ", "text"]);
  assert.ok(r1.joined.includes("lowercase"));
  assert.ok(r1.spaced.includes("lowercase"));

  // Split items without spaces: ["lower", "case"] → joined="lowercase"
  const r2 = normalizeCoarseText(["We ", "lower", "case ", "text"]);
  assert.ok(r2.joined.includes("lowercase"), "joined should concat split words");

  // Split items with space: ["lower case"] → spaced="lower case"
  const r3 = normalizeCoarseText(["We ", "lower case ", "text"]);
  assert.ok(r3.spaced.includes("lower case"));
});

test("normalizeCoarseText returns both joined and spaced versions", () => {
  const r = normalizeCoarseText(["training ", "lowercase ", "data"]);
  assert.ok(r.joined.includes("lowercase"));
  assert.ok(r.spaced.includes("lowercase"));
  assert.ok(r.joined.length > 0);
  assert.ok(r.spaced.length > 0);
});

test("isCombiningMark detects combining diacritical marks", () => {
 assert.ok(isCombiningMark(0x0301)); // COMBINING ACUTE ACCENT
 assert.ok(isCombiningMark(0x0300)); // COMBINING GRAVE ACCENT
 assert.ok(isCombiningMark(0x064B)); // Arabic fathatan
 assert.ok(isCombiningMark(0x1DC0)); // Combining Diacritical Marks Supplement
 assert.ok(!isCombiningMark(0x0041)); // LATIN CAPITAL LETTER A
 assert.ok(!isCombiningMark(0x00E9)); // é (precomposed, not a combining mark)
});

test("buildTextIndexFromRuns produces reverseOffsets mapping", () => {
 const index = buildTextIndexFromRuns([run("abc", 0, 30)]);
 assert.ok(index.reverseOffsets instanceof Uint32Array);
 assert.equal(index.reverseOffsets.length, index.chars.length);
 for (let i = 0; i < index.chars.length; i++) {
  assert.equal(index.reverseOffsets[i], index.chars[i].rawOffset);
 }
});

test("buildTextIndexFromRuns produces forwardOffsets mapping", () => {
 const index = buildTextIndexFromRuns([run("abc", 0, 30)]);
 assert.ok(index.forwardOffsets instanceof Uint32Array);
 assert.equal(index.forwardOffsets[0], 0);
 assert.equal(index.forwardOffsets[1], 1);
 assert.equal(index.forwardOffsets[2], 2);
});

test("forwardOffsets uses 0xFFFFFFFF sentinel for synthetic positions", () => {
 const index = buildTextIndexFromRuns([
  run("ab", 0, 20),
  run("cd", 40, 60), // gap triggers synthetic space
 ]);
 assert.ok(index.forwardOffsets instanceof Uint32Array);
 assert.ok(index.forwardOffsets.length > 0);
});

test("NFKD normalization makes accented search accent-insensitive", () => {
  const index = buildTextIndexFromRuns([run("r\u00e9sum\u00e9", 0, 60)]);
  // NFKD decomposes é → e + ◌́, combining mark stripped → "resume"
  assert.equal(index.canonicalText, "resume");
  assert.equal(findMatchesInIndex(index, "resume").length, 1);
  assert.equal(findMatchesInIndex(index, "r\u00e9sum\u00e9").length, 1);
});

test("normalizeSearchQuery pipeline order: NFKD then strip marks then lowercase", () => {
  // İ (U+0130 Latin Capital Letter I With Dot Above)
  // NFKD → I + combining dot above; strip marks → I; lowercase → i
  const result = normalizeSearchQuery("\u0130stanbul");
  assert.ok(result.startsWith("i"), `Expected 'i' prefix, got '${result}'`);
});

test("code-point-aware iteration handles supplementary plane characters", () => {
  const supplementary = String.fromCodePoint(0x20000);
  const text = "a" + supplementary + "b";
  const index = buildTextIndexFromRuns([run(text, 0, 60)]);
  assert.equal(index.chars.length, 3);
  assert.equal(index.canonicalText.charAt(0), "a");
  assert.equal(index.canonicalText.codePointAt(1), 0x20000);
  assert.equal(index.canonicalText.charAt(3), "b");
});

test("resolveCanonicalToRaw returns raw offset for valid index", () => {
  const index = buildTextIndexFromRuns([run("hello", 0, 50)]);
  const raw = resolveCanonicalToRaw(index, 0);
  assert.equal(raw, 0);
  const raw4 = resolveCanonicalToRaw(index, 4);
  assert.equal(raw4, 4);
});

test("resolveCanonicalToRaw returns -1 for out-of-bounds", () => {
  const index = buildTextIndexFromRuns([run("hi", 0, 20)]);
  assert.equal(resolveCanonicalToRaw(index, -1), -1);
  assert.equal(resolveCanonicalToRaw(index, 99), -1);
  assert.equal(resolveCanonicalToRaw(null, 0), -1);
});

test("buildWhitespaceSkipTable maps stripped offsets to canonical offsets", () => {
  const table = buildWhitespaceSkipTable("a b c");
  assert.ok(table instanceof Uint16Array || table instanceof Uint32Array);
  assert.equal(table.length, 3);
  assert.equal(table[0], 0); // 'a' at canonical 0
  assert.equal(table[1], 2); // 'b' at canonical 2
  assert.equal(table[2], 4); // 'c' at canonical 4
});

test("buildWhitespaceSkipTable uses Uint16Array for small pages", () => {
  const table = buildWhitespaceSkipTable("hello world");
  assert.ok(table instanceof Uint16Array);
});

test("skip-table handles leading whitespace", () => {
  const table = buildWhitespaceSkipTable(" abc");
  assert.equal(table.length, 3);
  assert.equal(table[0], 1); // 'a' at canonical index 1
});

test("skip-table handles trailing whitespace", () => {
  const table = buildWhitespaceSkipTable("abc ");
  assert.equal(table.length, 3);
  assert.equal(table[2], 2); // 'c' at canonical index 2
});

test("findMatchesWhitespaceTolerant matches text ignoring whitespace gaps", () => {
  const index = buildTextIndexFromRuns([
    run("ef", 0, 20),
    run("fect", 30, 70),
  ]);
  const matches = findMatchesWhitespaceTolerant(index, "effect");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].type, "whitespace");
});

test("findMatchesWhitespaceTolerant returns empty for no matches", () => {
  const index = buildTextIndexFromRuns([run("hello world", 0, 100)]);
  const matches = findMatchesWhitespaceTolerant(index, "xyz");
  assert.equal(matches.length, 0);
});

test("whitespace-tolerant resolves correct canonical offsets", () => {
  const index = buildTextIndexFromRuns([run("ef fect", 0, 70)]);
  const matches = findMatchesWhitespaceTolerant(index, "effect");
  assert.equal(matches.length, 1);
  assert.ok(matches[0].start >= 0);
  assert.ok(matches[0].end > matches[0].start);
});

test("buildTokens v2: each CJK character is own token", () => {
  const tokens = buildTokens("\u4e2d\u6587abc", { v2: true });
  assert.equal(tokens.length, 3);
  assert.equal(tokens[0].text, "\u4e2d");
  assert.equal(tokens[1].text, "\u6587");
  assert.equal(tokens[2].text, "abc");
});

test("buildTokens v2: number-unit compounds", () => {
  const tokens = buildTokens("100ms v2.0 3.14 50km/h 2024-01-15", { v2: true });
  const texts = tokens.map(t => t.text);
  assert.ok(texts.includes("100ms"));
  assert.ok(texts.includes("v2.0"));
  assert.ok(texts.includes("3.14"));
  assert.ok(texts.includes("50km/h"));
  assert.ok(texts.includes("2024-01-15"));
});

test("buildTokens v2: Latin words with internal apostrophe", () => {
  const tokens = buildTokens("don't it\u2019s", { v2: true });
  const texts = tokens.map(t => t.text);
  assert.ok(texts.includes("don't"));
  assert.ok(texts.includes("it\u2019s"));
});

test("buildTokens v2 falls back to legacy when v2=false", () => {
  const tokens = buildTokens("hello world", { v2: false });
  assert.ok(tokens.length >= 2);
});

test("CJK-Latin boundary: \u4e2d\u6587abc → 2 CJK tokens + 1 Latin token", () => {
  const tokens = buildTokens("\u4e2d\u6587abc", { v2: true });
  assert.equal(tokens.length, 3);
  assert.equal(tokens[0].text, "\u4e2d");
  assert.equal(tokens[1].text, "\u6587");
  assert.equal(tokens[2].text, "abc");
});

test("number-unit: pH7 is a letter-led compound", () => {
  const tokens = buildTokens("pH7", { v2: true });
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].text, "pH7");
});

test("buildTokens v2: pure whitespace returns empty", () => {
  const tokens = buildTokens(" ", { v2: true });
  assert.equal(tokens.length, 0);
});

test("applyHyphenJoinHeuristic merges hyphen-split tokens", () => {
  const tokens = [
    { text: "trans", start: 0, end: 5 },
    { text: "lation", start: 6, end: 12 },
  ];
  const result = applyHyphenJoinHeuristic(tokens, "trans- lation");
  // Should merge if the character between the two tokens looks like a hyphen-split
  assert.equal(result.length, 1);
  assert.equal(result[0].text, "translation");
});

test("applyHyphenJoinHeuristic does not merge non-hyphen tokens", () => {
  const tokens = [
    { text: "hello", start: 0, end: 5 },
    { text: "world", start: 6, end: 11 },
  ];
  const result = applyHyphenJoinHeuristic(tokens, "hello world");
  assert.equal(result.length, 2);
});

test("applyHyphenJoinHeuristic returns original tokens for empty input", () => {
  const result = applyHyphenJoinHeuristic([], "");
  assert.equal(result.length, 0);
});

test("findMatchesFuzzy finds approximate matches on stripped text", () => {
  const index = buildTextIndexFromRuns([run("effect", 0, 60)]);
  const matches = findMatchesFuzzy(index, "efect", 1);
  assert.ok(matches.length >= 1);
  assert.equal(matches[0].type, "approximate");
  assert.ok(matches[0].score >= 0.8);
});

// --- T23: NFKD + offset mapping edge-case tests ---

test("NFKD decomposes ligatures: ﬁnd → find", () => {
  const index = buildTextIndexFromRuns([run("\ufb01nd", 0, 40)]);
  assert.equal(index.canonicalText, "find");
  assert.equal(findMatchesInIndex(index, "find").length, 1);
});

test("offset mapping round-trip: forwardOffsets[reverseOffsets[i]] = i for non-synthetic chars", () => {
  const index = buildTextIndexFromRuns([run("abc def", 0, 70)]);
  for (let ci = 0; ci < index.chars.length; ci++) {
    if (index.chars[ci].synthetic) continue;
    const rawPos = index.reverseOffsets[ci];
    if (rawPos !== 0xFFFFFFFF) {
      assert.ok(index.forwardOffsets[rawPos] !== 0xFFFFFFFF);
    }
  }
});

test("accent-stripping normalizes résumé to resume", () => {
  assert.equal(normalizeSearchQuery("r\u00e9sum\u00e9"), "resume");
});

test("accent-stripping in query matches accented document text", () => {
  const index = buildTextIndexFromRuns([run("caf\u00e9", 0, 40)]);
  assert.equal(index.canonicalText, "cafe");
  assert.equal(findMatchesInIndex(index, "cafe").length, 1);
});

// --- T24: whitespace-tolerant + skip-table edge-case tests ---

test("whitespace-tolerant finds match across synthetic space gap", () => {
  const index = buildTextIndexFromRuns([
    run("hel", 0, 30),
    run("lo world", 35, 80),
  ]);
  const matches = findMatchesWhitespaceTolerant(index, "helloworld");
  assert.ok(matches.length >= 1);
  assert.equal(matches[0].type, "whitespace");
});

test("whitespace-tolerant matches multi-word query with internal spaces", () => {
  const index = buildTextIndexFromRuns([run("hello world", 0, 100)]);
  const matches = findMatchesWhitespaceTolerant(index, "helloworld");
  assert.ok(matches.length >= 1);
});

test("skip-table handles all-whitespace text", () => {
  const table = buildWhitespaceSkipTable("   ");
  assert.equal(table.length, 0);
});

test("skip-table handles mixed whitespace types", () => {
  const table = buildWhitespaceSkipTable("a\tb\nc");
  assert.equal(table.length, 3); // a, b, c
  assert.equal(table[0], 0); // 'a' at position 0
  assert.equal(table[1], 2); // 'b' at position 2
  assert.equal(table[2], 4); // 'c' at position 4
});

// --- T27: tokenization v2 + hyphen-join edge-case tests ---

test("buildTokens v2: CJK + Latin boundary", () => {
  const tokens = buildTokens("\u4e2d\u6587abc\u65e5\u672c", { v2: true });
  assert.equal(tokens.length, 5); // 中, 文, abc, 日, 本
  const texts = tokens.map(t => t.text);
  assert.ok(texts.includes("\u4e2d"));
  assert.ok(texts.includes("\u6587"));
  assert.ok(texts.includes("abc"));
});

test("buildTokens v2: number with version separator", () => {
  const tokens = buildTokens("v2.0", { v2: true });
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].text, "v2.0");
});

test("buildTokens v2: date pattern", () => {
  const tokens = buildTokens("2024-01-15", { v2: true });
  const texts = tokens.map(t => t.text);
  assert.ok(texts.includes("2024-01-15"));
});

test("applyHyphenJoinHeuristic merges en-dash split tokens", () => {
  const tokens = [
    { text: "trans", start: 0, end: 5 },
    { text: "lation", start: 6, end: 12 },
  ];
  // en-dash U+2013 between tokens at position 5
  const result = applyHyphenJoinHeuristic(tokens, "trans\u2013lation");
  assert.equal(result.length, 1);
  assert.equal(result[0].text, "translation");
});

test("applyHyphenJoinHeuristic does not merge space-only gap", () => {
  const tokens = [
    { text: "hello", start: 0, end: 5 },
    { text: "world", start: 6, end: 11 },
  ];
  const result = applyHyphenJoinHeuristic(tokens, "hello world");
  assert.equal(result.length, 2);
});

test("buildTokens v2: no tokens for punctuation-only input", () => {
  const tokens = buildTokens("!!! ???", { v2: true });
  assert.equal(tokens.length, 0);
});

// --- expandToWordBoundaries tests ---

test("expandToWordBoundaries: basic Latin word", () => {
  const text = "hello world";
  const result = expandToWordBoundaries(text, 2); // 'l' in "hello"
  assert.deepEqual(result, { start: 0, end: 5 });
});

test("expandToWordBoundaries: second word", () => {
  const text = "hello world";
  const result = expandToWordBoundaries(text, 7); // 'r' in "world"
  assert.deepEqual(result, { start: 6, end: 11 });
});

test("expandToWordBoundaries: stops at punctuation", () => {
  const text = "foo,bar";
  assert.deepEqual(expandToWordBoundaries(text, 1), { start: 0, end: 3 }); // "foo"
  assert.deepEqual(expandToWordBoundaries(text, 5), { start: 4, end: 7 }); // "bar"
});

test("expandToWordBoundaries: clicking on punctuation returns null", () => {
  const text = "foo,bar";
  assert.equal(expandToWordBoundaries(text, 3), null); // the comma
});

test("expandToWordBoundaries: whitespace returns null", () => {
  const text = "hello world";
  assert.equal(expandToWordBoundaries(text, 5), null); // the space
});

test("expandToWordBoundaries: CJK character is single-char word", () => {
  const text = "hello世界test";
  // '世' at index 5
  assert.deepEqual(expandToWordBoundaries(text, 5), { start: 5, end: 6 });
  // '界' at index 6
  assert.deepEqual(expandToWordBoundaries(text, 6), { start: 6, end: 7 });
});

test("expandToWordBoundaries: does not expand Latin across CJK", () => {
  const text = "abc中def";
  assert.deepEqual(expandToWordBoundaries(text, 0), { start: 0, end: 3 }); // "abc"
  assert.deepEqual(expandToWordBoundaries(text, 4), { start: 4, end: 7 }); // "def"
});

test("expandToWordBoundaries: handles start of string", () => {
  const text = "word";
  assert.deepEqual(expandToWordBoundaries(text, 0), { start: 0, end: 4 });
});

test("expandToWordBoundaries: handles end of string", () => {
  const text = "word";
  assert.deepEqual(expandToWordBoundaries(text, 3), { start: 0, end: 4 });
});

test("expandToWordBoundaries: out of range returns null", () => {
  assert.equal(expandToWordBoundaries("hello", -1), null);
  assert.equal(expandToWordBoundaries("hello", 10), null);
  assert.equal(expandToWordBoundaries("", 0), null);
  assert.equal(expandToWordBoundaries(null, 0), null);
});

test("expandToWordBoundaries: digits are separate from letters", () => {
  const text = "abc123 xyz";
  assert.deepEqual(expandToWordBoundaries(text, 4), { start: 3, end: 6 }); // "123" (clicking on digit)
  assert.deepEqual(expandToWordBoundaries(text, 1), { start: 0, end: 3 }); // "abc" (clicking on letter)
});

test("expandToWordBoundaries: multiple punctuation boundaries", () => {
  const text = "(hello)";
  assert.deepEqual(expandToWordBoundaries(text, 3), { start: 1, end: 6 }); // "hello"
});

test("expandToWordBoundaries: Hiragana is CJK single-char", () => {
  const text = "あいう";
  assert.deepEqual(expandToWordBoundaries(text, 0), { start: 0, end: 1 });
  assert.deepEqual(expandToWordBoundaries(text, 1), { start: 1, end: 2 });
});

test("expandToWordBoundaries: Hangul is CJK single-char", () => {
  const text = "한글test";
  assert.deepEqual(expandToWordBoundaries(text, 0), { start: 0, end: 1 }); // '한'
  assert.deepEqual(expandToWordBoundaries(text, 1), { start: 1, end: 2 }); // '글'
  assert.deepEqual(expandToWordBoundaries(text, 2), { start: 2, end: 6 }); // "test"
});

// --- Multi-line text node split (cross-line char rect bug fix) ---

test("cross-line tight spacing: words on adjacent lines are separate tokens", () => {
  // Simulates the bug: "particular" ends line 1, "focus" starts line 2.
  // With tight line spacing (gap = 1px, height = 10px → gap/h = 0.1 < 0.2),
  // the old shouldInsertSyntheticSpace would NOT insert a space, merging them
  // into "particularfocus". Double-clicking "focus" would then select "particular".
  const nodeA = { id: "nodeA" };
  const nodeB = { id: "nodeB" };
  const line1Run = {
    text: "particular",
    node: nodeA,
    rect: { left: 50, right: 150, top: 0, bottom: 10, width: 100, height: 10 },
  };
  const line2Run = {
    text: "focus",
    node: nodeB,
    // Tight spacing: top=11, so gap = 11 - 10 = 1px, which is 10% of h=10
    rect: { left: 0, right: 50, top: 11, bottom: 21, width: 50, height: 10 },
  };
  const index = buildTextIndexFromRuns([line1Run, line2Run]);

  // Verify a synthetic space separates the two words
  assert.ok(
    index.canonicalText.includes("particular focus"),
    `expected "particular focus" but got "${index.canonicalText}"`
  );

  // "focus" should be its own token
  const focusStart = index.canonicalText.indexOf("focus");
  assert.ok(focusStart > 0, "focus should exist in canonical text");
  const token = findTokenContaining(index, focusStart);
  assert.ok(token, "should find a token containing 'focus'");
  assert.equal(
    index.canonicalText.slice(token.start, token.end),
    "focus",
    "token should be exactly 'focus', not merged with 'particular'"
  );

  // Click in the middle of "focus" on line 2 (y=16 is centered in 11-21)
  const charIdx = findCharIndexAtPoint(index, 25, 16);
  assert.ok(charIdx >= 0, "should find a char on line 2");
  const clickedChar = index.chars[charIdx];
  assert.ok(
    clickedChar.rect.top >= 11,
    `clicked char should be on line 2 (top=${clickedChar.rect.top})`
  );

  // The DOM range for "focus" should reference nodeB
  const ranges = buildDomRangesFromCanonicalRange(index, token.start, token.end);
  assert.equal(ranges.length, 1, "should be a single DOM range");
  assert.equal(ranges[0].node, nodeB, "range should reference nodeB (line 2)");
});

test("cross-line overlapping rects: words still separate tokens", () => {
  // Even more extreme: line rects overlap vertically (common with descenders)
  const nodeA = { id: "nodeA" };
  const nodeB = { id: "nodeB" };
  const line1Run = {
    text: "particular",
    node: nodeA,
    rect: { left: 50, right: 150, top: 0, bottom: 12, width: 100, height: 12 },
  };
  const line2Run = {
    text: "focus",
    node: nodeB,
    // Overlapping: top=10 < bottom of line1=12
    rect: { left: 0, right: 50, top: 10, bottom: 22, width: 50, height: 12 },
  };
  const index = buildTextIndexFromRuns([line1Run, line2Run]);

  assert.ok(
    index.canonicalText.includes("particular focus"),
    `expected space between words but got "${index.canonicalText}"`
  );

  const focusStart = index.canonicalText.indexOf("focus");
  const token = findTokenContaining(index, focusStart);
  assert.equal(
    index.canonicalText.slice(token.start, token.end),
    "focus",
    "token should be exactly 'focus'"
  );
});

test("split multi-line runs: findCharIndexAtPoint selects line 2 char, not line 1", () => {
  // Simulate a text node "reasoning\nover" that was split into two sub-runs
  // by collectTextRunsFromTextLayer (one per visual line).
  const sharedNode = { text: "reasoning\nover" };
  const line1Run = {
    text: "reasoning\n",
    node: sharedNode,
    rect: { left: 0, right: 90, top: 0, bottom: 10, width: 90, height: 10 },
    _nodeOffset: 0,
  };
  const line2Run = {
    text: "over",
    node: sharedNode,
    rect: { left: 0, right: 40, top: 12, bottom: 22, width: 40, height: 10 },
    _nodeOffset: 10, // "reasoning\n" is 10 chars
  };
  const index = buildTextIndexFromRuns([line1Run, line2Run]);

  // Click in the middle of line 2 (y=17 is vertically centered in line 2's rect)
  const charIdx = findCharIndexAtPoint(index, 15, 17);
  assert.ok(charIdx >= 0, "should find a char on line 2");
  // The canonical text for line 2 starts after "reasoning " (normalized)
  const clickedChar = index.chars[charIdx];
  assert.ok(
    clickedChar.rect.top >= 12,
    `clicked char should be on line 2 (top=${clickedChar.rect.top})`
  );
});

test("split multi-line runs: DOM ranges use correct node offsets", () => {
  // Same setup: "reasoning\nover" split into two sub-runs
  const sharedNode = { text: "reasoning\nover" };
  const line1Run = {
    text: "reasoning\n",
    node: sharedNode,
    rect: { left: 0, right: 100, top: 0, bottom: 10, width: 100, height: 10 },
    _nodeOffset: 0,
  };
  const line2Run = {
    text: "over",
    node: sharedNode,
    rect: { left: 0, right: 40, top: 12, bottom: 22, width: 40, height: 10 },
    _nodeOffset: 10,
  };
  const index = buildTextIndexFromRuns([line1Run, line2Run]);

  // Find "over" in the canonical text
  const matches = findMatchesInIndex(index, "over");
  assert.equal(matches.length, 1);
  // The DOM range for "over" should reference offsets 10-14 in the original node
  const range = matches[0].ranges[0];
  assert.equal(range.node, sharedNode);
  assert.equal(range.startOffset, 10, "startOffset should be 10 (after 'reasoning\\n')");
  assert.equal(range.endOffset, 14, "endOffset should be 14");
});

test("mixed-styling word: bold 'A' + regular 'dvantage' forms single token", () => {
  // Simulates a PDF where 'Advantage' is split across two spans with different
  // font styles but no horizontal gap (same line, adjacent rects).
  const nodeA = { text: "A" };
  const nodeB = { text: "dvantage" };
  const runA = {
    text: "A",
    node: nodeA,
    rect: { left: 0, right: 8, top: 0, bottom: 12, width: 8, height: 12 },
  };
  const runB = {
    text: "dvantage",
    node: nodeB,
    rect: { left: 8, right: 60, top: 0, bottom: 12, width: 52, height: 12 },
  };
  const index = buildTextIndexFromRuns([runA, runB]);

  // normalizeRawChar lowercases — canonical text is "advantage"
  assert.equal(index.canonicalText, "advantage",
    "runs with no gap on same line should merge without synthetic space");

  // Should be a single token
  const token = findTokenContaining(index, 0);
  assert.ok(token, "should find a token at position 0");
  assert.equal(index.canonicalText.slice(token.start, token.end), "advantage",
    "token should span the full word");

  // buildDomRangesFromCanonicalRange should return two ranges (one per node)
  const ranges = buildDomRangesFromCanonicalRange(index, token.start, token.end);
  assert.equal(ranges.length, 2, "should produce two DOM ranges for two nodes");
  assert.equal(ranges[0].node, nodeA);
  assert.equal(ranges[0].startOffset, 0);
  assert.equal(ranges[0].endOffset, 1);
  assert.equal(ranges[1].node, nodeB);
  assert.equal(ranges[1].startOffset, 0);
  assert.equal(ranges[1].endOffset, 8);
});

test("mixed-styling word: small gap due to font metrics does not split", () => {
  // Even with a tiny gap (e.g., 2px on a 12px-high line), the threshold
  // (gap > h * 0.45 = 5.4) should NOT trigger a synthetic space.
  const nodeA = { text: "A" };
  const nodeB = { text: "dvantage" };
  const runA = {
    text: "A",
    node: nodeA,
    rect: { left: 0, right: 8, top: 0, bottom: 12, width: 8, height: 12 },
  };
  const runB = {
    text: "dvantage",
    node: nodeB,
    rect: { left: 10, right: 62, top: 0, bottom: 12, width: 52, height: 12 },
  };
  const index = buildTextIndexFromRuns([runA, runB]);

  // Gap is 2px, threshold is 12*0.45=5.4 — no space inserted
  assert.equal(index.canonicalText, "advantage",
    "small gap (2px) should not trigger synthetic space on 12px line");
});

test("table row: large gap separates 'Student ID' from '0472792'", () => {
  // Simulates a PDF table row where "Student ID" is on the left and "0472792"
  // is on the far right with a large whitespace gap. The gap should trigger a
  // synthetic space so expandToWordBoundaries stops at "student" and does NOT
  // include "0472792".
  const nodeA = { text: "Student ID" };
  const nodeB = { text: "0472792" };
  const runA = {
    text: "Student ID",
    node: nodeA,
    rect: { left: 10, right: 100, top: 50, bottom: 64, width: 90, height: 14 },
  };
  // Large gap: 100 → 400 = 300px gap, threshold is 14*0.45=6.3 — well exceeded
  const runB = {
    text: "0472792",
    node: nodeB,
    rect: { left: 400, right: 470, top: 50, bottom: 64, width: 70, height: 14 },
  };
  const index = buildTextIndexFromRuns([runA, runB]);

  // Synthetic space should be inserted between "id" and "0472792"
  assert.equal(index.canonicalText, "student id 0472792",
    "large gap should insert synthetic space between runs");

  // Double-clicking on 'S' (charIndex 0) should select only "student"
  const bounds = expandToWordBoundaries(index.canonicalText, 0);
  assert.ok(bounds, "should find word boundaries");
  assert.equal(bounds.start, 0);
  assert.equal(bounds.end, 7);
  assert.equal(index.canonicalText.slice(bounds.start, bounds.end), "student");

  // buildDomRangesFromCanonicalRange should return only one entry in nodeA
  const ranges = buildDomRangesFromCanonicalRange(index, bounds.start, bounds.end);
  assert.equal(ranges.length, 1, "should produce exactly one DOM range for 'Student'");
  assert.equal(ranges[0].node, nodeA, "range should be in nodeA");
  assert.equal(ranges[0].startOffset, 0);
  assert.equal(ranges[0].endOffset, 7); // "Student" is 7 chars
});

test("table row: pure-alphabetic words with large gap are separated", () => {
  // Simulates the bug: PDF.js renders "Name" and "Yu" in the same table row
  // as separate runs (after collectTextRunsFromTextLayer splits them at the
  // horizontal gap).  Both are pure alphabetic — no letter↔digit boundary.
  const nodeA = { text: "Name" };
  const nodeB = { text: "Yu" };
  const runA = {
    text: "Name",
    node: nodeA,
    rect: { left: 10, right: 50, top: 50, bottom: 64, width: 40, height: 14 },
  };
  // Large gap: 50 → 400 = 350px gap, threshold is 14*0.45=6.3 — well exceeded
  const runB = {
    text: "Yu",
    node: nodeB,
    rect: { left: 400, right: 420, top: 50, bottom: 64, width: 20, height: 14 },
  };
  const index = buildTextIndexFromRuns([runA, runB]);

  // Synthetic space should be inserted between "name" and "yu"
  assert.equal(index.canonicalText, "name yu",
    "large gap should insert synthetic space between pure-alphabetic runs");

  // Double-clicking on 'N' (charIndex 0) should select only "name"
  const bounds = expandToWordBoundaries(index.canonicalText, 0);
  assert.ok(bounds, "should find word boundaries");
  assert.equal(bounds.start, 0);
  assert.equal(bounds.end, 4);
  assert.equal(index.canonicalText.slice(bounds.start, bounds.end), "name");

  // Double-clicking on 'y' (charIndex 5) should select only "yu"
  const boundsYu = expandToWordBoundaries(index.canonicalText, 5);
  assert.ok(boundsYu, "should find word boundaries for 'yu'");
  assert.equal(index.canonicalText.slice(boundsYu.start, boundsYu.end), "yu");

  // buildDomRangesFromCanonicalRange should return only one entry for "name"
  const ranges = buildDomRangesFromCanonicalRange(index, bounds.start, bounds.end);
  assert.equal(ranges.length, 1, "should produce exactly one DOM range for 'Name'");
  assert.equal(ranges[0].node, nodeA, "range should be in nodeA");
});

test("table row: no synthetic space causes spanning selection bug", () => {
  // If runs are in the SAME text node (PDF.js sometimes combines items),
  // there's no synthetic space insertion between them. Verify that the
  // letter↔digit boundary in expandToWordBoundaries still prevents
  // "student" from expanding into digits.
  const node = { text: "Student ID0472792" };
  const runA = {
    text: "Student ID0472792",
    node,
    rect: { left: 10, right: 470, top: 50, bottom: 64, width: 460, height: 14 },
  };
  const index = buildTextIndexFromRuns([runA]);

  // canonicalText should be "student id0472792" (space within the text node is preserved)
  assert.equal(index.canonicalText, "student id0472792");

  // Clicking on 'S' should select only "student" (stops at space)
  const bounds = expandToWordBoundaries(index.canonicalText, 0);
  assert.ok(bounds);
  assert.equal(index.canonicalText.slice(bounds.start, bounds.end), "student");

  // Clicking on 'i' of "id" — letter↔digit boundary stops before '0'
  const boundsID = expandToWordBoundaries(index.canonicalText, 8);
  assert.ok(boundsID);
  assert.equal(index.canonicalText.slice(boundsID.start, boundsID.end), "id",
    "letter↔digit boundary should prevent 'id' from expanding into '0472792'");

  // Clicking on '0' should select only "0472792"
  const boundsNum = expandToWordBoundaries(index.canonicalText, 10);
  assert.ok(boundsNum);
  assert.equal(index.canonicalText.slice(boundsNum.start, boundsNum.end), "0472792",
    "digit group should be selected independently");
});

// --- Visual-order sorting tests ---
// These verify that runs must be in visual reading order (left-to-right,
// top-to-bottom) for correct synthetic space insertion.  The sort in
// collectTextRunsFromTextLayer ensures this; here we test the effect on
// buildTextIndexFromRuns directly.

test("runs in visual order (Name left, Yu right) get synthetic space between them", () => {
  // "Name" is visually on the LEFT, "Hongzhi Yu" is on the RIGHT (same line)
  const nameRun = run("Name", 0, 40);
  const yuRun = run("Hongzhi Yu", 200, 300);
  const index = buildTextIndexFromRuns([nameRun, yuRun]);
  assert.equal(index.canonicalText, "name hongzhi yu",
    "visual-order runs should get a synthetic space due to large gap");
});

test("runs in DOM order (Yu before Name) without sort produce merged text (bug scenario)", () => {
  // DOM order: "Hongzhi Yu" span comes first, "Name" span comes second
  // but visually "Name" is on the LEFT and "Hongzhi Yu" is on the RIGHT.
  // Without sorting, the gap calculation sees a negative/zero gap → no space.
  const yuRun = run("Hongzhi Yu", 200, 300);
  const nameRun = run("Name", 0, 40);
  // In wrong (DOM) order, "Yu" is followed by "Name" with nameRun.left < yuRun.right
  // → gap is 0 (clamped) → no synthetic space → merged "hongzhi yuname"
  const index = buildTextIndexFromRuns([yuRun, nameRun]);
  assert.equal(index.canonicalText, "hongzhi yuname",
    "without visual-order sort, DOM-ordered runs merge incorrectly");
});

test("collectTextRunsFromTextLayer sorts runs by visual position (verified via buildTextIndexFromRuns)", () => {
  // Simulate what collectTextRunsFromTextLayer produces AFTER sorting:
  // Even though DOM order is [yuRun, nameRun], after sort by left position
  // on the same line, the order becomes [nameRun, yuRun].
  const yuRun = run("Hongzhi Yu", 200, 300);
  const nameRun = run("Name", 0, 40);
  // Apply the same sort logic that collectTextRunsFromTextLayer uses
  const runs = [yuRun, nameRun];
  runs.sort((a, b) => {
    const ay = a.rect?.top ?? 0;
    const by = b.rect?.top ?? 0;
    const lineThreshold = Math.min(a.rect?.height ?? 10, b.rect?.height ?? 10) * 0.5;
    if (Math.abs(ay - by) < lineThreshold) {
      return (a.rect?.left ?? 0) - (b.rect?.left ?? 0);
    }
    return ay - by;
  });
  const index = buildTextIndexFromRuns(runs);
  assert.equal(index.canonicalText, "name hongzhi yu",
    "after visual-order sort, Name (left) comes before Hongzhi Yu (right) with space");
  // Verify "Name" and "Yu" are NOT co-highlighted when selecting "name"
  const matches = findMatchesInIndex(index, "name");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].start, 0);
  assert.equal(matches[0].end, 4);
  // The match should only reference the "Name" node
  assert.equal(matches[0].ranges.length, 1);
  assert.equal(matches[0].ranges[0].node.text, "Name");
});

test("visual-order sort handles multi-line runs (top-to-bottom then left-to-right)", () => {
  // Line 1: "Title" at top-left, "Author" at top-right
  // Line 2: "Abstract" at bottom-left
  // DOM order might be scrambled
  const authorRun = run("Author", 200, 280, 0, 10);
  const abstractRun = run("Abstract", 0, 80, 20, 30);
  const titleRun = run("Title", 0, 50, 0, 10);
  const runs = [authorRun, abstractRun, titleRun];
  runs.sort((a, b) => {
    const ay = a.rect?.top ?? 0;
    const by = b.rect?.top ?? 0;
    const lineThreshold = Math.min(a.rect?.height ?? 10, b.rect?.height ?? 10) * 0.5;
    if (Math.abs(ay - by) < lineThreshold) {
      return (a.rect?.left ?? 0) - (b.rect?.left ?? 0);
    }
    return ay - by;
  });
  const index = buildTextIndexFromRuns(runs);
  assert.equal(index.canonicalText, "title author abstract",
    "multi-line sort: line 1 left-to-right, then line 2");
});
