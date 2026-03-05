// OpenDict Chrome Extension — Background Service Worker
// Handles translation and lookup export

// Default config
const DEFAULT_CONFIG = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  translationSource: "ai", // ai | google | microsoft
  triggerShortcut: "Ctrl+Q",
};

const HISTORY_KEY = "opendict_history";
const HISTORY_LIMIT = 1000;

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get("opendict_config", (data) => {
      resolve({ ...DEFAULT_CONFIG, ...data.opendict_config });
    });
  });
}

async function translateWithAI(text, context, config) {
  if (!config.apiKey) return { error: "请先在插件设置中配置 AI API Key" };

  const isWord = /^[a-zA-Z'-]+$/.test(text.trim());
  let prompt;

  if (isWord) {
    const contextInstruction = context
      ? `\nContext: "...${context.trim()}..."\nExplain the word "${text}" as used in this context.`
      : `\nWord: "${text}"`;

    prompt = `You are a concise English-Chinese dictionary. ${contextInstruction}
Provide a JSON response with these keys:
- "phonetic": IPA pronunciation (US)
- "pos": Part of speech (abbr. like n., vt., adj.)
- "meaning": Chinese translation (brief, context-appropriate)
- "example": String. English example + Chinese translation (e.g. "Example. | 翻译。")
- "definition": English definition
Output only valid JSON.`;
  } else {
    prompt = `Translate the following text to Chinese. Return a JSON object with a single key "translation".

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

async function translateWithGoogle(text) {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
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

async function translateWithMicrosoft(text) {
  try {
    const pageResp = await fetch("https://www.bing.com/translator");
    if (!pageResp.ok) {
      return translateWithGoogle(text);
    }

    const html = await pageResp.text();
    const tokenMatch = html.match(
      /params_AbusePreventionHelper\s*=\s*\[(\d+),"([^"]+)",(\d+)\]/,
    );
    const igMatch = html.match(/IG:"([A-Z0-9]+)"/);
    if (!tokenMatch || !igMatch) {
      return translateWithGoogle(text);
    }

    const key = tokenMatch[1];
    const token = tokenMatch[2];
    const ig = igMatch[1];

    const form = new URLSearchParams();
    form.set("fromLang", "auto-detect");
    form.set("to", "zh-Hans");
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

    if (!resp.ok) return translateWithGoogle(text);

    const data = await resp.json();
    if (data?.ShowCaptcha) return translateWithGoogle(text);

    const translation = data?.[0]?.translations?.[0]?.text?.trim();
    if (!translation) return translateWithGoogle(text);
    return { translation };
  } catch (e) {
    return translateWithGoogle(text);
  }
}

async function translateText(text, context, config) {
  const source = (config.translationSource || "ai").toLowerCase();
  if (source === "google") return translateWithGoogle(text);
  if (source === "microsoft") return translateWithMicrosoft(text);
  return translateWithAI(text, context, config);
}

function getExportMeaning(result) {
  if (!result || result.error) return "";
  if (typeof result.translation === "string" && result.translation.trim())
    return result.translation.trim();
  if (typeof result.meaning === "string" && result.meaning.trim()) {
    const definition =
      typeof result.definition === "string" ? result.definition.trim() : "";
    return definition
      ? `${result.meaning.trim()} | ${definition}`
      : result.meaning.trim();
  }
  return "";
}

async function saveHistoryRecord(text, result, source) {
  const meaning = getExportMeaning(result);
  if (!text || !meaning || result?.error) return;

  const entry = {
    text: text.trim(),
    meaning,
    source: source || "ai",
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
  // Migrate old shortcut
  chrome.storage.sync.get("opendict_config", (data) => {
    const cfg = data.opendict_config;
    if (cfg && cfg.triggerShortcut === "Alt+Q") {
      cfg.triggerShortcut = DEFAULT_CONFIG.triggerShortcut;
      chrome.storage.sync.set({ opendict_config: cfg });
    }
  });

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
      await saveHistoryRecord(
        msg.text,
        result,
        config.translationSource || "ai",
      );
      sendResponse(result);
    })();
    return true; // async response
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
});
