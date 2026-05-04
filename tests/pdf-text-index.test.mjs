import assert from "node:assert/strict";
import {
  buildTextIndexFromRuns,
  buildDomRangesFromCanonicalRange,
  findCharIndexAtPoint,
  findMatchesInIndex,
  findTokenContaining,
  normalizeSearchQuery,
  normalizeCoarseText,
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
