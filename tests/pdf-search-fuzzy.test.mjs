import assert from "node:assert/strict";
import { fuzzySearch, fuzzyScore } from "../pdf-search-fuzzy.mjs";

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`not ok - ${name}`);
    throw err;
  }
}

test("fuzzySearch finds exact match with edit distance 0", () => {
  const results = fuzzySearch("hello world", "hello", 1);
  assert.ok(results.length >= 1);
  assert.equal(results[0].editDistance, 0);
});

test("fuzzySearch finds 1-char deletion match", () => {
  const results = fuzzySearch("effect", "efect", 1);
  assert.ok(results.length >= 1);
  const best = results.reduce((a, b) => a.editDistance < b.editDistance ? a : b);
  assert.equal(best.editDistance, 1);
  assert.ok(fuzzyScore(best.editDistance, 6) >= 0.8);
});

test("fuzzySearch rejects matches above maxDist", () => {
  const results = fuzzySearch("abcdefghij", "xyz", 1);
  assert.equal(results.length, 0);
});

test("fuzzyScore returns 1 for exact match", () => {
  assert.equal(fuzzyScore(0, 10), 1);
});

test("fuzzyScore returns 0.9 for 1 error in 10-char query", () => {
  assert.equal(fuzzyScore(1, 10), 0.9);
});

test("fuzzyScore returns 0.7 for 3 errors in 10-char query", () => {
  assert.equal(fuzzyScore(3, 10), 0.7);
});

test("fuzzySearch returns empty for empty pattern", () => {
  assert.deepEqual(fuzzySearch("hello", "", 1), []);
});

test("fuzzySearch returns empty for pattern > 64 chars", () => {
  const longPattern = "a".repeat(65);
  assert.deepEqual(fuzzySearch("hello", longPattern, 1), []);
});

test("fuzzySearch returns empty for empty text", () => {
  assert.deepEqual(fuzzySearch("", "hello", 1), []);
});

test("fuzzySearch handles 1-char substitution", () => {
  const results = fuzzySearch("hello", "hallo", 1);
  assert.ok(results.length >= 1);
  const best = results.reduce((a, b) => a.editDistance < b.editDistance ? a : b);
  assert.equal(best.editDistance, 1);
});

// --- T25: Myers matcher edge-case tests ---

test("fuzzySearch finds match with 1 insertion", () => {
  const results = fuzzySearch("effect", "effiect", 1);
  assert.ok(results.length >= 1);
  assert.ok(results[0].editDistance <= 1);
});

test("fuzzyScore is 0.8 for 1-edit in 5-char query", () => {
  assert.equal(fuzzyScore(1, 5), 0.8);
});

test("fuzzySearch returns empty for maxDist=0 and no exact match", () => {
  const results = fuzzySearch("hello", "hallo", 0);
  assert.equal(results.length, 0);
});

test("fuzzySearch finds multiple matches in long text", () => {
  const results = fuzzySearch("hello hallo hxllo", "hello", 1);
  assert.ok(results.length >= 2);
});
