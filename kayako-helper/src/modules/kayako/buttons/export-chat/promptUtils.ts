// src/modules/export-chat/promptUtils.ts
import {
    Store, UrlEntry, findProvider, findUrl, saveStore,
} from '@/utils/providerStore.ts';
import { currentConvId } from '@/utils/location.js';
import { DEFAULT_PROVIDERS } from './defaultProviders.ts';
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
    if (p.urls.length === 1) p.defaultUrlId = p.urls[0].id;
};
