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

test("PDF viewer does NOT have its own translation popup (content.js handles it)", () => {
  assert.doesNotMatch(viewerJs, /triggerPdfTranslation/);
  assert.doesNotMatch(viewerJs, /showPdfTransLoading/);
  assert.doesNotMatch(viewerJs, /showPdfTransResult/);
  assert.doesNotMatch(viewerJs, /pdfTransPopup/);
  assert.doesNotMatch(viewerJs, /parseShortcutForPdf/);
});

test("content script reads PDF overlay selection and positions popup from overlay element", () => {
  assert.match(contentJs, /getPdfViewerOverlaySelection/);
  assert.match(contentJs, /\.getAttribute\("data-opendict-pdf-selected-text"\)/);
  assert.match(contentJs, /getPdfOverlayPosition/);
  assert.match(contentJs, /od-selection-highlight/);
});
