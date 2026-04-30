// OpenDict Chrome Extension — Background Service Worker
// Handles translation and lookup export

// Language registry — single source of truth for all language codes
const LANGUAGES = {
  "en":    { name: "English",                google: "en",    bing: "en",      tts: "en-US", scriptHint: null },
  "zh-CN": { name: "Chinese (Simplified)",   google: "zh-CN", bing: "zh-Hans", tts: "zh-CN", scriptHint: /[一-鿿]/ },
  "zh-TW": { name: "Chinese (Traditional)",  google: "zh-TW", bing: "zh-Hant", tts: "zh-TW", scriptHint: /[一-鿿]/ },
  "ja":    { name: "Japanese",               google: "ja",    bing: "ja",      tts: "ja-JP", scriptHint: /[぀-ヿ]/ },
  "ko":    { name: "Korean",                 google: "ko",    bing: "ko",      tts: "ko-KR", scriptHint: /[가-힯]/ },
  "fr":    { name: "French",                 google: "fr",    bing: "fr",      tts: "fr-FR", scriptHint: null },
  "de":    { name: "German",                 google: "de",    bing: "de",      tts: "de-DE", scriptHint: null },
  "es":    { name: "Spanish",                google: "es",    bing: "es",      tts: "es-ES", scriptHint: null },
  "it":    { name: "Italian",                google: "it",    bing: "it",      tts: "it-IT", scriptHint: null },
  "pt":    { name: "Portuguese",             google: "pt",    bing: "pt",      tts: "pt-BR", scriptHint: null },
  "ru":    { name: "Russian",                google: "ru",    bing: "ru",      tts: "ru-RU", scriptHint: /[Ѐ-ӿ]/ },
  "ar":    { name: "Arabic",                 google: "ar",    bing: "ar",      tts: "ar-SA", scriptHint: /[؀-ۿ]/ },
  "hi":    { name: "Hindi",                  google: "hi",    bing: "hi",      tts: "hi-IN", scriptHint: /[ऀ-ॿ]/ },
  "vi":    { name: "Vietnamese",             google: "vi",    bing: "vi",      tts: "vi-VN", scriptHint: null },
  "th":    { name: "Thai",                   google: "th",    bing: "th",      tts: "th-TH", scriptHint: /[฀-๿]/ },
};

function detectLanguage(text) {
  const sample = String(text || "").trim();
  if (!sample) return "en";
  for (const [code, meta] of Object.entries(LANGUAGES)) {
    if (meta.scriptHint && meta.scriptHint.test(sample)) return code;
  }
  return "en";
}

function resolveSourceLang(text, configuredSource) {
  if (configuredSource && configuredSource !== "auto" && LANGUAGES[configuredSource]) {
    return configuredSource;
  }
  return detectLanguage(text);
}

// Default config
const DEFAULT_CONFIG = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  translationSource: "ai", // ai | google | microsoft
  triggerShortcut: "Ctrl+Q",
  exportFormat: "tsv",
  sourceLanguage: "auto",   // "auto" or LANGUAGES key
  targetLanguage: "zh-CN",  // LANGUAGES key
};

const CONFIG_KEY = "opendict_config";
const API_KEY_KEY = "opendict_api_key";
const HISTORY_KEY = "opendict_history";
const HISTORY_LIMIT = 1000;
const PRONUNCIATION_CACHE_LIMIT = 200;
const pronunciationCache = new Map();

function getStorageValue(area, key) {
  return new Promise((resolve) => {
    chrome.storage[area].get(key, (data) => resolve(data[key]));
  });
}

function setStorageValue(area, payload) {
  return new Promise((resolve) => {
    chrome.storage[area].set(payload, resolve);
  });
}

function buildSyncConfig(config = {}) {
  return {
    baseUrl: config.baseUrl || DEFAULT_CONFIG.baseUrl,
    model: config.model || DEFAULT_CONFIG.model,
    translationSource: config.translationSource || DEFAULT_CONFIG.translationSource,
    triggerShortcut: config.triggerShortcut || DEFAULT_CONFIG.triggerShortcut,
    exportFormat: config.exportFormat || DEFAULT_CONFIG.exportFormat,
    sourceLanguage: config.sourceLanguage || DEFAULT_CONFIG.sourceLanguage,
    targetLanguage: config.targetLanguage || DEFAULT_CONFIG.targetLanguage,
  };
}

