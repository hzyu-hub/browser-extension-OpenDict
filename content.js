// OpenDict Chrome Extension — Content Script
// Select text first, then press shortcut to trigger translation popup

(function () {
  "use strict";

  // Prevent double execution (loaded both via <script> tag and programmatic injection)
  if (window.__opendictLoaded) return;
  window.__opendictLoaded = true;

  const POPUP_ID = "opendict-popup";
  let popup = null;
  let shortcut = "Ctrl+Q";
  let pendingSelection = null;
  let lastClickPos = { x: 0, y: 0 };
  let autoCloseTimer = null;
  let parsedShortcut = null;
  let currentAudio = null;
  let audioPlayToken = 0;
  const pronunciationCache = new Map();
  const pronunciationFetches = new Map();

  // Minimal language registry — content-side only needs TTS code + script hint.
  const LANG_TTS = {
    "en": "en-US",
    "zh-CN": "zh-CN",
    "zh-TW": "zh-TW",
    "ja": "ja-JP",
    "ko": "ko-KR",
    "fr": "fr-FR",
    "de": "de-DE",
    "es": "es-ES",
    "it": "it-IT",
    "pt": "pt-BR",
    "ru": "ru-RU",
    "ar": "ar-SA",
    "hi": "hi-IN",
    "vi": "vi-VN",
    "th": "th-TH",
  };
  const LANG_GOOGLE_TTS = {
    "en": "en-us",
    "zh-CN": "zh-CN",
    "zh-TW": "zh-TW",
    "ja": "ja",
    "ko": "ko",
    "fr": "fr",
    "de": "de",
    "es": "es",
    "it": "it",
    "pt": "pt",
    "ru": "ru",
    "ar": "ar",
    "hi": "hi",
    "vi": "vi",
    "th": "th",
  };
  const SCRIPT_HINTS = [
    ["zh-CN", /[一-鿿]/],
    ["ja", /[぀-ヿ]/],
    ["ko", /[가-힯]/],
    ["ru", /[Ѐ-ӿ]/],
    ["ar", /[؀-ۿ]/],
    ["hi", /[ऀ-ॿ]/],
    ["th", /[฀-๿]/],
  ];

  let userConfig = {
    sourceLanguage: "auto",
    targetLanguage: "zh-CN",
  };

  function detectLangFromText(text) {
    const sample = String(text || "").trim();
    if (!sample) return "en";
    for (const [code, regex] of SCRIPT_HINTS) {
      if (regex.test(sample)) return code;
    }
    return "en";
  }

  function resolveLang(text) {
    const configured = userConfig.sourceLanguage;
    if (configured && configured !== "auto" && LANG_TTS[configured]) {
      return configured;
    }
    return detectLangFromText(text);
  }

  function refreshConfig() {
    try {
      chrome.runtime.sendMessage({ type: "opendict-get-config" }, (resp) => {
        if (chrome.runtime.lastError || !resp) return;
        if (resp.sourceLanguage) userConfig.sourceLanguage = resp.sourceLanguage;
        if (resp.targetLanguage) userConfig.targetLanguage = resp.targetLanguage;
      });
    } catch {}
  }

  refreshConfig();
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.opendict_config) {
        refreshConfig();
      }
    });
  } catch {}

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

  function normalizePronunciationText(text) {
    return String(text || "")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[\s"'“”‘’([{<]+/, "")
      .replace(/[\s"'“”‘’.,!?;:)\]}>]+$/, "")
      .trim();
  }

  function getPronunciationCacheKey(text, lang) {
    const norm = normalizePronunciationText(text).toLowerCase();
    if (!norm) return "";
    return lang ? `${lang}::${norm}` : norm;
  }

  function cachePronunciationPayload(payload, lang) {
    if (!payload?.normalizedText) return;
    const cacheLang = lang || payload.lang || "";
    const key = getPronunciationCacheKey(payload.normalizedText, cacheLang);
    if (!key) return;
    pronunciationCache.set(key, payload);
    if (pronunciationCache.size > 200) {
      const oldestKey = pronunciationCache.keys().next().value;
      if (oldestKey) pronunciationCache.delete(oldestKey);
    }
  }

  function getCachedPronunciationPayload(text, lang) {
    const key = getPronunciationCacheKey(text, lang);
    return key ? pronunciationCache.get(key) : null;
  }

  function fetchPronunciationPayload(text, langOverride) {
    const normalizedText = normalizePronunciationText(text);
    const lang =
      langOverride && LANG_TTS[langOverride]
        ? langOverride
        : resolveLang(normalizedText);
    const key = getPronunciationCacheKey(normalizedText, lang);
    if (!key) return Promise.resolve(null);
    if (pronunciationFetches.has(key)) return pronunciationFetches.get(key);

    const request = new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "opendict-get-pronunciation-sources", text: normalizedText, lang },
        (response) => {
          if (chrome.runtime.lastError || !response) {
            resolve(null);
            return;
          }
          cachePronunciationPayload(response, lang);
          resolve(response);
        },
      );
    }).finally(() => {
      pronunciationFetches.delete(key);
    });

    pronunciationFetches.set(key, request);
    return request;
  }

  function prefetchPronunciation(text, langOverride) {
    const normalizedText = normalizePronunciationText(text);
    if (!normalizedText) return;
    const lang =
      langOverride && LANG_TTS[langOverride]
        ? langOverride
        : resolveLang(normalizedText);
    if (getCachedPronunciationPayload(normalizedText, lang)) return;
    void fetchPronunciationPayload(normalizedText, lang);
  }

  function stopCurrentAudio() {
    audioPlayToken += 1;
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.removeAttribute("src");
      currentAudio.load();
      currentAudio = null;
    }
    window.speechSynthesis.cancel();
  }

  function isDictionaryWord(text) {
    return /^[A-Za-z]+(?:[.'’-][A-Za-z]+)*$/.test(text);
  }

  function buildImmediatePronunciationSources(text, lang) {
    const encoded = encodeURIComponent(text);
    const sources = [];

    if (lang === "en" && isDictionaryWord(text)) {
      sources.push(
        { url: `https://dict.youdao.com/dictvoice?audio=${encoded}&type=2` },
        { url: `https://dict.youdao.com/dictvoice?audio=${encoded}&type=1` },
      );
    }

    if (lang === "en") {
      sources.push(
        {
          url: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=en-us&client=tw-ob`,
        },
        {
          url: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=en-gb&client=tw-ob`,
        },
      );
    } else {
      const tl = LANG_GOOGLE_TTS[lang] || "en-us";
      sources.push({
        url: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=${tl}&client=tw-ob`,
      });
    }

    return sources;
  }

  function getSelectionRect() {
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return rect;
        }
      }
    } catch {}
    return null;
  }

  function createPopup(x, y) {
    removePopup();
    popup = document.createElement("div");
    popup.id = POPUP_ID;

    const POPUP_W = 380;
    const GAP = 6;
    const MARGIN = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const selRect = getSelectionRect();

    // Temporarily place offscreen to measure height
    popup.style.left = "-9999px";
    popup.style.top = "-9999px";
    document.body.appendChild(popup);

    requestAnimationFrame(() => {
      if (!popup) return;
      const popH = popup.offsetHeight;
      let left, top;

      if (selRect) {
        // Popup bottom edge aligns with selection top edge
        left = selRect.left;
        top = selRect.top - popH;

        // If overflows top, place below selection
        if (top < MARGIN) {
          top = selRect.bottom;
        }
        // If overflows right, shift left
        if (left + POPUP_W > vw - MARGIN) {
          left = vw - POPUP_W - MARGIN;
        }
        if (left < MARGIN) left = MARGIN;
      } else {
        left = x;
        top = y - popH;
        if (left + POPUP_W > vw - MARGIN) left = vw - POPUP_W - MARGIN;
        if (left < MARGIN) left = MARGIN;
        if (top < MARGIN) top = y;
      }

      // Final clamp: ensure bottom doesn't overflow
      if (top + popH > vh - MARGIN) {
        top = vh - popH - MARGIN;
      }
      if (top < MARGIN) top = MARGIN;

      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
    });

    // Enable dragging via header
    setupDrag(popup);

    return popup;
  }

  function setupDrag(el) {
    let isDragging = false;
    let startX, startY, origLeft, origTop;

    function onMouseDown(e) {
      // Only drag from header area, not from buttons
      if (e.target.closest("button") || e.target.closest("a")) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      origLeft = el.offsetLeft;
      origTop = el.offsetTop;
      e.preventDefault();
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    }

    function onMouseMove(e) {
      if (!isDragging) return;
      el.style.left = `${origLeft + e.clientX - startX}px`;
      el.style.top = `${origTop + e.clientY - startY}px`;
    }

    function onMouseUp() {
      isDragging = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    // Attach to header for drag handle
    requestAnimationFrame(() => {
      const header = el.querySelector(".opendict-header");
      if (header) header.addEventListener("mousedown", onMouseDown);
    });
  }

  async function playAudio(text, langOverride) {
    const normalizedText = normalizePronunciationText(text);
    if (!normalizedText) return;

    stopCurrentAudio();
    const playToken = audioPlayToken;
    const lang =
      langOverride && LANG_TTS[langOverride]
        ? langOverride
        : resolveLang(normalizedText);

    let payload = getCachedPronunciationPayload(normalizedText, lang);
    if (!payload) {
      // Keep playback on the original click gesture: do not await remote lookup
      // before the first play() call, or Chrome may block audio as autoplay.
      void fetchPronunciationPayload(normalizedText, lang);
      payload = {
        normalizedText,
        lang,
        sources: buildImmediatePronunciationSources(normalizedText, lang),
      };
    }

    const sources = Array.isArray(payload?.sources) ? payload.sources : [];
    const started = await playAudioSources(sources, playToken);
    if (!started && playToken === audioPlayToken) {
      fallbackSpeak(normalizedText, playToken, payload?.lang || lang);
    }
  }

  async function playAudioSources(sources, playToken) {
    for (const source of sources) {
      if (playToken !== audioPlayToken) return true;
      try {
        await playSingleAudioSource(source.url, playToken);
        return true;
      } catch {}
    }
    return false;
  }

  function playSingleAudioSource(url, playToken) {
    return new Promise((resolve, reject) => {
      const audio = new Audio();
      let finished = false;

      const cleanup = () => {
        clearTimeout(timer);
        audio.onplaying = null;
        audio.onended = null;
        audio.onerror = null;
        audio.onstalled = null;
        audio.onabort = null;
      };

      const fail = () => {
        if (finished) return;
        finished = true;
        cleanup();
        if (currentAudio === audio) currentAudio = null;
        reject(new Error("Audio playback failed"));
      };

      const succeed = () => {
        if (finished) return;
        if (playToken !== audioPlayToken) {
          audio.pause();
          fail();
          return;
        }
        finished = true;
        cleanup();
        currentAudio = audio;
        audio.onended = () => {
          if (currentAudio === audio) currentAudio = null;
        };
        resolve();
      };

      const timer = setTimeout(fail, 4500);
      audio.preload = "auto";
      audio.volume = 1.0;
      audio.onplaying = succeed;
      audio.onerror = fail;
      audio.onstalled = fail;
      audio.onabort = fail;
      audio.src = url;
      currentAudio = audio;

      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise.then(succeed).catch(fail);
      }
    });
  }

  function scoreVoice(voice, targetLang) {
    const name = String(voice?.name || "").toLowerCase();
    const voiceLang = String(voice?.lang || "").toLowerCase();
    const target = String(targetLang || "").toLowerCase();
    let score = 0;

    if (voiceLang === target) score += 80;
    else if (voiceLang.startsWith(target)) score += 70;
    else {
      const targetPrimary = target.split("-")[0];
      const voicePrimary = voiceLang.split("-")[0];
      if (targetPrimary && voicePrimary === targetPrimary) score += 50;
    }

    if (
      /microsoft|natural|premium|enhanced|samantha|ava|allison|karen|serena|daniel|alex|google/.test(
        name,
      )
    ) {
      score += 25;
    }

    if (/compact|espeak|festival/.test(name)) {
      score -= 20;
    }

    return score;
  }

  function fallbackSpeak(text, playToken, lang) {
    const langCode = lang || "en";
    const ttsLang = LANG_TTS[langCode] || "en-US";

    const speak = () => {
      if (playToken !== audioPlayToken) return;
      const utterance = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const primary = ttsLang.split("-")[0].toLowerCase();
      const voice = [...voices]
        .filter((item) => {
          const vl = String(item?.lang || "").toLowerCase();
          return vl === ttsLang.toLowerCase() || vl.startsWith(primary);
        })
        .sort((a, b) => scoreVoice(b, ttsLang) - scoreVoice(a, ttsLang))[0];

      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else {
        utterance.lang = ttsLang;
      }

      utterance.rate = 0.88;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      window.speechSynthesis.speak(utterance);
    };

    window.speechSynthesis.cancel();
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      speak();
      return;
    }

    window.speechSynthesis.onvoiceschanged = () => {
      speak();
      window.speechSynthesis.onvoiceschanged = null;
    };
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

    const sourceWord = String(word || "").trim();
    let targetWord = String(data.word || data.meaning || sourceWord).trim();
    let phoneticDisplay = String(data.phonetic || "").trim();

    // Detect IPA notation — both wrapped (/.../, [...]) and bare-form with stress
    // marks or IPA-only phonemic characters. Used to recognize when the AI has
    // accidentally put pronunciation into the "word" slot.
    const ipaPattern = /^[\/\[].+[\/\]]$|[ˈˌːəɜɪæʌʊɔθðʃʒŋɹɛɒɑœøɣ]/;

    // Case 1: AI returned IPA in "word" — swap into phonetic, recover word from source.
    if (data.word && ipaPattern.test(targetWord) && sourceWord) {
      if (!phoneticDisplay) phoneticDisplay = targetWord;
      targetWord = sourceWord;
    }

    let sameWord = sourceWord.toLowerCase() === targetWord.toLowerCase();

    // Case 2: AI returned target word in "phonetic" instead of "word" (Japanese
    // katakana, Korean Hangul, etc.). Salvage by promoting phonetic → word, but
    // ONLY when the target language uses a non-Latin script. For Latin-script
    // targets (English/French/German/etc.), non-ASCII in phonetic almost always
    // means IPA — leaving it in phonetic is correct.
    const targetLang = userConfig.targetLanguage || "zh-CN";
    const targetScriptRegex = (SCRIPT_HINTS.find(([code]) => code === targetLang) || [])[1];
    const phoneticIsTargetScript =
      targetScriptRegex && targetScriptRegex.test(phoneticDisplay);

    if (
      sameWord &&
      phoneticDisplay &&
      phoneticIsTargetScript &&
      !ipaPattern.test(phoneticDisplay) &&
      phoneticDisplay.toLowerCase() !== sourceWord.toLowerCase()
    ) {
      targetWord = phoneticDisplay;
      phoneticDisplay = "";
      sameWord = false;
    }

    // Drop phonetic if it duplicates the word.
    if (phoneticDisplay && phoneticDisplay === targetWord) {
      phoneticDisplay = "";
    }

    const audioLang =
      (userConfig.targetLanguage && LANG_TTS[userConfig.targetLanguage])
        ? userConfig.targetLanguage
        : null;

    const headerWordRow = popup.querySelector(".opendict-word-row");
    if (headerWordRow) {
      prefetchPronunciation(targetWord, audioLang);
      const sourcePart = sameWord
        ? ""
        : `<span class="opendict-source-word">${escapeHtml(sourceWord)}</span><span class="opendict-arrow">→</span>`;
      headerWordRow.innerHTML = `
        ${sourcePart}
        <span class="opendict-word">${escapeHtml(targetWord)}</span>
      `;
    }

    const phoneticHtml = phoneticDisplay
      ? `<span class="opendict-phonetic">${escapeHtml(phoneticDisplay)}</span>`
      : "";

    body.innerHTML = `
      <div class="opendict-row opendict-pos-only">
        <span class="opendict-pos">${escapeHtml(data.pos || "")}</span>
        ${phoneticHtml}
        <button class="opendict-icon-btn opendict-audio" title="Play pronunciation">
          <svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
        </button>
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
          if (typeof ex === "string") {
            // Strip legacy " | translation" form if AI accidentally returned bilingual.
            const idx = ex.indexOf(" | ");
            const targetOnly = idx >= 0 ? ex.slice(idx + 3) : ex;
            return escapeHtml(targetOnly.trim());
          }
          if (typeof ex === "object") {
            // Legacy bilingual object: prefer the target half.
            const target = ex.target || ex.translation || ex.cn || ex.zh || ex.ja || ex.ko || ex.meaning || "";
            const fallback = ex.en || ex.english || ex.sentence || "";
            return escapeHtml(target || fallback || "");
          }
          return "";
        })()}</div>
      </div>
    `;

    body.classList.remove("opendict-loading");

    body.querySelector(".opendict-audio")?.addEventListener(
      "click",
      () => playAudio(targetWord, audioLang),
    );

    // Add save-to-history button for word/phrase results
    const saveBtn = document.createElement("button");
    saveBtn.className = "opendict-save-btn";
    saveBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg><span>Save to wordbook</span>`;
    saveBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({
        type: "opendict-save-history",
        text: sourceWord,
        result: data,
      }, (resp) => {
        if (resp?.ok) {
          saveBtn.classList.add("saved");
          saveBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><span>Saved</span>`;
        }
      });
    });
    body.appendChild(saveBtn);

    autoCloseTimer = setTimeout(removePopup, 30000);
  }

  function isEditableElement(target) {
    if (!target) return false;
    const tag = target.tagName?.toLowerCase();
    return target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
  }

  function normalizeShortcut(value) {
    const raw = String(value || "Ctrl+Q").replace(/\s+/g, "");
    const parts = raw.split("+").filter(Boolean);

    let hasAlt = false;
    let hasCtrl = false;
    let hasShift = false;
    let hasMeta = false;
    let key = "";

    for (const p of parts) {
      const token = p.toLowerCase();
      if (token === "alt" || token === "option") hasAlt = true;
      else if (token === "ctrl" || token === "control") hasCtrl = true;
      else if (token === "shift") hasShift = true;
      else if (token === "cmd" || token === "command" || token === "meta") hasMeta = true;
      else key = p;
    }

    const keyNorm = String(key).toUpperCase();
    if (!keyNorm || !/^[A-Z0-9]$/.test(keyNorm)) return "Ctrl+Q";
    if (!(hasAlt || hasCtrl || hasShift || hasMeta)) return "Ctrl+Q";

    const normalizedParts = [];
    if (hasCtrl) normalizedParts.push("Ctrl");
    if (hasAlt) normalizedParts.push("Alt");
    if (hasShift) normalizedParts.push("Shift");
    if (hasMeta) normalizedParts.push("Cmd");
    normalizedParts.push(keyNorm);
    const normalized = normalizedParts.join("+");

    // Browser/system-reserved combos often never reach page scripts.
    if (/^(Ctrl\+T|Cmd\+T|Cmd\+Q)$/i.test(normalized)) {
      return "Ctrl+Q";
    }

    return normalized;
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
      shortcut = normalizeShortcut(cfg.triggerShortcut || "Ctrl+Q");
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

    // Debug: log modifier key presses to help diagnose shortcut issues
    if (e.ctrlKey || e.altKey || e.metaKey) {
      console.log("[OpenDict] keydown:", {
        key: e.key, code: e.code,
        ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey,
        currentShortcut: shortcut, parsed: parsedShortcut
      });
    }

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
    shortcut = normalizeShortcut(cfg.triggerShortcut || "Ctrl+Q");
    parsedShortcut = parseShortcut(shortcut);
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "opendict-trigger") {
      // Triggered by browser-level commands API shortcut
      const sel = window.getSelection();
      const currentSelection = sel?.toString().trim();
      const text = currentSelection || pendingSelection?.text;
      if (!text || text.length > 200) return;

      const context = pendingSelection?.context || "";
      const x = pendingSelection?.x ?? lastClickPos.x;
      const y = pendingSelection?.y ?? lastClickPos.y;

      requestTranslate(text, context, x, y);
      pendingSelection = null;
      return;
    }

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
