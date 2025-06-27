/* ========================================================================
 * contentScriptChatGPT.ts – v1.1
 * Injects the “Make Active” button when you visit chat.openai.com
 * without requiring an export to run first.
 * ------------------------------------------------------------------------
 */

(async () => {
    /* Skip everything unless we’re on ChatGPT */
    if (!location.hostname.endsWith('chat.openai.com')) return;

    /* Dynamically pull in the helper chunk (classic-script-safe) */
    const { initMakeTabActiveButton } = await import(
        /* @vite-ignore */ chrome.runtime.getURL('dist/activeTabButton.js')
        );

    /* Boot the button – predicate already satisfied above */
    await initMakeTabActiveButton(() => true);
})();
