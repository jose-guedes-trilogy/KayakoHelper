/* src/contentScriptGemini.ts */

import {bootGeminiUploader} from '@/modules/gemini/geminiUploader.ts';

/* ===========================================================================
 * contentScriptGemini.ts – v1.0
 * Shows “Make Active” when visiting gemini.google.com/app.
 * ---------------------------------------------------------------------------
 */

bootGeminiUploader();

/* ========================================================================
 * contentScriptChatGPT.ts – v1.1
 * Injects the “Make Active” button when you visit chat.openai.com
 * without requiring an export to run first.
 * ------------------------------------------------------------------------
 */

// contentScriptGemini.ts
(async () => {
    if (!location.hostname.endsWith('gemini.google.com')) return;

    // ⤵ path is relative to the extension root, exactly as it sits in the packed CRX
    const url = chrome.runtime.getURL('dist/activeTabButton.js');

    // Now import it as a real ES-module
    const { initMakeTabActiveButton } = await import(url);

    await initMakeTabActiveButton(() => true);
})();