async function migrateLegacyApiKey(syncConfig = {}) {
  const legacyApiKey =
    typeof syncConfig.apiKey === "string" ? syncConfig.apiKey.trim() : "";
  if (!legacyApiKey) return;

  const storedApiKey = await getStorageValue("local", API_KEY_KEY);
  if (!storedApiKey) {
    await setStorageValue("local", { [API_KEY_KEY]: legacyApiKey });
  }

  const nextConfig = { ...syncConfig };
  delete nextConfig.apiKey;
  await setStorageValue("sync", { [CONFIG_KEY]: buildSyncConfig(nextConfig) });
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

function isDictionaryWord(text) {
  return /^[A-Za-z]+(?:[.'’-][A-Za-z]+)*$/.test(text);
}

function setPronunciationCache(key, value) {
  if (pronunciationCache.has(key)) pronunciationCache.delete(key);
  pronunciationCache.set(key, value);
  if (pronunciationCache.size > PRONUNCIATION_CACHE_LIMIT) {
    const oldestKey = pronunciationCache.keys().next().value;
    if (oldestKey) pronunciationCache.delete(oldestKey);
  }
}

function normalizeAudioUrl(url) {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function getPronunciationRegionRank(candidate) {
  const value = `${candidate.url || ""} ${candidate.text || ""}`.toLowerCase();
  if (/\b(us|american|en-us)\b/.test(value) || /[-_](us)(?:[.-]|$)/.test(value)) {
    return 0;
  }
  if (/\b(uk|british|en-gb)\b/.test(value) || /[-_](uk)(?:[.-]|$)/.test(value)) {
    return 1;
  }
  if (/\b(au|australian|nz)\b/.test(value) || /[-_](au|nz)(?:[.-]|$)/.test(value)) {
    return 2;
  }
  return 3;
}

function buildFallbackPronunciationSources(text, lang) {
  const encoded = encodeURIComponent(text);
  const sources = [];

  if (lang === "en" && isDictionaryWord(text)) {
    sources.push(
      {
        url: `https://dict.youdao.com/dictvoice?audio=${encoded}&type=2`,
        source: "youdao",
        label: "youdao-us",
      },
      {
        url: `https://dict.youdao.com/dictvoice?audio=${encoded}&type=1`,
        source: "youdao",
        label: "youdao-uk",
      },
    );
  }

  if (lang === "en") {
    sources.push(
      {
        url: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=en-us&client=tw-ob`,
        source: "google-tts",
        label: "google-us",
      },
      {
        url: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=en-gb&client=tw-ob`,
        source: "google-tts",
        label: "google-uk",
      },
    );
  } else {
    const tl = LANGUAGES[lang]?.google || "en";
    sources.push({
      url: `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=${tl}&client=tw-ob`,
      source: "google-tts",
      label: `google-${tl}`,
    });
  }

  return sources;
}

function dedupePronunciationSources(sources) {
  const seen = new Set();
  return sources.filter((source) => {
    const url = normalizeAudioUrl(source?.url);
    if (!url || seen.has(url)) return false;
    seen.add(url);
    source.url = url;
    return true;
  });
}

async function fetchDictionaryPronunciationSources(text) {
  if (!isDictionaryWord(text)) return [];

  const cacheKey = text.toLowerCase();
  if (pronunciationCache.has(cacheKey)) {
    return pronunciationCache.get(cacheKey);
  }

  const queries = Array.from(new Set([text, text.toLowerCase()]));
  for (const query of queries) {
    try {
      const resp = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(query)}`,
      );
      if (!resp.ok) continue;

      const data = await resp.json();
      const entries = Array.isArray(data) ? data : [];
      const sources = dedupePronunciationSources(
        entries
          .flatMap((entry) =>
            Array.isArray(entry?.phonetics) ? entry.phonetics : [],
          )
          .map((phonetic) => ({
            url: phonetic?.audio || "",
            text: phonetic?.text || "",
            source: "dictionaryapi",
            label: phonetic?.text || "",
          }))
          .filter((item) => item.url),
      ).sort((a, b) => {
        const regionDiff =
          getPronunciationRegionRank(a) - getPronunciationRegionRank(b);
        if (regionDiff !== 0) return regionDiff;
        const aMp3 = /\.mp3($|\?)/i.test(a.url) ? 0 : 1;
        const bMp3 = /\.mp3($|\?)/i.test(b.url) ? 0 : 1;
        return aMp3 - bMp3;
      });

      setPronunciationCache(cacheKey, sources);
      if (sources.length > 0) return sources;
    } catch {
      // Fall through to the next query variant.
    }
  }

  setPronunciationCache(cacheKey, []);
  return [];
}

async function getPronunciationPayload(text, langHint) {
  const normalizedText = normalizePronunciationText(text);
  if (!normalizedText) {
    return { normalizedText: "", sources: [], lang: "en" };
  }

  const lang =
    langHint && LANGUAGES[langHint] ? langHint : detectLanguage(normalizedText);

  const dictionarySources =
    lang === "en"
      ? await fetchDictionaryPronunciationSources(normalizedText)
      : [];
  const fallbackSources = buildFallbackPronunciationSources(normalizedText, lang);

  return {
    normalizedText,
    lang,
    sources: dedupePronunciationSources([
      ...dictionarySources,
      ...fallbackSources,
    ]),
  };
}

async function getConfig() {
  const [syncConfig, storedApiKey] = await Promise.all([
    getStorageValue("sync", CONFIG_KEY),
    getStorageValue("local", API_KEY_KEY),
  ]);

  const mergedSyncConfig = { ...DEFAULT_CONFIG, ...(syncConfig || {}) };
  const legacyApiKey =
    typeof syncConfig?.apiKey === "string" ? syncConfig.apiKey.trim() : "";
  await migrateLegacyApiKey(syncConfig || {});

  return {
    ...mergedSyncConfig,
    apiKey:
      typeof storedApiKey === "string" && storedApiKey.trim()
        ? storedApiKey.trim()
        : legacyApiKey,
  };
}

async function translateWithAI(text, context, config) {
  if (!config.apiKey) return { error: "请先在插件设置中配置 AI API Key" };

  const isWord = /^\p{L}[\p{L}\p{M}'’\-]*$/u.test(text.trim());
  const sourceLang = resolveSourceLang(text, config.sourceLanguage);
  const targetLang = config.targetLanguage && LANGUAGES[config.targetLanguage]
    ? config.targetLanguage
    : "zh-CN";
  const sourceLangName = LANGUAGES[sourceLang]?.name || "the source language";
  const targetLangName = LANGUAGES[targetLang]?.name || "Chinese";
  let prompt;

  if (isWord) {
    const contextInstruction = context
      ? `\nContext: "...${context.trim()}..."\nExplain the word "${text}" as used in this context.`
      : `\nWord: "${text}"`;

    prompt = `You are a concise ${targetLangName} monolingual dictionary.
The user looked up the ${sourceLangName} word "${text}". ${contextInstruction}

Step 1: Translate "${text}" into the most natural single-word ${targetLangName} equivalent in this context.
Step 2: Provide a ${targetLangName} dictionary entry for that translated word.

If "${text}" is already in ${targetLangName}, skip step 1 — just produce the entry for "${text}".

Return JSON with these keys:
- "word": The ${targetLangName} headword (the translation, or the original if same language).
- "phonetic": Phonetic representation of "word" in the convention native to ${targetLangName} (IPA for European languages; pinyin with tone marks for Chinese; hiragana + romaji for Japanese; Hangul + romanization for Korean; etc.). Empty string if not applicable.
- "pos": Part of speech, abbreviated. Use ${targetLangName} convention if available, else English (n., v., adj.).
- "definition": A short definition of "word", written entirely in ${targetLangName}.
- "example": One natural example sentence using "word", written entirely in ${targetLangName}. No bilingual content. No ${sourceLangName} text in this field.

All natural-language output (pos, definition, example) MUST be ${targetLangName} only. Do not include any ${sourceLangName} text in those fields.
Output only valid JSON.`;
  } else {
    prompt = `Translate the following ${sourceLangName} text to ${targetLangName}. Return a JSON object with a single key "translation".

"${text}"`;
  }

  try {
    const resp = await fetch(
      `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 350,
          temperature: 0.3,
        }),
      },
    );

    if (!resp.ok) {
      const err = await resp.text();
      return { error: `API Error ${resp.status}: ${err.slice(0, 100)}` };
    }

    const data = await resp.json();
    const contentStr = data.choices?.[0]?.message?.content || "{}";

    // Try to parse JSON from content
    try {
      // Remove markdown code blocks if present
      const cleanJson = contentStr.replace(/```json\n?|\n?```/g, "").trim();
      const result = JSON.parse(cleanJson);
      return result;
    } catch (e) {
      // Fallback for non-JSON response
      return { translation: contentStr };
    }
  } catch (e) {
    return { error: `Network error: ${e.message}` };
  }
}

