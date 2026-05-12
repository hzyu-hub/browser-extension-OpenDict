import assert from "node:assert/strict";
import {
  buildTextIndexFromRuns,
  buildDomRangesFromCanonicalRange,
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
