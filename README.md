# OpenDict — Quick Lookup

<p align="center">
  <img src="icons/icon128.png" alt="OpenDict Logo" width="96" />
</p>

<p align="center">
  <b>轻量级 Chrome 翻译插件，选词即译，多语言互译，支持 AI / Google / Microsoft 三大翻译源</b>
</p>

<p align="center">
  Chrome Extension · Manifest V3 · 无需注册即可使用
</p>

---

## ✨ 功能特性

- **三种翻译源**：AI（OpenAI 兼容）、Google 翻译、Microsoft 翻译
- **多语言互译**：源/目标语言独立可选，源语言支持 Auto-detect，覆盖英、中（简/繁）、日、韩、法、德、西、意、葡、俄、阿、印地、越、泰共 15 种
- **单词详解**：音标（IPA / pinyin / romaji 等按源语言）、词性、目标语释义、源语定义、双语例句
- **真人发音**：词典真人音频优先（英文），Google TTS 多语言 + 浏览器语音多源兜底
- **快捷键触发**：浏览器级快捷键，默认 `Ctrl+Q`（Chrome Commands API）
- **拖拽移动**：翻译悬浮框可自由拖动
- **手动收藏**：翻译单词后按需存入生词本，选择权完全交给用户
- **多格式导出**：TSV / CSV / TXT / Anki 格式，可直接导入 Anki 等记忆软件
- **支持自定义 API**：兼容所有 OpenAI 格式的 API 端点（DeepSeek、Moonshot、本地模型等）
- **PDF 内置阅读器**：自动拦截 PDF 页面，使用内置 PDF.js 渲染，支持文本选中翻译、缩放、页码导航
- **PDF 侧边栏目录**：自动提取 PDF 大纲，点击章节标题快速跳转
- **PDF 护眼模式**：一键切换暖色调滤镜，降低蓝光，长时间阅读更舒适
- **PDF 智能缩放**：CSS transform 即时缩放 + 延迟高清重渲染，零闪烁流畅体验

---

## 📸 界面预览

### 翻译悬浮框（白色主题）
- 选中单词 → 按下快捷键 → 弹出翻译结果
- 支持发音、收藏到生词本

### 插件设置页（浅色主题）
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

### 语言选择

设置页提供 **Source Language** 和 **Target Language** 两个下拉框：

- **Source Language**：默认 `Auto-detect`，可手动锁定为某一语言（用于多语混排文本）
- **Target Language**：默认 `Chinese (Simplified)`，可改为任意支持的语言

支持的语言：英语、简体中文、繁体中文、日语、韩语、法语、德语、西班牙语、意大利语、葡萄牙语、俄语、阿拉伯语、印地语、越南语、泰语。

> 💡 切换语言后立即生效，无需点保存按钮。AI 词典模式会按源语言自动切换音标格式（IPA / 拼音 / 罗马音 等）。

### AI 翻译配置

- **API Base URL**：默认 `https://api.openai.com/v1`，可替换为任意 OpenAI 兼容端点
- **API Key**：你的 API 密钥
- **Model**：默认 `gpt-4o-mini`，可点击刷新按钮从 API 自动拉取模型列表

支持的第三方 API 服务（只要兼容 OpenAI 格式）：

| 服务商 | API Base URL |
|--------|-------------|
| OpenAI | `https://api.openai.com/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` |
| DeepSeek | `https://api.deepseek.com/v1` |
| Moonshot (Kimi) | `https://api.moonshot.cn/v1` |
| 智谱 (GLM) | `https://open.bigmodel.cn/api/paas/v4` |
| Ollama（本地） | `http://localhost:11434/v1` |

> 💡 通过 OpenRouter 还可以间接使用 Claude、Llama 等不直接兼容 OpenAI 格式的模型。

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
- 🔤 **音标**（按源语言：IPA / 拼音 / 罗马音 等）
- 📝 **词性** + **目标语言释义**
- 📖 **源语言定义**
- 💬 **双语例句**
- 🔊 **发音按钮**（按源语言自动选择 TTS）
- 📌 **Save to wordbook** 按钮（手动收藏）

### 句子/段落翻译

直接显示目标语言译文，不显示收藏按钮。

### PDF 文件翻译

浏览器中打开任意 PDF 链接时，插件自动拦截并使用内置 PDF.js 阅读器渲染。PDF 页面中的文字可直接选中，按下快捷键即可翻译，操作体验与普通网页一致。

- 支持 `.pdf` URL 自动拦截和 `Content-Type: application/pdf` 检测
- 支持缩放（Ctrl+/- 或工具栏按钮）、页码导航、滚动定位
- 侧边栏目录：自动提取 PDF 大纲，点击跳转对应章节
- 护眼模式：工具栏 ☀ 按钮切换暖色调，状态自动记忆
- 智能缩放：先 CSS 缩放保持流畅，再异步重渲染保证清晰度
- 懒加载渲染：只渲染可见页面，大文件也不卡顿
- 本地 PDF 文件需在 `chrome://extensions` 中启用「允许访问文件网址」

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

按源语言自动选择最佳发音源：

**英文**（多源级联，优先真人音频）：
1. **DictionaryAPI 词典音频（优先美式）** — 首选
2. **有道词典音频（美式 / 英式）** — 词典音频第二梯队
3. **Google Translate TTS（美式 / 英式）** — 词典音频缺失时兜底
4. **Web Speech API** — 最终兜底

**其他语言**（中、日、韩、法、德、俄、阿等）：
1. **Google Translate TTS** — 主源（按目标语言代码切换 `tl=` 参数）
2. **Web Speech API** — 兜底（按 `lang` 前缀匹配可用 voice）

插件会先清洗选中的首尾标点，再按音源质量自动切换；每个远程音源有超时保护。

---

## 🏗️ 项目结构

```
browser-extension-OpenDict/
├── manifest.json      # 扩展配置（Manifest V3）
├── background.js      # 后台服务：翻译 API、历史存储、导出、PDF 拦截
├── content.js         # 内容脚本：悬浮框、发音、快捷键
├── content.css        # 悬浮框样式（白色主题）
├── popup.html         # 设置页面 HTML + CSS（浅色主题）
├── popup.js           # 设置页逻辑：配置管理、验证、导出
├── pdf-viewer.html    # 内置 PDF 阅读器页面
├── pdf-viewer.js      # PDF 渲染逻辑：懒加载、智能缩放、目录、护眼模式
├── pdf-viewer.css     # PDF 阅读器样式（暗色工具栏 + 白色页面 + 护眼模式）
├── lib/pdfjs/
│   ├── pdf.min.mjs        # PDF.js 4.x 主库
│   └── pdf.worker.min.mjs # PDF.js Web Worker
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
- **chrome.storage.sync** — 非敏感配置跨设备同步
- **chrome.storage.local** — 本地 API Key 与历史存储
- **chrome.downloads** — 文件导出下载
- **chrome.webNavigation / webRequest** — PDF 页面自动拦截与重定向
- **PDF.js 4.x**（Mozilla, Apache 2.0）— 内置 PDF 渲染与可选中文本层

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
- [DictionaryAPI](https://dictionaryapi.dev/) — 提供词典音频查询
- [有道词典](https://www.youdao.com/) — 提供真人发音音频
- [PDF.js](https://mozilla.github.io/pdf.js/)（Mozilla）— 内置 PDF 渲染引擎
