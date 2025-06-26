/* ===========================================================================
 * src/background/exportChatBg.ts
 * Background helper – v2.0
 *  • supports “active-tab” mode with no expiration
 *  • keeps track of which tab is designated as active
 *  • injects promptInserter.js on demand
 * ---------------------------------------------------------------------------
 */

let activeTabId: number | null = null;

/* utility: inject script (idempotent) then send prompt */
function sendPrompt(tabId: number, prompt: string, sendResponse: (msg: any) => void) {
    chrome.scripting.executeScript(
        { target: { tabId }, files: ['dist/promptInserter.js'], injectImmediately: true },
        () => {
            const err = chrome.runtime.lastError;
            if (err) { console.warn('[KayakoHelper] inject failed', err.message); sendResponse(err.message); return; }

            chrome.tabs.sendMessage(tabId, { action: 'KayakoHelper/insertPrompt', prompt }, () => {
                sendResponse('ok');
            });
        },
    );
}

/* handle messages */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    /* designate / clear / query active tab */
    if (msg?.action === 'exportChat.setActiveTab') {
        activeTabId = sender.tab?.id ?? null;
        sendResponse('ok'); return;
    }
    if (msg?.action === 'exportChat.clearActiveTab') {
        if (sender.tab?.id === activeTabId) activeTabId = null;
        sendResponse('ok'); return;
    }
    if (msg?.action === 'exportChat.getStatus') {
        sendResponse({ active: sender.tab?.id === activeTabId }); return;
    }

    /* (add inside the onMessage handler, just after the existing "exportChat.getStatus") */
    if (msg?.action === 'exportChat.activeExists') {
        sendResponse({ exists: activeTabId !== null }); return;
    }


    /* main entry point from content script */
    if (msg?.action === 'exportChat.export') {
        const { url, prompt, mode } = msg as { url: string; prompt: string; mode: 'new-tab' | 'active-tab'; };

        /* 1) active-tab path */
        if (mode === 'active-tab' && activeTabId !== null) {
            chrome.tabs.get(activeTabId, tab => {
                if (chrome.runtime.lastError || !tab) {
                    activeTabId = null;
                    sendResponse('Active tab no longer exists.');
                    return;
                }
                /* inject WITHOUT focusing the tab – user keeps current view */
                sendPrompt(activeTabId!, prompt, sendResponse);
            });
            return true;                    // async
        }

        /* 2) new-tab path (or fallback) */
        chrome.tabs.create({ url, active: true }, tab => {
            if (!tab?.id) { sendResponse('Could not create tab'); return; }

            activeTabId = tab.id;           // make the new one active by default
            chrome.tabs.onUpdated.addListener(function listener(id, info) {
                if (id !== tab.id || info.status !== 'complete') return;
                chrome.tabs.onUpdated.removeListener(listener);
                sendPrompt(tab.id!, prompt, sendResponse);
            });
        });

        return true;                        // async
    }
});

/* clean up if the active tab is closed */
chrome.tabs.onRemoved.addListener(id => {
    if (id === activeTabId) activeTabId = null;
});
