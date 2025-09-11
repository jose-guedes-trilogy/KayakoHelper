/* src/utils/providerStore.ts
   ──────────────────────────────────────────────────────────
   CRUD helpers for the “export chat” feature.
   Keeps provider config in chrome.storage.sync and guarantees
   that the 3 default multi‑URL providers always exist.
*/

export interface UrlEntry {
    id: string;
    label: string;
    url: string;
    prompt: string;
    supportsInsertion: boolean;
    mode?: 'new-tab' | 'active-tab';
    /** Optional product association used for Ephor per-product defaults */
    product?: string;
}

/** A chat‑export provider (e.g. ChatGPT, Gemini …) */
export interface Provider {
    id: string;
    name: string;
    urls: UrlEntry[];
    defaultUrlId: string | null;

    /** `true` ⇒ user‑added, can hold many URLs
     *  `false`/`undefined` ⇒ built‑in single‑URL provider */
    multi?: boolean;              //  ← NEW
    /** Per-product default URL mapping (key = product name lowercased) */
    defaultUrlIdByProduct?: Record<string, string>;
}

export interface Store {
    providers: Provider[];
    mainDefaultProviderId: string | null;
}

/* ------------------------------------------------------------------ */
/* Storage helpers                                                    */
/* ------------------------------------------------------------------ */

const KEY = 'exportChat.providers';

const DEFAULTS: Store = {
    mainDefaultProviderId: 'chatgpt',
    providers: [
        makeDefault('chatgpt',  'ChatGPT'),
        makeDefault('gemini',   'Gemini'),
        makeDefault('ephor',    'Ephor'),
    ],
};

function makeDefault(id: string, name: string): Provider {
    /* built‑ins are single‑URL (“multi” = false) */
    return { id, name, urls: [], defaultUrlId: null, multi: false, defaultUrlIdByProduct: {} };   // ← CHANGED
}

/** normalises optional fields added over time (forward‑compat) */
export function normalizeStore(s: Store): Store {
    for (const p of s.providers) {
        /* add fields that may be missing in configs saved by older versions */
        if (p.multi === undefined) p.multi = true;                     // ← NEW
        if (!p.defaultUrlIdByProduct) p.defaultUrlIdByProduct = {};    // ← NEW
        for (const u of p.urls)
            if (!u.mode) u.mode = 'new-tab';
    }
    return s;
}

export async function loadStore(): Promise<Store> {
    // Prefer local first in case we previously fell back due to sync quota.
    try {
        const [localRaw, syncRaw] = await Promise.all([
            chrome.storage.local.get(KEY).catch(() => ({} as Record<string, unknown>)),
            chrome.storage.sync.get(KEY).catch(() => ({} as Record<string, unknown>)),
        ]);

        const localData = localRaw[KEY] as Store | undefined;
        if (localData) {
            console.info('[exportChat] loadStore: using chrome.storage.local');
            return normalizeStore(localData);
        }

        const syncData = syncRaw[KEY] as Store | undefined;
        if (syncData) {
            console.info('[exportChat] loadStore: using chrome.storage.sync');
            return normalizeStore(syncData);
        }

        // Nothing stored yet → seed lightweight defaults (small) to sync.
        try {
            await chrome.storage.sync.set({ [KEY]: DEFAULTS });
            console.info('[exportChat] loadStore: seeded defaults to sync');
        } catch (err) {
            console.warn('[exportChat] loadStore: failed to seed sync, seeding local instead', err);
            await chrome.storage.local.set({ [KEY]: DEFAULTS });
        }
        return structuredClone(DEFAULTS);
    } catch (err) {
        console.error('[exportChat] loadStore failed, returning in-memory defaults', err);
        return structuredClone(DEFAULTS);
    }
}

export async function saveStore(store: Store): Promise<void> {
    // Try sync first for cross-device settings; fall back to local on quota errors.
    try {
        await chrome.storage.sync.set({ [KEY]: store });
        // Mirror to local for resilience and to ensure future reads succeed even if sync is pruned.
        await chrome.storage.local.set({ [KEY]: store });
        console.info('[exportChat] saveStore: saved to sync and local');
    } catch (err) {
        const message = (err as Error)?.message || String(err);
        const approxSize = (() => { try { return JSON.stringify(store).length; } catch { return -1; } })();
        console.warn('[exportChat] saveStore: sync failed, falling back to local', { message, approxSize });
        await chrome.storage.local.set({ [KEY]: store });
        console.info('[exportChat] saveStore: saved to local only');
    }
}

/* Convenience helpers – used by the UI code */

export function findProvider(store: Store, id: string): Provider | undefined {
    return store.providers.find(p => p.id === id);
}

export function findUrl(p: Provider, urlId: string | null): UrlEntry | undefined {
    return urlId ? p.urls.find(u => u.id === urlId) : undefined;
}
