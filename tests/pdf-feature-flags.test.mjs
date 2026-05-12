import assert from "node:assert/strict";
import { getFlag, setFlagOverrides, resetFlagCache } from "../pdf-feature-flags.mjs";

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`not ok - ${name}`);
    throw err;
  }
}

test("getFlag returns default value before loading", () => {
  resetFlagCache();
  assert.equal(getFlag("opendict.search.nfkd"), false);
  assert.equal(getFlag("opendict.search.fuzzy"), false);
});

test("getFlag returns false for unknown flag name", () => {
  assert.equal(getFlag("nonexistent.flag"), false);
});

test("setFlagOverrides updates flag cache", () => {
  resetFlagCache();
  setFlagOverrides({ "opendict.search.nfkd": true });
  assert.equal(getFlag("opendict.search.nfkd"), true);
  assert.equal(getFlag("opendict.search.fuzzy"), false); // unchanged
});

test("setFlagOverrides ignores unknown flag names", () => {
  resetFlagCache();
  setFlagOverrides({ "unknown.flag": true });
  assert.equal(getFlag("opendict.search.nfkd"), false); // still default
});

test("resetFlagCache restores all defaults", () => {
  setFlagOverrides({ "opendict.search.nfkd": true });
  assert.equal(getFlag("opendict.search.nfkd"), true);
  resetFlagCache();
  assert.equal(getFlag("opendict.search.nfkd"), false);
});
