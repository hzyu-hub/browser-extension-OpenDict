// OpenDict PDF Feature Flags — read/cache/watch chrome.storage.local
const FLAG_DEFAULTS = {
  "opendict.search.nfkd": false,
  "opendict.search.fuzzy": false,
  "opendict.selection.v2": false,
};

let flagCache = { ...FLAG_DEFAULTS };
let flagsLoaded = false;

export async function loadFeatureFlags() {
  try {
    const result = await chrome.storage.local.get(Object.keys(FLAG_DEFAULTS));
    for (const [key, value] of Object.entries(FLAG_DEFAULTS)) {
      if (result[key] !== undefined) {
        flagCache[key] = !!result[key];
      }
    }
    flagsLoaded = true;
  } catch {
    // Storage read failure → use defaults (all features off)
    flagCache = { ...FLAG_DEFAULTS };
    flagsLoaded = true;
  }
}

export function getFlag(name) {
  return flagCache[name] ?? FLAG_DEFAULTS[name] ?? false;
}

export function watchFeatureFlags() {
  if (typeof chrome?.storage?.onChanged === "undefined") return;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in FLAG_DEFAULTS) {
        flagCache[key] = !!newValue;
      }
    }
  });
}

// For Node test environment: override defaults without chrome.storage
export function setFlagOverrides(overrides) {
  for (const [key, value] of Object.entries(overrides)) {
    if (key in FLAG_DEFAULTS) {
      flagCache[key] = !!value;
    }
  }
}

export function resetFlagCache() {
  flagCache = { ...FLAG_DEFAULTS };
  flagsLoaded = false;
}
