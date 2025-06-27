/* contentScriptEphor.ts – v1.1
 * Shows “Make Active” when visiting ephor.ai.
 * ------------------------------------------------------------------------- */


(async () => {
    /* Skip everything unless we’re on ChatGPT */
    if (!location.hostname.endsWith('ephor.ai')) return;

    /* Dynamically pull in the helper chunk (classic-script-safe) */
    const { initMakeTabActiveButton } = await import(
        /* @vite-ignore */ chrome.runtime.getURL('dist/activeTabButton.js')
        );

    /* Boot the button – predicate already satisfied above */
    await initMakeTabActiveButton(() => true);
})();
