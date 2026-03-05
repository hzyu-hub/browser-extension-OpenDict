# Chrome Web Store 上架信息

以下内容直接复制粘贴到 Chrome Web Store Developer Dashboard。

---

## 简短描述 (Short Description, 132字符以内)

Select text and press Ctrl+Q to translate instantly. Supports AI, Google & Microsoft translation with pronunciation and wordbook.

---

## 详细描述 (Detailed Description)

OpenDict — Quick Lookup 是一款轻量级浏览器翻译插件，选中文字按快捷键即可翻译，无需离开当前页面。

🔤 三种翻译引擎
• AI 翻译 — 支持 OpenAI、DeepSeek、Gemini、OpenRouter 等所有 OpenAI 兼容 API，提供音标、词性、释义、英文定义和双语例句
• Google 翻译 — 零配置，开箱即用
• Microsoft 翻译 — 通过 Bing 免费翻译

🔊 真人发音
• Google TTS + 有道词典音频，多源自动切换
• 美式/英式发音可选

📚 生词本
• 翻译单词后可手动收藏到生词本
• 支持导出为 TSV / CSV / TXT / Anki 格式
• 可直接导入 Anki 制作记忆卡片

⌨️ 便捷操作
• 快捷键 Ctrl+Q 一键翻译（可自定义）
• 悬浮框可拖拽移动
• 30 秒自动关闭，不影响阅读

🔒 隐私安全
• 所有数据存储在本地浏览器，不上传任何服务器
• 不收集个人信息，不追踪浏览行为
• 开源项目，代码完全透明

GitHub: https://github.com/hzyu-hub/browser-extension-OpenDict

---

## 分类 (Category)

Productivity

---

## 语言 (Language)

Chinese (Simplified), English

---

## 隐私政策 URL (Privacy Policy URL)

https://github.com/hzyu-hub/browser-extension-OpenDict/blob/main/PRIVACY.md

---

## 权限说明 (填写 "Why do you need this permission?")

### activeTab
Required to read selected text on the current webpage when user triggers translation via keyboard shortcut.

### storage
Required to save user preferences (translation source, API configuration, keyboard shortcut) and wordbook history locally in the browser.

### scripting
Required to inject the translation popup script into web pages when triggered by the keyboard shortcut.

### downloads
Required to export wordbook history as downloadable files (TSV/CSV/TXT formats).

### host_permissions (<all_urls>)
Required to send translation requests to external APIs: Google Translate (translate.googleapis.com), Microsoft/Bing Translator (www.bing.com), user-configured AI API endpoints, and pronunciation audio sources (translate.google.com, dict.youdao.com).