async function translateWithGoogle(text, sourceLang, targetLang) {
  try {
    const sl =
      sourceLang && sourceLang !== "auto" && LANGUAGES[sourceLang]
        ? LANGUAGES[sourceLang].google
        : "auto";
    const tl = LANGUAGES[targetLang]?.google || "zh-CN";
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      return { error: `Google API Error ${resp.status}` };
    }
    const data = await resp.json();
    const translation = (data?.[0] || [])
      .map((item) => item?.[0] || "")
      .join("")
      .trim();
    if (!translation)
      return { error: "Google translation returned empty result" };
    return { translation };
  } catch (e) {
    return { error: `Google network error: ${e.message}` };
  }
}

async function translateWithMicrosoft(text, sourceLang, targetLang) {
  try {
    const pageResp = await fetch("https://www.bing.com/translator");
    if (!pageResp.ok) {
      return translateWithGoogle(text, sourceLang, targetLang);
    }

    const html = await pageResp.text();
    const tokenMatch = html.match(
      /params_AbusePreventionHelper\s*=\s*\[(\d+),"([^"]+)",(\d+)\]/,
    );
    const igMatch = html.match(/IG:"([A-Z0-9]+)"/);
    if (!tokenMatch || !igMatch) {
      return translateWithGoogle(text, sourceLang, targetLang);
    }

    const key = tokenMatch[1];
    const token = tokenMatch[2];
    const ig = igMatch[1];

    const fromLang =
      sourceLang && sourceLang !== "auto" && LANGUAGES[sourceLang]
        ? LANGUAGES[sourceLang].bing
        : "auto-detect";
    const toLang = LANGUAGES[targetLang]?.bing || "zh-Hans";

    const form = new URLSearchParams();
    form.set("fromLang", fromLang);
    form.set("to", toLang);
    form.set("text", text);
    form.set("token", token);
    form.set("key", key);

    const resp = await fetch(
      `https://www.bing.com/ttranslatev3?isVertical=1&&IG=${ig}&IID=translator.5028.1`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: form.toString(),
      },
    );

    if (!resp.ok) return translateWithGoogle(text, sourceLang, targetLang);

    const data = await resp.json();
    if (data?.ShowCaptcha) return translateWithGoogle(text, sourceLang, targetLang);

    const translation = data?.[0]?.translations?.[0]?.text?.trim();
    if (!translation) return translateWithGoogle(text, sourceLang, targetLang);
    return { translation };
  } catch (e) {
    return translateWithGoogle(text, sourceLang, targetLang);
  }
}

