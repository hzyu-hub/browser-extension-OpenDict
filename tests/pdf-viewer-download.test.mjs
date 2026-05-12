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

const viewerHtml = readFileSync(new URL("../pdf-viewer.html", import.meta.url), "utf8");
const viewerJs = readFileSync(new URL("../pdf-viewer.js", import.meta.url), "utf8");

test("PDF viewer exposes a toolbar download button", () => {
  assert.match(viewerHtml, /<button\s+id="download-pdf"[^>]*>/);
  assert.match(viewerHtml, /id="download-pdf"[^>]*title="Download PDF"/);
});

test("PDF viewer download button downloads the original PDF URL", () => {
  assert.match(viewerJs, /document\.getElementById\("download-pdf"\)/);
  assert.match(viewerJs, /chrome\.downloads\.download/);
  assert.match(viewerJs, /url:\s*pdfUrl/);
  assert.match(viewerJs, /saveAs:\s*true/);
});
