/* ========================================================================
 * contentScriptChatGPT.ts – v1.1
 * Injects the “Make Active” button when you visit chat.openai.com
 * without requiring an export to run first.
 * ------------------------------------------------------------------------
 */

(async () => {
    /* Skip everything unless we’re on ChatGPT */
    const host = location.hostname;
    const isChatGpt =
        host === 'chat.openai.com'      || host.endsWith('.chat.openai.com') ||
        host === 'chatgpt.com'          || host.endsWith('.chatgpt.com');
    if (!isChatGpt) return;

    // ⤵ path is relative to the extension root, exactly as it sits in the packed CRX
    const url = chrome.runtime.getURL('dist/activeTabButton.js');

    // Now import it as a real ES-module
    const { initMakeTabActiveButton } = await import(url);

    await initMakeTabActiveButton(() => true);
})();