// src/modules/export-chat/promptUtils.ts
import {
    Store, UrlEntry, findProvider, findUrl, saveStore,
} from '@/utils/providerStore.ts';
import { currentConvId } from '@/utils/location.js';
import { DEFAULT_PROVIDERS, EPHOR_DEFAULT_URLS } from './defaultProviders.ts';
import { PH } from './constants.ts';

/** Placeholder replacement */
export const fillPrompt = (tpl: string, transcript: string): string =>
    tpl.replaceAll(PH.TRANSCRIPT, transcript)
        .replaceAll(PH.URL, location.href)
        .replaceAll(PH.ID,  currentConvId() ?? '');

/** First-run bootstrap */
export async function ensureDefaultProviders(store: Store): Promise<void> {
    if (store.providers.length) return;
    store.providers             = structuredClone(DEFAULT_PROVIDERS);
    store.mainDefaultProviderId = 'chatgpt';
    await saveStore(store);
}

/** Merge in any default providers that are missing without overwriting existing ones. */
export async function augmentMissingDefaultProviders(store: Store): Promise<boolean> {
    let changed = false;
    for (const def of DEFAULT_PROVIDERS) {
        const existing = findProvider(store, def.id);
        if (!existing) {
            store.providers.push(structuredClone(def));
            changed = true;
            continue;
        }

        /* Ensure built-in providers have at least their default URL */
        if (!existing.urls?.length && def.urls?.length) {
            existing.urls = structuredClone(def.urls);
            existing.defaultUrlId = def.defaultUrlId ?? def.urls[0]?.id ?? null;
            changed = true;
        }

        /* Special case: Ephor should include the full project link list */
        if (def.id === 'ephor') {
            const seen = new Set((existing.urls ?? []).map(u => u.url));
            let added = 0;
            for (const u of EPHOR_DEFAULT_URLS) {
                if (!seen.has(u.url)) {
                    existing.urls.push(structuredClone(u));
                    seen.add(u.url);
                    added++;
                }
            }
            if (!existing.defaultUrlId) existing.defaultUrlId = existing.urls[0]?.id ?? null;
            if (existing.multi !== true) existing.multi = true;
            if (added) changed = true;
        }
    }
    if (changed) {
        if (!store.mainDefaultProviderId || !findProvider(store, store.mainDefaultProviderId)) {
            store.mainDefaultProviderId = 'chatgpt';
        }
        await saveStore(store);
    }
    return changed;
}

/** Default URL for the big “Export” button */
export const mainDefaultUrl = (s: Store): UrlEntry | undefined => {
    const p = findProvider(s, s.mainDefaultProviderId ?? '');
    return p ? findUrl(p, p.defaultUrlId) ?? p.urls[0] : undefined;
};

/** Cheap JSON sig → skip rebuilding dropdown if nothing changed */
export const providerSignature = (s: Store): string =>
    JSON.stringify(s.providers.map(p => ({
        id: p.id, def: p.defaultUrlId, urls: p.urls.map(u => u.id),
    })));

/** Convenience when adding the very first URL */
export const autoSetDefaultUrl = (p: Store['providers'][number]): void => {
    if (p.urls && p.urls.length === 1) p.defaultUrlId = p.urls[0]!.id;
};
