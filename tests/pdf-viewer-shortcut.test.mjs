import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`not ok - ${name}`);
    throw err;
  }
}

const viewerJs = readFileSync(new URL("../pdf-viewer.js", import.meta.url), "utf8");
const contentJs = readFileSync(new URL("../content.js", import.meta.url), "utf8");

test("PDF viewer exposes overlay-selected text through the DOM for injected content scripts", () => {
  assert.match(viewerJs, /data-opendict-pdf-selected-text/);
  assert.match(viewerJs, /setPdfSelectedText\(text\)/);
  assert.match(viewerJs, /setPdfSelectedText\(""\)/);
});

test("content script command trigger falls back to PDF viewer overlay selection", () => {
  assert.match(contentJs, /getPdfViewerOverlaySelection/);
  assert.match(contentJs, /\.getAttribute\("data-opendict-pdf-selected-text"\)/);
  assert.match(contentJs, /currentSelection \|\| getPdfViewerOverlaySelection\(\) \|\| pendingSelection\?\.text/);
});
