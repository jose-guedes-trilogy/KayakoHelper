/* ===========================================================================
 * src/background/exportChatBg.ts
 * Export-chat background helper – v4.0  (provider-aware)
 * ---------------------------------------------------------------------------
 *  • tracks ONE active tab **per provider** (keyed by eTLD+1, e.g. "openai.com")
 *  • stores that map in chrome.storage.session
 *  • broadcasts changes only to tabs of the same provider
 *  • injects promptInserter.js and activeTabButton.js on demand
 * ---------------------------------------------------------------------------
 */

import type { ExportMode } from '@/modules/kayako/buttons/export-chat/constants';

type ProviderKey = string;              // e.g. "openai.com", "google.com"
type ActiveMap   = Record<ProviderKey, number /*tabId*/>;

const ACTIVE_KEY = 'exportChat.activeTabs';   // session-storage key
let activeTabs: ActiveMap = {};

/* ───────────────────────────────── bootstrap ─────────────────────────── */
(async () => {
    const stored = (await chrome.storage.session.get(ACTIVE_KEY))[ACTIVE_KEY];
    if (stored && typeof stored === 'object') activeTabs = stored as ActiveMap;
})();

/* ──────────────────────────── helpers ────────────────────────────────── */

/** Quick eTLD+1 extraction (fallback = hostname). */
function getProviderKey(urlOrStr: string | URL): ProviderKey {
    const h = (urlOrStr instanceof URL ? urlOrStr : new URL(urlOrStr))
        .hostname.replace(/^www\./i, '');
    const parts = h.split('.');
    return parts.length >= 2 ? parts.slice(-2).join('.') : h;
}

/** Persist (or clear) the active tab for a provider and broadcast. */
async function setActive(provider: ProviderKey, tabId: number | null): Promise<void> {
    if (tabId) activeTabs[provider] = tabId;
    else       delete activeTabs[provider];

    await chrome.storage.session.set({ [ACTIVE_KEY]: activeTabs });

    /* tell only tabs that belong to this provider */
    const targets = await chrome.tabs.query({
        url: [`*://${provider}/*`, `*://*.${provider}/*`],
    });

    for (const t of targets) {
        if (t.id) {
            chrome.tabs.sendMessage(t.id, {
                action  : 'exportChat.activeChanged',
                provider,
                activeId: tabId,          // null when cleared
            });
        }
    }
}

/** Wait until the tab reports status "complete". */
function waitForLoad(tabId: number): Promise<void> {
    return new Promise((resolve) => {
        chrome.tabs.get(tabId, (tab) => {
            if (tab?.status === 'complete') return resolve();

            const lis = (id: number, info: chrome.tabs.TabChangeInfo) => {
                if (id === tabId && info.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(lis);
                    resolve();
                }
            };
            chrome.tabs.onUpdated.addListener(lis);
        });
    });
}

/** Re-open or reuse the provider’s active tab, depending on mode. */
async function ensureTargetTab(url: string, mode: ExportMode): Promise<number> {
    const provider = getProviderKey(url);
    let tabId: number | undefined = activeTabs[provider];

    if (mode === 'active-tab' && tabId != null) {
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab.url !== url) await chrome.tabs.update(tabId, { url });
        } catch { tabId = undefined; }           // tab no longer exists
    }

    if (!tabId) {
        const created = await chrome.tabs.create({ url, active: true });
        if (!created.id) throw new Error('Could not create tab');
        tabId = created.id;
        await setActive(provider, tabId);
    }

    await chrome.tabs.update(tabId, { active: true });  // be sure it has focus
    return tabId;
}

/** Inject helper script(s) and hand over the prompt. */
async function injectPrompt(tabId: number, prompt: string, provider: ProviderKey): Promise<string> {
    await Promise.race([
        waitForLoad(tabId),
        new Promise(r => setTimeout(r, 15_000)),
    ]);

    await chrome.scripting.executeScript({
        target: { tabId },
        files:  ['dist/activeTabButton.js', 'dist/promptInserter.js'],
    });

    await chrome.scripting.executeScript({
        target: { tabId },
        func:  (prov: string) => {
            import(chrome.runtime.getURL('dist/activeTabButton.js'))
                .then(mod => mod.initMakeTabActiveButton?.(() => true, prov));
        },
        args: [provider],                        // <- now legal
    });

    if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message ?? 'unknown runtime error');
    }



    return new Promise<string>((resolve) => {
        chrome.tabs.sendMessage(
            tabId,
            { action: 'exportChat.insertPrompt', prompt },
            resp => {
                if (chrome.runtime.lastError) {
                    return resolve(chrome.runtime.lastError.message);
                }
                resolve(typeof resp === 'string' ? resp : 'ok');
            },
        );
    });
}

/* ────────────────────────── onMessage router ─────────────────────────── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    /* Resolve provider: explicit field → sender URL → '' */
    const provider = msg?.provider
        ?? (sender.tab?.url ? getProviderKey(sender.tab.url) : '');

    /* bookkeeping routes */
    if (msg?.action === 'exportChat.setActiveTab') {
        void setActive(provider, sender.tab?.id ?? null).then(() => sendResponse('ok'));
        return true;
    }

    if (msg?.action === 'exportChat.clearActiveTab') {
        if (sender.tab?.id === activeTabs[provider]) {
            void setActive(provider, null).then(() => sendResponse('ok'));
        } else sendResponse('ok');
        return true;
    }

    if (msg?.action === 'exportChat.isActiveTab') {
        sendResponse({ active: sender.tab?.id === activeTabs[provider] });
        return;
    }

    if (msg?.action === 'exportChat.getStatus') {
        sendResponse({ active: provider in activeTabs });
        return;
    }

    if (msg?.action === 'exportChat.activeExists') {
        sendResponse({ exists: provider in activeTabs });
        return;
    }

    /* ------------------------- main export ------------------------- */
    if (msg?.action === 'exportChat.export') {
        (async () => {
            try {
                const { url, prompt, mode } = msg as {
                    url: string;
                    prompt: string;
                    mode: ExportMode;
                };

                const tabId  = await ensureTargetTab(url, mode);
                const result = await injectPrompt(tabId, prompt, getProviderKey(url));
                sendResponse(result);
            } catch (err) {
                sendResponse((err as Error).message);
            }
        })();
        return true;                       // keep port open
    }
});

/* ───────────────────── clean up when tab closes ─────────────────────── */
chrome.tabs.onRemoved.addListener((id) => {
    for (const [prov, tId] of Object.entries(activeTabs)) {
        if (tId === id) { void setActive(prov, null); break; }
    }
});
