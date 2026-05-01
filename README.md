# OpenDict — Quick Lookup

<p align="center">
  <img src="icons/icon128.png" alt="OpenDict Logo" width="96" />
</p>

<p align="center">
  <b>English</b> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <b>Lightweight Chrome translation extension — select text, get instant translations across 15 languages, with AI-powered dictionary entries, neural TTS, and a built-in PDF reader.</b>
</p>

<p align="center">
  Chrome Extension · Manifest V3 · No signup required
</p>

---

## ✨ Features

- **Three translation engines**: AI (OpenAI-compatible), Google Translate, Microsoft (Bing) Translate
- **Any language pair**: Source / target languages independently selectable; source supports Auto-detect. 15 languages: English, Chinese (Simplified / Traditional), Japanese, Korean, French, German, Spanish, Italian, Portuguese, Russian, Arabic, Hindi, Vietnamese, Thai
- **Target-language monolingual dictionary**: AI mode shows the entry from the target-language perspective — target headword, target-language phonetic, target definition, target-only example, audio for the target word. The original source word stays small with an arrow for context
- **Human-quality pronunciation**: Real human recordings (DictionaryAPI / Youdao) for English; Microsoft Edge Neural TTS for everything else; Web Speech as final fallback
- **Keyboard shortcut**: Browser-level shortcut, default `Ctrl+Q` (Chrome Commands API)
- **Draggable popup**: Move the floating result anywhere on screen
- **Manual wordbook**: Save translations on demand — your call, not auto-collect
- **Multi-format export**: TSV / CSV / TXT / Anki-ready, drop straight into Anki and friends
- **Custom API endpoints**: Works with any OpenAI-compatible service (DeepSeek, Moonshot, local models, etc.)
- **Built-in PDF reader**: Auto-intercepts PDF pages, renders with PDF.js, supports text selection + translation, zoom, page navigation
- **PDF outline sidebar**: Auto-extracts the document outline, click any chapter to jump
- **PDF eye-care mode**: Toggle warm-tone filter to reduce blue light for long sessions
- **PDF smart zoom**: Instant CSS-transform zoom + delayed re-render at higher resolution — no flicker

---

## 📸 Preview

### Translation popup (light theme)
- Select a word → press the shortcut → result appears
- Audio playback, save to wordbook

### Settings page (light theme)
- Configure translation engine, API key, model
- Capture shortcut, pick export format

---

## 🚀 Installation

### From Release (recommended for end users)

