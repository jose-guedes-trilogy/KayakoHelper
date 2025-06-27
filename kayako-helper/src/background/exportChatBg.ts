/* ===========================================================================
 * Export-chat background helper – v3.0
 *  – keeps the active tab in chrome.storage.session
 *  – replies immediately to avoid the 30 s keep-alive limit
 *  – injects promptInserter.js from the bundle root
 * ---------------------------------------------------------------------------
 */

import type { ExportMode } from './constants';

let activeTabId: number | null = null;
const ACTIVE_KEY = 'exportChat.activeTabId';

/* ------------------------------------------------------------------ */
/*  Bootstrap – restore activeTabId if the service-worker restarted   */
/* ------------------------------------------------------------------ */
(async () => {
    const stored = (await chrome.storage.session.get(ACTIVE_KEY))[ACTIVE_KEY];
    if (typeof stored === 'number') activeTabId = stored;
})();

/* ------------------------------------------------------------------ */
/*  Small utilities                                                   */
/* ------------------------------------------------------------------ */

/** Persist the current active tab id; null clears */
async function setActive(id: number | null): Promise<void> {
    activeTabId = id;
    await chrome.storage.session.set({ [ACTIVE_KEY]: id ?? null });
}

/** Wait until the tab’s status reports “complete” */
function waitForLoad(tabId: number): Promise<void> {
    return new Promise<void>((resolve) => {
        chrome.tabs.get(tabId, (tab) => {
            if (tab?.status === 'complete') return resolve();

            const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
                if (id === tabId && info.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
    });
}

/** Open or reuse a tab depending on the chosen mode */
async function ensureTargetTab(url: string, mode: ExportMode): Promise<number> {
    if (mode === 'active-tab' && activeTabId !== null) {
        try {
            const tab = await chrome.tabs.get(activeTabId);
            if (tab.url !== url) await chrome.tabs.update(activeTabId, { url });
            return activeTabId; // ✅ we can reuse it
        } catch {
            /* fall through – tab vanished */
        }
    }

    // Otherwise create a fresh tab
    const { id } = await chrome.tabs.create({ url, active: true });
    if (!id) throw new Error('Could not create tab');
    await setActive(id);
    return id;
}

/** Inject the helper script and deliver the prompt */
async function injectPrompt(tabId: number, prompt: string): Promise<string> {
    await Promise.race([
        waitForLoad(tabId),                // page finished
        new Promise((r) => setTimeout(r, 15_000)), // …or max 15 s
    ]);

    // idempotently inject the content script from the bundle root
    await chrome.scripting.executeScript({
        target: { tabId },
        files: ['dist/promptInserter.js'],
        injectImmediately: true,
    });
    if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);

    // hand over the prompt
    return new Promise<string>((resolve) => {
        chrome.tabs.sendMessage(
            tabId,
            { action: 'exportChat.insertPrompt', prompt },
            (resp) => {
                if (chrome.runtime.lastError) {
                    return resolve(chrome.runtime.lastError.message);
                }
                resolve(typeof resp === 'string' ? resp : 'ok');
            },
        );
    });
}

/* ------------------------------------------------------------------ */
/*  onMessage router                                                  */
/* ------------------------------------------------------------------ */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    /* book-keeping shortcuts – unchanged from earlier versions */
    if (msg?.action === 'exportChat.setActiveTab') {
        void setActive(sender.tab?.id ?? null).then(() => sendResponse('ok'));
        return true;
    }
    if (msg?.action === 'exportChat.clearActiveTab') {
        if (sender.tab?.id === activeTabId) void setActive(null).then(() => sendResponse('ok'));
        else sendResponse('ok');
        return true;
    }
    if (msg?.action === 'exportChat.getStatus') {
        sendResponse({ active: activeTabId !== null });
        return;
    }
    if (msg?.action === 'exportChat.activeExists') {
        sendResponse({ exists: activeTabId !== null });
        return;
    }

    /* ----------------- main “export” entry-point ------------------ */
    if (msg?.action === 'exportChat.export') {
        // Wrap the async work so we can return `true` immediately
        (async () => {
            try {
                const { url, prompt, mode } = msg as {
                    url: string;
                    prompt: string;
                    mode: ExportMode;
                };

                const tabId  = await ensureTargetTab(url, mode);
                const result = await injectPrompt(tabId, prompt);
                sendResponse(result);
            } catch (err) {
                sendResponse((err as Error).message);
            }
        })();

        return true; // keep the message port open
    }
});

/* ------------------------------------------------------------------ */
/*  Clean up when the tab closes                                      */
/* ------------------------------------------------------------------ */
chrome.tabs.onRemoved.addListener((id) => {
    if (id === activeTabId) void setActive(null);
});
