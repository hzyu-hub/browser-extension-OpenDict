# OpenDict — Quick Lookup

<p align="center">
  <img src="icons/icon128.png" alt="OpenDict Logo" width="96" />
</p>

<p align="center">
  <b>轻量级浏览器翻译插件，选词即译，支持 AI / Google / Microsoft 三大翻译源</b>
</p>

<p align="center">
  Chrome Extension · Manifest V3 · 无需注册即可使用
</p>

---

## ✨ 功能特性

- **三种翻译源**：AI（OpenAI 兼容）、Google 翻译、Microsoft 翻译
- **单词详解**：音标、词性、中文释义、英文定义、双语例句
- **真人发音**：Google TTS + 有道词典音频，多源自动切换
- **快捷键触发**：浏览器级快捷键，默认 `Ctrl+Q`（Chrome Commands API）
- **拖拽移动**：翻译悬浮框可自由拖动
- **手动收藏**：翻译单词后按需存入生词本，选择权完全交给用户
- **多格式导出**：TSV / CSV / TXT / Anki 格式，可直接导入 Anki 等记忆软件
- **支持自定义 API**：兼容所有 OpenAI 格式的 API 端点（DeepSeek、Moonshot、本地模型等）

---

## 📸 界面预览

### 翻译悬浮框（白色主题）
- 选中单词 → 按下快捷键 → 弹出翻译结果
- 支持发音、收藏到生词本

### 插件设置页（暗色主题）
- 配置翻译源、API Key、模型选择
- 快捷键录入、导出格式设定

---

## 🚀 安装方法

### 从源码安装（开发者模式）

1. 克隆仓库：
   ```bash
   git clone https://github.com/hzyu-hub/browser-extension-OpenDict.git
   ```

2. 打开 Chrome，进入 `chrome://extensions/`

3. 开启右上角 **开发者模式**

4. 点击 **加载已解压的扩展程序**，选择项目文件夹

5. 完成！插件图标会出现在浏览器工具栏

---

## ⚙️ 配置说明

点击工具栏的 OpenDict 图标打开设置页。

### 翻译源选择

| 翻译源 | 是否需要 API Key | 特点 |
|--------|:-:|------|
| **AI Translation** | ✅ | 单词详解（音标/词性/定义/例句），最全面 |
| **Google Translation** | ❌ | 零配置，开箱即用 |
| **Microsoft Translation** | ❌ | 通过 Bing 翻译，免费无需配置 |

### AI 翻译配置

- **API Base URL**：默认 `https://api.openai.com/v1`，可替换为任意 OpenAI 兼容端点
- **API Key**：你的 API 密钥
- **Model**：默认 `gpt-4o-mini`，可点击刷新按钮从 API 自动拉取模型列表

支持的第三方 API 服务（只要兼容 OpenAI 格式）：
- DeepSeek
- Moonshot (Kimi)
- 智谱 (GLM)
- Ollama（本地模型）
- 其他 OpenAI 兼容服务

### 快捷键设置

- 默认快捷键：`Ctrl+Q`（Mac 上为 `Control+Q`）
- 在设置页点击快捷键输入框，直接按下组合键即可修改
- 需要至少一个修饰键（Ctrl/Alt/Shift）+ 一个字母或数字
- 自动屏蔽浏览器保留快捷键（如 Ctrl+T、Cmd+Q）

---

## 📖 使用方法

### 基本流程

1. 在任意网页上**选中**一个单词或一段文字
2. 按下快捷键 `Ctrl+Q`
3. 悬浮框弹出翻译结果

### 单词翻译（AI 模式）

翻译结果包含：
- 🔤 **音标**（美式 IPA）
- 📝 **词性** + **中文释义**
- 📖 **英文定义**
- 💬 **双语例句**
- 🔊 **发音按钮**（真人发音）
- 📌 **Save to wordbook** 按钮（手动收藏）

### 句子/段落翻译

直接显示中文译文，不显示收藏按钮。

### 悬浮框操作

- **拖拽**：按住悬浮框顶部区域可拖动位置
- **关闭**：点击关闭按钮，或 30 秒后自动消失
- **发音**：点击音频按钮播放单词发音

---

## 📚 生词本 & 导出

### 手动收藏

翻译完成后，单词结果底部会显示「**Save to wordbook**」按钮。点击后单词被收藏，按钮变为绿色 ✓ 表示已保存。

> 只有单词/词组翻译结果会显示收藏按钮，句子翻译不会显示。

### 导出格式

| 格式 | 描述 | 适用场景 |
|------|------|---------|
| **TSV** | `term[TAB]meaning` | 通用格式 |
| **CSV** | `term,meaning` | Excel / Google Sheets |
| **TXT (pipe)** | `term \| meaning` | 纯文本阅读 |
| **TXT (Anki)** | `term;meaning` | 导入 Anki 制作记忆卡片 |

### 导出特性

- **自动去重**：同一单词只保留最新一次翻译
- **按字母排序**：导出文件按单词首字母排列
- **自动命名**：文件名包含日期，如 `opendict-lookup-2026-03-05.tsv`
- **最多存储 1000 条**记录

---

## 🔊 发音系统

采用多源级联策略，确保发音可靠性：

1. **Google Translate TTS（美式）** — 首选，最稳定
2. **Google Translate TTS（英式）** — 备选
3. **有道词典音频（美式）** — 第三备选
4. **有道词典音频（英式）** — 第四备选
5. **Web Speech API** — 最终兜底（浏览器内置语音合成）

每个源有 3 秒超时，自动切换到下一个。

---

## 🏗️ 项目结构

```
browser-extension-OpenDict/
├── manifest.json      # 扩展配置（Manifest V3）
├── background.js      # 后台服务：翻译 API、历史存储、导出
├── content.js         # 内容脚本：悬浮框、发音、快捷键
├── content.css        # 悬浮框样式（白色主题）
├── popup.html         # 设置页面 HTML + CSS（暗色主题）
├── popup.js           # 设置页逻辑：配置管理、验证、导出
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## 🛠️ 技术栈

- **Chrome Extension Manifest V3**
- **Chrome Commands API** — 浏览器级快捷键注册
- **Chrome Scripting API** — 按需注入内容脚本
- **Web Speech API** — 语音合成兜底
- **chrome.storage.sync** — 配置跨设备同步
- **chrome.storage.local** — 本地历史存储
- **chrome.downloads** — 文件导出下载

---

## 📝 开发说明

### 本地开发

1. 修改代码后，在 `chrome://extensions/` 页面点击扩展卡片上的 **刷新** 按钮
2. 刷新当前网页以加载最新的内容脚本
3. 如果修改了 `manifest.json`，需要重新加载整个扩展

### 调试

- **背景脚本**：在 `chrome://extensions/` 点击 "Service Worker" 链接打开 DevTools
- **内容脚本**：在网页上按 F12，在 Console 中查看 `[OpenDict]` 前缀的日志
- **设置页**：右键点击插件图标 → 检查弹出窗口

---

## 📄 许可证

MIT License

---

## 🙏 致谢

- [Google Translate](https://translate.google.com/) — 免费翻译服务
- [Bing Translator](https://www.bing.com/translator) — Microsoft 翻译服务
- [有道词典](https://www.youdao.com/) — 提供真人发音音频
