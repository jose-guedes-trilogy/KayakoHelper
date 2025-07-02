/* contentScriptEphor.ts – v1.1
 * Shows “Make Active” when visiting ephor.ai.
 * ------------------------------------------------------------------------- */


(async () => {
    if (!location.hostname.endsWith('ephor.ai')) return;

    // ⤵ path is relative to the extension root, exactly as it sits in the packed CRX
    const url = chrome.runtime.getURL('dist/activeTabButton.js');

    // Now import it as a real ES-module
    const { initMakeTabActiveButton } = await import(url);

    await initMakeTabActiveButton(() => true);
})();