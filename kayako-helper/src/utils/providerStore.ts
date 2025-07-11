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
    return { id, name, urls: [], defaultUrlId: null, multi: false };   // ← CHANGED
}

/** normalises optional fields added over time (forward‑compat) */
export function normalizeStore(s: Store): Store {
    for (const p of s.providers) {
        /* add fields that may be missing in configs saved by older versions */
        if (p.multi === undefined) p.multi = true;                     // ← NEW
        for (const u of p.urls)
            if (!u.mode) u.mode = 'new-tab';
    }
    return s;
}

export async function loadStore(): Promise<Store> {
    const raw = await chrome.storage.sync.get(KEY);
    let data = raw[KEY] as Store | undefined;
    if (data) {
        return normalizeStore(data);
    }
    await chrome.storage.sync.set({ [KEY]: DEFAULTS });
    return structuredClone(DEFAULTS);
}

export async function saveStore(store: Store): Promise<void> {
    await chrome.storage.sync.set({ [KEY]: store });
}

/* Convenience helpers – used by the UI code */

export function findProvider(store: Store, id: string): Provider | undefined {
    return store.providers.find(p => p.id === id);
}

export function findUrl(p: Provider, urlId: string | null): UrlEntry | undefined {
    return urlId ? p.urls.find(u => u.id === urlId) : undefined;
}