async function translateText(text, context, config) {
  const source = (config.translationSource || "ai").toLowerCase();
  const sourceLang = config.sourceLanguage || "auto";
  const targetLang = config.targetLanguage || "zh-CN";
  if (source === "google") return translateWithGoogle(text, sourceLang, targetLang);
  if (source === "microsoft") return translateWithMicrosoft(text, sourceLang, targetLang);
  return translateWithAI(text, context, config);
}

function getExportMeaning(result) {
  if (!result || result.error) return "";
  if (typeof result.translation === "string" && result.translation.trim())
    return result.translation.trim();
  if (typeof result.word === "string" && result.word.trim()) {
    const definition =
      typeof result.definition === "string" ? result.definition.trim() : "";
    return definition
      ? `${result.word.trim()} | ${definition}`
      : result.word.trim();
  }
  if (typeof result.meaning === "string" && result.meaning.trim()) {
    // legacy schema fallback (pre-v0.6.0 cached responses)
    const definition =
      typeof result.definition === "string" ? result.definition.trim() : "";
    return definition
      ? `${result.meaning.trim()} | ${definition}`
      : result.meaning.trim();
  }
  return "";
}

async function saveHistoryRecord(text, result, source, targetLanguage) {
  const meaning = getExportMeaning(result);
  if (!text || !meaning || result?.error) return;

  const entry = {
    text: text.trim(),
    meaning,
    source: source || "ai",
    targetLanguage: targetLanguage || "zh-CN",
    timestamp: Date.now(),
  };

  return new Promise((resolve) => {
    chrome.storage.local.get(HISTORY_KEY, (data) => {
      const list = Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
      list.push(entry);
      const trimmed = list.slice(-HISTORY_LIMIT);
      chrome.storage.local.set({ [HISTORY_KEY]: trimmed }, resolve);
    });
  });
}

