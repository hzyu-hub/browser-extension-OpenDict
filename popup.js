// OpenDict Chrome Extension — Popup Settings Logic

document.addEventListener("DOMContentLoaded", () => {
  const baseUrl = document.getElementById("baseUrl");
  const apiKey = document.getElementById("apiKey");
  const model = document.getElementById("model");
  const aiFields = document.getElementById("aiFields");
  const aiActions = document.getElementById("aiActions");
  const translationSource = document.getElementById("translationSource");
  const triggerShortcut = document.getElementById("triggerShortcut");
  const exportFormat = document.getElementById("exportFormat");
  const sourceHint = document.getElementById("sourceHint");
  const saveBtn = document.getElementById("save");
  const testBtn = document.getElementById("test");
  const exportBtn = document.getElementById("export");
  const status = document.getElementById("status");

  const DEFAULTS = {
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini",
    translationSource: "ai",
    triggerShortcut: "Alt+Q",
    exportFormat: "tsv",
  };

  function applySourceLayout() {
    const source = translationSource.value || "ai";
    const isAI = source === "ai";

    aiFields.style.display = isAI ? "block" : "none";
    aiActions.style.display = isAI ? "flex" : "none";

    sourceHint.textContent = isAI
      ? "AI translation requires API Key"
      : `${source === "google" ? "Google" : "Microsoft"} translation works without extra configuration`;
  }

  function normalizeShortcut(input) {
    const raw = String(input || "").trim();
    if (!raw) return DEFAULTS.triggerShortcut;
    return raw
      .split("+")
      .map((p) => p.trim())
      .filter(Boolean)
      .join("+");
  }

  function showStatus(msg, type) {
    status.textContent = msg;
    status.className = "status " + type;
  }

  function getCurrentConfigFromUI() {
    return {
      baseUrl: baseUrl.value.trim().replace(/\/+$/, "") || DEFAULTS.baseUrl,
      apiKey: apiKey.value.trim(),
      model: model.value.trim() || DEFAULTS.model,
      translationSource: translationSource.value || DEFAULTS.translationSource,
      triggerShortcut: normalizeShortcut(triggerShortcut.value),
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
    triggerShortcut.value = cfg.triggerShortcut;
    exportFormat.value = cfg.exportFormat || DEFAULTS.exportFormat;
    applySourceLayout();
  });

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

  triggerShortcut.addEventListener("change", () => {
    const config = getCurrentConfigFromUI();
    saveConfig(config, () => {
      showStatus("Shortcut updated", "success");
      setTimeout(() => {
        status.textContent = "";
      }, 1200);
    });
  });

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
