# Privacy Policy — OpenDict

**Last updated: March 7, 2026**

## Overview

OpenDict is a browser-based translation extension. It does **not** collect, transmit, or store any personal user data on external servers.

## Data Storage

- **User settings** (translation source, API Base URL, API Key, model, shortcut, export format) are stored locally in the browser via `chrome.storage.sync`. This data syncs across your Chrome devices through your Google account, but is never accessible to the extension developer.
- **Wordbook history** (saved translations) is stored locally via `chrome.storage.local` and never leaves your browser.

## Network Requests

OpenDict makes network requests **only** to the translation services you configure:

- **AI Translation**: Requests are sent to the API endpoint you specify (e.g., OpenAI, DeepSeek, OpenRouter). Your API key is sent directly to your chosen provider.
- **Google Translation**: Requests are sent to `translate.googleapis.com`.
- **Microsoft Translation**: Requests are sent to `www.bing.com`.
- **Pronunciation audio**: Requests are sent to `api.dictionaryapi.dev`, `translate.google.com`, and `dict.youdao.com`.

No data is sent to any server owned or operated by the extension developer.

## Data Collection

OpenDict does **not**:
- Collect personal information
- Track browsing activity
- Use analytics or telemetry
- Store data on external servers
- Share data with third parties

## Permissions Justification

| Permission | Reason |
|-----------|--------|
| `activeTab` | Read selected text on the current page for translation |
| `storage` | Save user settings and wordbook history locally |
| `scripting` | Inject translation popup into web pages |
| `downloads` | Export wordbook history as a file |
| `host_permissions (<all_urls>)` | Send requests to translation APIs (Google, Bing, user-configured AI endpoint, pronunciation audio sources) |

## Contact

If you have questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/hzyu-hub/browser-extension-OpenDict).

## Changes

Any changes to this privacy policy will be reflected in this document with an updated date.
