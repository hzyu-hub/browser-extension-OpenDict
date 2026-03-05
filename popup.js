// OpenDict Chrome Extension — Popup Settings Logic

document.addEventListener("DOMContentLoaded", () => {
  const baseUrl = document.getElementById("baseUrl");
  const apiKey = document.getElementById("apiKey");
  const model = document.getElementById("model");
  const fetchModelsBtn = document.getElementById("fetchModels");
  const aiFields = document.getElementById("aiFields");
  const aiActions = document.getElementById("aiActions");
  const translationSource = document.getElementById("translationSource");
  const triggerShortcutLabel = document.getElementById("triggerShortcutLabel");
  const openShortcutsBtn = document.getElementById("openShortcuts");
  const exportFormat = document.getElementById("exportFormat");
  const saveBtn = document.getElementById("save");
  const testBtn = document.getElementById("test");
  const exportBtn = document.getElementById("export");
  const status = document.getElementById("status");

  const DEFAULTS = {
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini",
    translationSource: "ai",
    triggerShortcut: "Ctrl+Q",
    exportFormat: "tsv",
  };

  function applySourceLayout() {
    const source = translationSource.value || "ai";
    const isAI = source === "ai";

    aiFields.style.display = isAI ? "block" : "none";
    aiActions.style.display = isAI ? "flex" : "none";
  }

  function normalizeShortcut(input) {
    const raw = String(input || "").trim();
    if (!raw) return DEFAULTS.triggerShortcut;

    const parts = raw
      .split("+")
      .map((p) => p.trim())
      .filter(Boolean);

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
    if (!keyNorm || !/^[A-Z0-9]$/.test(keyNorm)) return DEFAULTS.triggerShortcut;
    if (!(hasAlt || hasCtrl || hasShift || hasMeta)) return DEFAULTS.triggerShortcut;

    const normalizedParts = [];
    if (hasCtrl) normalizedParts.push("Ctrl");
    if (hasAlt) normalizedParts.push("Alt");
    if (hasShift) normalizedParts.push("Shift");
    if (hasMeta) normalizedParts.push("Cmd");
    normalizedParts.push(keyNorm);
    const normalized = normalizedParts.join("+");

    if (/^(Ctrl\+T|Cmd\+T|Cmd\+Q)$/i.test(normalized)) {
      return DEFAULTS.triggerShortcut;
    }

    return normalized;
  }

  function buildShortcutFromKeydown(event) {
    const parts = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Cmd");

    let key = "";
    if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
    else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
    else if (event.key && /^[a-z0-9]$/i.test(event.key)) key = event.key.toUpperCase();

    if (!key || parts.length === 0) return "";
    return normalizeShortcut([...parts, key].join("+"));
  }

  function showStatus(msg, type) {
    status.textContent = msg;
    status.className = "status " + type;
  }

  function getCurrentConfigFromUI() {
    return {
      baseUrl: baseUrl.value.trim().replace(/\/+$/, "") || DEFAULTS.baseUrl,
      apiKey: apiKey.value.trim(),
      model: model.value || DEFAULTS.model,
      translationSource: translationSource.value || DEFAULTS.translationSource,
    };
  }

  function saveConfig(config, callback) {
    chrome.storage.sync.set({ opendict_config: config }, () => {
      if (typeof callback === "function") callback();
    });
  }

  // Load saved config
  chrome.storage.sync.get("opendict_config", (data) => {
    const cfg = { ...DEFAULTS, ...(data.opendict_config || {}) };
    baseUrl.value = cfg.baseUrl;
    apiKey.value = cfg.apiKey;
    model.value = cfg.model;
    translationSource.value = cfg.translationSource;
    exportFormat.value = cfg.exportFormat || DEFAULTS.exportFormat;
    applySourceLayout();

    // Show the actual registered shortcut as key caps
    chrome.commands.getAll((cmds) => {
      const cmd = cmds.find(c => c.name === "trigger-translate");
      const shortcutStr = cmd?.shortcut || "Ctrl+Q";
      renderKeyCaps(shortcutStr);
    });
  });

  function setModelOptions(models, selectedModel) {
    const current = selectedModel || model.value;
    model.innerHTML = "";
    const seen = new Set();
    for (const m of models) {
      if (seen.has(m)) continue;
      seen.add(m);
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      model.appendChild(opt);
    }
    if (!seen.has(current)) {
      const opt = document.createElement("option");
      opt.value = current;
      opt.textContent = current;
      model.insertBefore(opt, model.firstChild);
    }
    model.value = current;
  }

  async function fetchModels() {
    const url = (baseUrl.value.trim().replace(/\/+$/, "") || DEFAULTS.baseUrl) + "/models";
    const key = apiKey.value.trim();
    if (!key) {
      showStatus("Enter API Key first", "error");
      return;
    }
    fetchModelsBtn.disabled = true;
    fetchModelsBtn.classList.add("spinning");
    showStatus("Fetching models...", "loading");
    try {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!resp.ok) {
        showStatus(`Failed to fetch models: ${resp.status}`, "error");
        return;
      }
      const data = await resp.json();
      const list = (data.data || data.models || [])
        .map((m) => m.id || m.name || m)
        .filter((id) => typeof id === "string")
        .sort();
      if (!list.length) {
        showStatus("No models found", "error");
        return;
      }
      setModelOptions(list, model.value);
      showStatus(`Loaded ${list.length} models`, "success");
      setTimeout(() => { status.textContent = ""; }, 1500);
    } catch (e) {
      showStatus(`Network error: ${e.message}`, "error");
    } finally {
      fetchModelsBtn.disabled = false;
      fetchModelsBtn.classList.remove("spinning");
    }
  }

  fetchModelsBtn.addEventListener("click", fetchModels);

  translationSource.addEventListener("change", applySourceLayout);
  translationSource.addEventListener("change", () => {
    const config = getCurrentConfigFromUI();
    saveConfig(config, () => {
      showStatus("Translation source updated", "success");
      setTimeout(() => {
        status.textContent = "";
      }, 1200);
    });
  });

  openShortcutsBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  });

  function renderKeyCaps(shortcutStr) {
    const keys = shortcutStr.split("+").map(k => k.trim()).filter(Boolean);
    const symbolMap = {
      "Ctrl": "Ctrl", "MacCtrl": "^", "Alt": "Alt", "Shift": "Shift",
      "Command": "\u2318", "Meta": "\u2318"
    };
    triggerShortcutLabel.innerHTML = keys.map((k, i) => {
      const label = symbolMap[k] || k;
      const sep = i < keys.length - 1 ? '<span class="key-plus">+</span>' : '';
      return `<span class="key-cap">${label}</span>${sep}`;
    }).join('');
  }

  exportFormat.addEventListener("change", () => {
    const config = getCurrentConfigFromUI();
    saveConfig(config, () => {
      showStatus("Export format updated", "success");
      setTimeout(() => {
        status.textContent = "";
      }, 1200);
    });
  });

  // Save config
  saveBtn.addEventListener("click", () => {
    const config = getCurrentConfigFromUI();

    saveConfig(config, () => {
      showStatus("Settings saved", "success");
      setTimeout(() => {
        status.textContent = "";
      }, 2000);
    });
  });

  // Test / Verify API connection
  testBtn.addEventListener("click", async () => {
    const cfg = getCurrentConfigFromUI();

    testBtn.disabled = true;
    showStatus(`Verifying ${cfg.translationSource}...`, "loading");

    try {
      if (cfg.translationSource === "google") {
        const resp = await fetch(
          "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=hello",
        );
        if (!resp.ok) {
          showStatus(`Google verify failed: ${resp.status}`, "error");
        } else {
          showStatus("Google translator is available", "success");
        }
      } else if (cfg.translationSource === "microsoft") {
        const resp = await fetch(
          "https://www.bing.com/translator",
          {
            method: "GET",
          },
        );

        if (!resp.ok) {
          showStatus(`Microsoft verify failed: ${resp.status}`, "error");
        } else {
          showStatus("Microsoft translation ready (no API key required)", "success");
        }
      } else {
        if (!cfg.apiKey) {
          showStatus("Please enter an AI API Key first", "error");
          return;
        }

        const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify({
            model: cfg.model,
            messages: [{ role: "user", content: "Say OK" }],
            max_tokens: 5,
            temperature: 0,
          }),
        });

        if (!resp.ok) {
          const errText = await resp.text();
          let detail = "";
          try {
            const errJson = JSON.parse(errText);
            detail = errJson.error?.message || errText.slice(0, 80);
          } catch {
            detail = errText.slice(0, 80);
          }
          showStatus(`Error ${resp.status}: ${detail}`, "error");
        } else {
          const data = await resp.json();
          const reply = data.choices?.[0]?.message?.content || "";
          showStatus(`Connected! Model replied: "${reply.trim()}"`, "success");
        }
      }
    } catch (e) {
      showStatus(`Network error: ${e.message}`, "error");
    } finally {
      testBtn.disabled = false;
    }
  });

  exportBtn.addEventListener("click", () => {
    exportBtn.disabled = true;
    showStatus("Preparing export...", "loading");

    chrome.runtime.sendMessage(
      {
        type: "opendict-export-history",
        format: exportFormat.value || "tsv",
      },
      (payload) => {
        if (chrome.runtime.lastError) {
          showStatus(
            `Export error: ${chrome.runtime.lastError.message}`,
            "error",
          );
          exportBtn.disabled = false;
          return;
        }

        const content = payload?.content || "";
        if (!content.trim()) {
          showStatus("No lookup history to export yet", "error");
          exportBtn.disabled = false;
          return;
        }

        const mimeType = payload?.mimeType || "text/tab-separated-values";
        const dataUrl =
          `data:${mimeType};charset=utf-8,` +
          encodeURIComponent(content);
        chrome.downloads.download(
          {
            url: dataUrl,
            filename: payload.filename || "opendict-lookup.tsv",
            saveAs: true,
            conflictAction: "uniquify",
          },
          () => {
            if (chrome.runtime.lastError) {
              showStatus(
                `Download failed: ${chrome.runtime.lastError.message}`,
                "error",
              );
            } else {
              showStatus(`Exported ${payload.count || 0} items`, "success");
            }
            exportBtn.disabled = false;
          },
        );
      },
    );
  });
});
