// OpenDict Chrome Extension — Content Script
// Select text first, then press shortcut to trigger translation popup

(function () {
  "use strict";

  const POPUP_ID = "opendict-popup";
  let popup = null;
  let shortcut = "Ctrl+T";
  let pendingSelection = null;
  let lastClickPos = { x: 0, y: 0 };
  let autoCloseTimer = null;
  let parsedShortcut = null;

  function escapeHtml(text) {
    if (!text) return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function removePopup() {
    if (autoCloseTimer) {
      clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
    }
    if (!popup) return;
    popup.classList.add("opendict-fadeout");
    setTimeout(() => {
      popup?.remove();
      popup = null;
    }, 200);
  }

  function createPopup(x, y) {
    removePopup();
    popup = document.createElement("div");
    popup.id = POPUP_ID;

    const maxX = window.innerWidth - 340;
    const maxY = window.innerHeight - 240;
    popup.style.left = `${Math.max(16, Math.min(x, maxX))}px`;
    popup.style.top = `${Math.max(16, Math.min(y + 14, maxY))}px`;
    document.body.appendChild(popup);
    return popup;
  }

  function playAudio(text) {
    if (!text) return;

    chrome.runtime.sendMessage({ type: "opendict-tts-request", text }, (response) => {
      if (response && response.audioData) {
        const audio = new Audio(response.audioData);
        audio.play().catch((e) => console.error("Audio play error:", e));
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    });
  }

  function showLoading(word, x, y) {
    const el = createPopup(x, y);
    el.innerHTML = `
      <div class="opendict-header">
        <div class="opendict-word-row">
          <span class="opendict-word">${escapeHtml(word)}</span>
        </div>
        <button class="opendict-icon-btn opendict-close" title="Close">
          <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
      <div class="opendict-body opendict-loading">
        <div class="opendict-spinner"></div>
        <span>Translating...</span>
      </div>
    `;
    el.querySelector(".opendict-close")?.addEventListener("click", removePopup);
  }

  function showResult(word, data, error) {
    if (!popup) return;
    const body = popup.querySelector(".opendict-body");
    if (!body) return;

    if (error) {
      body.innerHTML = `<div class="opendict-error">${escapeHtml(error)}</div>`;
      body.classList.remove("opendict-loading");
      return;
    }

    if (typeof data === "string" || (data.translation && !data.phonetic)) {
      const text = typeof data === "string" ? data : data.translation;
      body.innerHTML = `<div class="opendict-text">${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
      body.classList.remove("opendict-loading");
      return;
    }

    const headerWordRow = popup.querySelector(".opendict-word-row");
    if (headerWordRow) {
      headerWordRow.innerHTML = `
        <span class="opendict-word">${escapeHtml(word)}</span>
        <div class="opendict-phonetic-group">
          <span class="opendict-phonetic">${escapeHtml(data.phonetic || "")}</span>
          <button class="opendict-icon-btn opendict-audio" title="Play US Pronunciation">
            <svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
          </button>
        </div>
      `;
      popup.querySelector(".opendict-audio")?.addEventListener("click", () => playAudio(word));
    }

    body.innerHTML = `
      <div class="opendict-row opendict-pos-meaning">
        <span class="opendict-pos">${escapeHtml(data.pos || "")}</span>
        <span>${escapeHtml(data.meaning || "")}</span>
      </div>

      <div class="opendict-row opendict-section">
        <div class="opendict-label">DEFINITION</div>
        <div class="opendict-def">${escapeHtml(data.definition || "")}</div>
      </div>

      <div class="opendict-row opendict-section">
        <div class="opendict-label">EXAMPLE</div>
        <div class="opendict-example">${(() => {
          const ex = data.example;
          if (!ex) return "";
          if (typeof ex === "string") return escapeHtml(ex);
          if (typeof ex === "object") {
            const en = ex.en || ex.english || ex.sentence || "";
            const cn = ex.cn || ex.zh || ex.chinese || ex.meaning || "";
            return escapeHtml((en && cn) ? `${en} | ${cn}` : (en || cn || JSON.stringify(ex)));
          }
          return "";
        })()}</div>
      </div>
    `;

    body.classList.remove("opendict-loading");
    autoCloseTimer = setTimeout(removePopup, 30000);
  }

  function isEditableElement(target) {
    if (!target) return false;
    const tag = target.tagName?.toLowerCase();
    return target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
  }

  function normalizeShortcut(value) {
    return String(value || "Ctrl+T").replace(/\s+/g, "");
  }

  function parseShortcut(value) {
    const parts = normalizeShortcut(value).split("+").filter(Boolean);
    const result = {
      alt: false,
      ctrl: false,
      shift: false,
      meta: false,
      key: "Q",
    };

    for (const partRaw of parts) {
      const part = partRaw.toLowerCase();
      if (part === "alt" || part === "option") result.alt = true;
      else if (part === "ctrl" || part === "control") result.ctrl = true;
      else if (part === "shift") result.shift = true;
      else if (part === "cmd" || part === "command" || part === "meta") result.meta = true;
      else result.key = partRaw;
    }

    return result;
  }

  function isShortcutMatched(event) {
    const parsed = parsedShortcut || parseShortcut(shortcut);
    const requiredKey = String(parsed.key || "").toLowerCase();
    const keyMatch = (event.key || "").toLowerCase() === requiredKey;
    const codeMatch = (event.code || "").toLowerCase() === `key${requiredKey}`;

    if (event.altKey !== parsed.alt) return false;
    if (event.ctrlKey !== parsed.ctrl) return false;
    if (event.shiftKey !== parsed.shift) return false;
    if (event.metaKey !== parsed.meta) return false;

    return keyMatch || codeMatch;
  }

  function captureSelection(e) {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!text || text.length > 200) {
      pendingSelection = null;
      return;
    }

    let context = "";
    try {
      const anchorNode = selection.anchorNode;
      if (anchorNode?.textContent) {
        context = anchorNode.textContent.slice(0, 1000);
      }
    } catch (err) {
      console.error("Failed to get context:", err);
    }

    pendingSelection = {
      text,
      context,
      x: e?.clientX ?? lastClickPos.x,
      y: e?.clientY ?? lastClickPos.y,
    };
  }

  function requestTranslate(text, context, x, y) {
    showLoading(text, x, y);

    const timeoutId = setTimeout(() => {
      showResult(text, null, "Request timed out. Check your API settings.");
    }, 20000);

    try {
      chrome.runtime.sendMessage({ type: "opendict-translate-request", text, context }, (response) => {
        clearTimeout(timeoutId);
        if (chrome.runtime.lastError) {
          showResult(text, null, "Extension error: " + chrome.runtime.lastError.message);
          return;
        }
        showResult(text, response, response?.error);
      });
    } catch (error) {
      clearTimeout(timeoutId);
      showResult(text, null, "Error: " + error.message);
    }
  }

  function loadShortcut() {
    chrome.storage.sync.get("opendict_config", (data) => {
      const cfg = data.opendict_config || {};
      shortcut = normalizeShortcut(cfg.triggerShortcut || "Ctrl+T");
      parsedShortcut = parseShortcut(shortcut);
    });
  }

  document.addEventListener("mouseup", (e) => {
    lastClickPos = { x: e.clientX, y: e.clientY };
    captureSelection(e);
  });

  document.addEventListener("dblclick", (e) => {
    lastClickPos = { x: e.clientX, y: e.clientY };
    captureSelection(e);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && popup) {
      removePopup();
      return;
    }

    if (isEditableElement(e.target)) return;
    if (!isShortcutMatched(e)) return;

    const currentSelection = window.getSelection()?.toString().trim();
    const text = currentSelection || pendingSelection?.text;
    if (!text || text.length > 200) return;

    const context = pendingSelection?.context || "";
    const x = pendingSelection?.x ?? lastClickPos.x;
    const y = pendingSelection?.y ?? lastClickPos.y;

    e.preventDefault();
    requestTranslate(text, context, x, y);
    pendingSelection = null;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes.opendict_config) return;
    const cfg = changes.opendict_config.newValue || {};
    shortcut = normalizeShortcut(cfg.triggerShortcut || "Ctrl+T");
    parsedShortcut = parseShortcut(shortcut);
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "opendict-loading") {
      showLoading(msg.word, lastClickPos.x || 200, lastClickPos.y || 200);
    } else if (msg.type === "opendict-result") {
      showResult(msg.word, msg, msg.error);
    }
  });

  document.addEventListener("mousedown", (e) => {
    if (popup && !popup.contains(e.target)) removePopup();
  });

  loadShortcut();
})();