1. Go to the [Releases page](https://github.com/hzyu-hub/browser-extension-OpenDict/releases) and download the latest `opendict-vX.Y.Z.zip`
2. Unzip the file to a permanent folder (e.g., `~/Applications/opendict/`) — **do not delete this folder after install**, the extension loads from it
3. Open Chrome and go to `chrome://extensions/`
4. Toggle **Developer mode** on (top-right corner)
5. Click **Load unpacked** and select the unzipped folder
6. Done — OpenDict is now in your toolbar

> Why "Load unpacked"? Chrome blocks self-signed `.crx` files outside of the Chrome Web Store, so a `.zip` + Load unpacked is the standard distribution path for unlisted extensions.

### From source (developer mode)

1. Clone the repo:
   ```bash
   git clone https://github.com/hzyu-hub/browser-extension-OpenDict.git
   ```

2. Open Chrome and go to `chrome://extensions/`

3. Toggle **Developer mode** (top right)

4. Click **Load unpacked** and pick the project folder

5. Done — the OpenDict icon appears in your toolbar

---

## ⚙️ Configuration

Click the OpenDict icon in the toolbar to open the settings page.

### Translation engine

| Engine | API key needed? | Notes |
|--------|:-:|------|
| **AI Translation** | ✅ | Full dictionary entries (phonetic / pos / definition / example), most thorough |
| **Google Translation** | ❌ | Zero config, works out of the box |
| **Microsoft Translation** | ❌ | Free via Bing, no setup |

### Language selection

The settings page exposes two dropdowns: **Source Language** and **Target Language**.

- **Source Language**: defaults to `Auto-detect`; can be locked to a specific language for mixed-script content
- **Target Language**: defaults to `Chinese (Simplified)`; switch to any of the 15 supported languages

Supported languages: English, Chinese (Simplified), Chinese (Traditional), Japanese, Korean, French, German, Spanish, Italian, Portuguese, Russian, Arabic, Hindi, Vietnamese, Thai.

> 💡 Changes apply instantly — no save button needed. AI dictionary mode picks the appropriate phonetic format per language (IPA / pinyin / romaji / etc.).

### AI configuration

- **API Base URL**: defaults to `https://api.openai.com/v1`; replace with any OpenAI-compatible endpoint
- **API Key**: your secret key
- **Model**: defaults to `gpt-4o-mini`; click the refresh button to fetch the available model list from your provider

Tested OpenAI-compatible services:

| Provider | API Base URL |
|--------|-------------|
| OpenAI | `https://api.openai.com/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` |
| DeepSeek | `https://api.deepseek.com/v1` |
| Moonshot (Kimi) | `https://api.moonshot.cn/v1` |
| Zhipu (GLM) | `https://open.bigmodel.cn/api/paas/v4` |
| Ollama (local) | `http://localhost:11434/v1` |

> 💡 Through OpenRouter you can also indirectly use Claude, Llama, and other non-OpenAI-compatible models.

### Shortcut

- Default: `Ctrl+Q` (`Control+Q` on macOS)
- Click the shortcut input on the settings page and press your combo to set it
- Requires at least one modifier (Ctrl / Alt / Shift) + a letter / digit
- Browser-reserved shortcuts (Ctrl+T, Cmd+Q, etc.) are auto-blocked

---

## 📖 Usage

### Basic flow

1. **Select** a word or passage on any web page
2. Press the shortcut `Ctrl+Q`
3. The popup appears with the translation

### Word lookup (AI mode)

The popup is a **monolingual entry in the target language**:

- 🔤 Header: `<source> → <target>` (collapsed when source==target) + **target-language phonetic** (IPA / pinyin / romaji / etc.)
- 📝 **Part of speech**
- 📖 **Definition** in target language
- 💬 **Example sentence** in target language only (no longer bilingual)
- 🔊 **Audio button**: plays the **target word** with target-language TTS
- 📌 **Save to wordbook**: stores the `source → target` pair for vocab study

### Sentence / paragraph translation

Shows the target-language translation directly — no wordbook button.

### PDF translation

Open any PDF link in the browser and the extension auto-intercepts it, rendering with the built-in PDF.js viewer. Text inside PDFs is selectable and translatable just like a regular web page.

- Auto-intercepts both `.pdf` URLs and `Content-Type: application/pdf` responses
- Zoom (`Ctrl +/-` or toolbar), page nav, scroll-to-page
- **Outline sidebar**: auto-extracts the PDF outline, click any chapter to jump
- **Eye-care mode**: toolbar ☀ button toggles warm tones, state remembered
- **Smart zoom**: CSS-transform first for instant feedback, then async re-render for crispness
- **Lazy rendering**: only visible pages render, large files stay smooth
- For local PDF files, enable "Allow access to file URLs" in `chrome://extensions`

### Popup interaction

- **Drag**: hold the popup header to move it anywhere
- **Close**: click the X, or wait 30 seconds for auto-close
- **Audio**: click the speaker icon to hear pronunciation

---

## 📚 Wordbook & Export

### Manual save

After a word translation, a **Save to wordbook** button appears at the bottom. Click to save — the icon turns green ✓ to confirm.

> Only word/phrase results show this button; sentence translations don't.

### Export formats

| Format | Layout | Use case |
|------|------|---------|
| **TSV** | `term[TAB]meaning` | Generic |
| **CSV** | `term,meaning` | Excel / Google Sheets |
| **TXT (pipe)** | `term \| meaning` | Plain text reading |
| **TXT (Anki)** | `term;meaning` | Direct import into Anki |

### Export behavior

- **Auto-dedup**: same term keeps only the latest translation
- **Alphabetical sort**: output is sorted by term
- **Auto filename**: includes today's date, e.g. `opendict-lookup-2026-05-01.tsv`
- **Cap**: stores up to 1000 most recent entries

---

## 🔊 Pronunciation system

Picks the most natural source per target language, with automatic fallback:

**target=English**:
1. **DictionaryAPI** (real human recordings, US preferred)
2. **Youdao dictionary audio** (real human, US / UK)
3. **Microsoft Edge Neural TTS** (`en-US-AriaNeural`, very natural neural synthesis)
4. **Google Translate TTS**
5. **Web Speech API**

**target=other languages** (Chinese, Japanese, Korean, French, German, Russian, Arabic, etc.):
1. **Microsoft Edge Neural TTS** (per-language neural voice: `zh-CN-XiaoxiaoNeural` / `ja-JP-NanamiNeural` / `fr-FR-DeniseNeural` / etc.)
2. **Google Translate TTS**
3. **Web Speech API**

> Edge Neural TTS uses the same endpoint that Microsoft Edge browser's "Read Aloud" feature hits — zero API key, zero setup, zero cost. Each remote source has a 5-second timeout and any failure cascades to the next source automatically. Repeated lookups of the same word are served from cache instantly.

---

## 🏗️ Project structure

```
browser-extension-OpenDict/
├── manifest.json      # Extension config (Manifest V3)
├── background.js      # Service worker: translation APIs, history, export, PDF intercept, Edge TTS
├── content.js         # Content script: popup, audio playback, shortcut
├── content.css        # Popup styles (light theme)
├── popup.html         # Settings page HTML + CSS (light theme)
├── popup.js           # Settings logic: config management, verification, export
├── pdf-viewer.html    # Built-in PDF reader page
├── pdf-viewer.js      # PDF rendering: lazy load, smart zoom, outline, eye-care
├── pdf-viewer.css     # PDF reader styles
├── lib/pdfjs/
│   ├── pdf.min.mjs        # PDF.js 4.x main library
│   └── pdf.worker.min.mjs # PDF.js Web Worker
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## 🛠️ Tech stack

- **Chrome Extension Manifest V3**
- **Chrome Commands API** — browser-level shortcut registration
- **Chrome Scripting API** — on-demand content script injection
- **WebSocket** — Edge Neural TTS streaming endpoint
- **Web Speech API** — speech synthesis fallback
- **chrome.storage.sync** — non-secret config sync across devices
- **chrome.storage.local** — local API key & history
- **chrome.downloads** — file export
- **chrome.webNavigation / webRequest** — PDF page interception & redirect
- **PDF.js 4.x** (Mozilla, Apache 2.0) — built-in PDF rendering with selectable text layer

---

## 📝 Development

### Local development

1. After editing code, click the **Reload** button on the extension card at `chrome://extensions/`
2. Refresh the test page to load the latest content script
3. If `manifest.json` changes, the extension fully reloads itself

### Debugging

- **Background**: at `chrome://extensions/`, click the "Service Worker" link to open DevTools
- **Content script**: press F12 on any page; logs are prefixed with `[OpenDict]`
- **Settings page**: right-click the extension icon → Inspect popup

---

## 📄 License

MIT License

---

## 🙏 Acknowledgements

- [Google Translate](https://translate.google.com/) — free translation service
- [Bing Translator](https://www.bing.com/translator) — Microsoft translation service
- [DictionaryAPI](https://dictionaryapi.dev/) — dictionary audio lookups
- [Youdao Dictionary](https://www.youdao.com/) — real human pronunciation audio
- [Microsoft Edge Read Aloud](https://www.microsoft.com/edge) — Neural TTS endpoint
- [PDF.js](https://mozilla.github.io/pdf.js/) (Mozilla) — built-in PDF rendering engine
