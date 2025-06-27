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

(async () => {
    /* Skip everything unless we’re on ChatGPT */
    if (!location.hostname.endsWith('gemini.google.com')) return;

    /* Dynamically pull in the helper chunk (classic-script-safe) */
    const { initMakeTabActiveButton } = await import(
        /* @vite-ignore */ chrome.runtime.getURL('dist/activeTabButton.js')
        );

    /* Boot the button – predicate already satisfied above */
    await initMakeTabActiveButton(() => true);
})();