function quoteCsv(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatExportLine(item, format) {
  if (format === "csv") {
    return `${quoteCsv(item.term)},${quoteCsv(item.meaning)}`;
  }
  if (format === "txt_pipe") {
    return `${item.term} | ${item.meaning}`;
  }
  if (format === "txt_anki") {
    return `${item.term};${item.meaning}`;
  }
  return `${item.term}\t${item.meaning}`;
}

function getExportMeta(format) {
  if (format === "csv") {
    return { mimeType: "text/csv", ext: "csv" };
  }
  if (format === "txt_pipe" || format === "txt_anki") {
    return { mimeType: "text/plain", ext: "txt" };
  }
  return { mimeType: "text/tab-separated-values", ext: "tsv" };
}

async function buildHistoryExport(options = {}) {
  return new Promise((resolve) => {
    chrome.storage.local.get(HISTORY_KEY, (data) => {
      const list = Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
      const dedupe = options?.dedupe !== false;
      const format = String(options?.format || "tsv");

      const normalized = list
        .map((item) => {
          const term = String(item.text || "")
            .replace(/[\t\n\r]+/g, " ")
            .trim();
          const meaning = String(item.meaning || "")
            .replace(/[\t\n\r]+/g, " ")
            .trim();
          const timestamp = Number(item.timestamp || 0);
          return { term, meaning, timestamp };
        })
        .filter((item) => item.term && item.meaning);

      let exportItems = normalized;
      if (dedupe) {
        const byTerm = new Map();
        for (const item of normalized) {
          const key = item.term.toLowerCase();
          const prev = byTerm.get(key);
          if (!prev || item.timestamp >= prev.timestamp) {
            byTerm.set(key, item);
          }
        }
        exportItems = Array.from(byTerm.values()).sort((a, b) =>
          a.term.localeCompare(b.term),
        );
      }

      const lines = exportItems.map((item) => formatExportLine(item, format));
      const meta = getExportMeta(format);
      resolve({
        content: lines.join("\n"),
        count: lines.length,
        mimeType: meta.mimeType,
        filename: `opendict-lookup-${new Date().toISOString().slice(0, 10)}.${meta.ext}`,
      });
    });
  });
}

// On install/update: migrate config + re-inject content script into existing tabs
chrome.runtime.onInstalled.addListener(() => {
  (async () => {
    const syncConfig = (await getStorageValue("sync", CONFIG_KEY)) || {};
    const nextConfig = { ...syncConfig };

    if (nextConfig.triggerShortcut === "Alt+Q") {
      nextConfig.triggerShortcut = DEFAULT_CONFIG.triggerShortcut;
    }

    await migrateLegacyApiKey(nextConfig);
    await setStorageValue("sync", { [CONFIG_KEY]: buildSyncConfig(nextConfig) });
  })();

  // Re-inject content script into all existing tabs so shortcut works immediately
  chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }, (tabs) => {
    for (const tab of tabs) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      }).catch(() => {});
      chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["content.css"],
      }).catch(() => {});
    }
  });
});

