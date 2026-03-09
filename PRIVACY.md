# Privacy Policy — OpenDict

Last updated: March 9, 2026

## Overview

OpenDict is a browser extension that translates user-selected text, plays word pronunciation, and lets users optionally save vocabulary items locally. OpenDict does not operate its own backend servers. When network requests are needed, they are sent directly from the user's browser to the third-party service selected by the user or required for a requested feature.

This policy describes what data OpenDict handles, how it is used, where it is stored, and which third parties may receive it.

## Data OpenDict Handles

OpenDict may handle the following categories of data:

1. Selected text and limited page context
When the user invokes translation, the extension reads the selected text and may include a short surrounding context snippet to improve dictionary or translation results.

2. User configuration data
The extension stores settings entered by the user, including:
- translation source
- custom API base URL
- selected model
- keyboard shortcut
- export format

3. API credentials
If the user configures AI translation, the extension stores the user's API key locally in the browser so it can authenticate requests to the provider chosen by the user.

4. Wordbook history
If the user chooses to save a lookup result, the extension stores:
- the term
- the saved meaning
- the translation source
- a timestamp

5. Pronunciation request data
If the user presses the pronunciation button, the extension may send the selected word to pronunciation providers in order to fetch or play audio.

6. Connectivity test data
If the user presses the Verify button in the settings page, the extension sends a minimal test request to the configured provider or built-in translation service to confirm connectivity.

## How OpenDict Uses Data

OpenDict uses data only to provide the features requested by the user:

- translate selected text
- generate dictionary-style word explanations
- play pronunciation audio
- save wordbook entries locally
- export saved wordbook entries
- store and restore user settings
- verify that a configured provider is reachable

OpenDict does not sell user data, rent user data, use user data for advertising, or use user data for analytics or profiling.

## Where Data Is Stored

OpenDict stores data in the user's browser as follows:

- `chrome.storage.sync`: non-sensitive settings such as translation source, API base URL, selected model, keyboard shortcut, and export format
- `chrome.storage.local`: API key and saved wordbook history
- in-memory temporary state: transient selection/context data and pronunciation lookup cache used during the current browsing session

OpenDict does not send stored settings or saved vocabulary to any server operated by the developer.

## Third Parties That May Receive Data

Depending on which features the user chooses, data may be sent directly from the browser to the following third parties:

### Translation providers

- User-configured AI provider at the API base URL entered by the user
  Examples may include OpenAI, OpenRouter, DeepSeek, Gemini-compatible endpoints, or another OpenAI-compatible provider chosen by the user.
- Google Translate: `translate.googleapis.com`
- Microsoft/Bing Translator: `www.bing.com`

### Pronunciation providers

- DictionaryAPI: `api.dictionaryapi.dev`
- Youdao Dictionary: `dict.youdao.com`
- Google Translate TTS: `translate.google.com`

### Browser sync provider

- If the user is signed in to Chrome and sync is enabled, only the non-sensitive settings stored with `chrome.storage.sync` may be synchronized by Google as part of Chrome's sync functionality. The API key is stored separately in `chrome.storage.local` and is not intended to sync across devices through Chrome sync.

The developer of OpenDict does not receive selected text, saved vocabulary, API keys, or browsing data on developer-controlled servers.

## Data Sharing and Disclosure

OpenDict shares user data only as necessary to provide the requested feature. For example:

- selected text is sent to the chosen translation provider when the user requests a translation
- a selected word is sent to pronunciation providers when the user requests audio playback
- non-sensitive settings may sync through Chrome sync if the user has enabled browser sync

OpenDict does not transfer user data to advertising platforms, data brokers, or other resellers.

## Retention

- Settings remain stored until the user changes them, clears extension storage, disables browser sync, or removes the extension.
- Saved wordbook history remains stored locally until the user clears extension storage or removes the extension. The extension keeps up to the most recent 1000 saved records.
- Temporary in-memory data, such as selection context and pronunciation cache entries, is retained only for the current runtime/session and is not designed for permanent storage.

## User Choices and Controls

Users can control their data in the following ways:

- choose which translation source to use
- choose whether to save a wordbook entry
- change or remove API credentials in the settings page
- clear browser extension storage
- remove the extension at any time

## Security

OpenDict does not operate a developer backend for processing user data. Requests to built-in services are made over HTTPS where those services support it.

If the user configures a custom API endpoint, requests are sent to that endpoint exactly as configured by the user. Users should only use providers they trust and should prefer secure HTTPS endpoints.

## What OpenDict Does Not Do

OpenDict does not:

- collect data for advertising
- sell personal data
- run developer-controlled analytics on user activity
- upload saved wordbook history to developer servers
- intentionally collect passwords, payment information, or unrelated form data

## Changes to This Policy

If this privacy policy changes, the updated version will be posted at this document's public URL with a revised "Last updated" date.

## Contact

For questions about this privacy policy or the extension, please open an issue on the project repository:

https://github.com/hzyu-hub/browser-extension-OpenDict