// Browser-level shortcut via commands API (most reliable)
chrome.commands.onCommand.addListener((command) => {
  if (command !== "trigger-translate") return;
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tabId = tabs[0]?.id;
    if (!tabId) return;
    try {
      await chrome.tabs.sendMessage(tabId, { type: "opendict-trigger" });
    } catch {
      // Content script not yet injected — inject it first, then retry
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
        await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
        await chrome.tabs.sendMessage(tabId, { type: "opendict-trigger" });
      } catch {
        // Page doesn't allow scripts (chrome://, edge://, etc.)
      }
    }
  });
});

// Handle messages from content script / popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "opendict-translate-request" && sender.tab?.id) {
    (async () => {
      const config = await getConfig();
      const result = await translateText(msg.text, msg.context, config);
      sendResponse(result);
    })();
    return true;
  }

  if (msg.type === "opendict-save-history") {
    (async () => {
      const config = await getConfig();
      await saveHistoryRecord(
        msg.text,
        msg.result,
        config.translationSource || "ai",
        config.targetLanguage || "zh-CN",
      );
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === "opendict-get-config") {
    (async () => {
      const config = await getConfig();
      sendResponse({
        sourceLanguage: config.sourceLanguage || "auto",
        targetLanguage: config.targetLanguage || "zh-CN",
        translationSource: config.translationSource || "ai",
      });
    })();
    return true;
  }

  if (msg.type === "opendict-export-history") {
    (async () => {
      const payload = await buildHistoryExport({
        dedupe: msg.dedupe,
        format: msg.format,
      });
      sendResponse(payload);
    })();
    return true;
  }

  if (msg.type === "opendict-get-pronunciation-sources") {
    (async () => {
      const payload = await getPronunciationPayload(msg.text, msg.lang);
      sendResponse(payload);
    })();
    return true;
  }

  // PDF fetch proxy — service worker is not bound by CORS
  if (msg.type === "opendict-fetch-pdf") {
    (async () => {
      try {
        const resp = await fetch(msg.url);
        if (!resp.ok) {
          sendResponse({ error: `HTTP ${resp.status}` });
          return;
        }
        const buffer = await resp.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const chunks = [];
        for (let i = 0; i < bytes.length; i += 8192) {
          chunks.push(
            String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)),
          );
        }
        sendResponse({ data: btoa(chunks.join("")) });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }
});

// --- PDF Viewer Support ---

// Intercept .pdf URL navigations → redirect to built-in viewer
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  const extOrigin = chrome.runtime.getURL("");
  if (details.url.startsWith(extOrigin)) return;
  try {
    const url = new URL(details.url);
    if (url.pathname.toLowerCase().endsWith(".pdf")) {
      chrome.tabs.update(details.tabId, {
        url:
          chrome.runtime.getURL("pdf-viewer.html") +
          "?url=" +
          encodeURIComponent(details.url),
      });
    }
  } catch {}
});

// Detect application/pdf Content-Type for non-.pdf URLs
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const extOrigin = chrome.runtime.getURL("");
    if (details.url.startsWith(extOrigin)) return;
    try {
      const url = new URL(details.url);
      if (url.pathname.toLowerCase().endsWith(".pdf")) return;
    } catch {}
    const ct = details.responseHeaders
      ?.find((h) => h.name.toLowerCase() === "content-type")
      ?.value?.toLowerCase();
    if (!ct?.includes("application/pdf")) return;
    // Don't intercept explicit downloads
    const cd = details.responseHeaders
      ?.find((h) => h.name.toLowerCase() === "content-disposition")
      ?.value?.toLowerCase();
    if (cd?.includes("attachment")) return;
    chrome.tabs.update(details.tabId, {
      url:
        chrome.runtime.getURL("pdf-viewer.html") +
        "?url=" +
        encodeURIComponent(details.url),
    });
  },
  { urls: ["<all_urls>"], types: ["main_frame"] },
  ["responseHeaders"],
);

// Inject content script into viewer pages so translation works
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url?.startsWith(chrome.runtime.getURL("pdf-viewer.html"))) return;
  chrome.scripting
    .executeScript({ target: { tabId }, files: ["content.js"] })
    .catch(() => {});
  chrome.scripting
    .insertCSS({ target: { tabId }, files: ["content.css"] })
    .catch(() => {});
});
