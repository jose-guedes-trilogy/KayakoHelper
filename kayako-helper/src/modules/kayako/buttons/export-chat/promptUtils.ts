// src/modules/export-chat/promptUtils.ts
import {
    Store, UrlEntry, findProvider, findUrl, saveStore,
} from '@/utils/providerStore.ts';
import { currentConvId } from '@/utils/location.js';
import { DEFAULT_PROVIDERS, EPHOR_DEFAULT_URLS } from './defaultProviders.ts';
import { PH } from './constants.ts';
import { loadEphorStore } from '@/modules/kayako/buttons/ephor/ephorStore.ts';

/** Placeholder replacement */
export const fillPrompt = (tpl: string, transcript: string): string =>
    tpl.replaceAll(PH.TRANSCRIPT, transcript)
        .replaceAll(PH.URL, location.href)
        .replaceAll(PH.ID,  currentConvId() ?? '');

/** Shared placeholder replacement (URL/ID + Ephor system + canned). */
export async function fillPromptShared(tpl: string, transcript: string): Promise<string> {
    try {
        const base = fillPrompt(tpl, transcript)
            // also accept Ephor-style marker for transcript
            .replace(/@#\s*TRANSCRIPT\s*#@/gi, transcript)
            .replace(/{{\s*TRANSCRIPT\s*}}/gi, transcript)
            .replace(/@#\s*URL\s*#@/gi, location.href)
            .replace(/@#\s*ID\s*#@/gi, currentConvId() ?? '');

        const ephor = await loadEphorStore();
        let out = base;

        // System placeholder bodies (prefer ephemeral per-ticket overrides, then per-ticket persisted, then global)
        try {
            const ticketId = currentConvId();
            const projectId = ephor.selectedProjectId || '';
            const key = projectId && ticketId ? `${projectId}::${ticketId}` : '';
            const sysGlobal = ephor.systemPromptBodies || { fileAnalysis: '', pastTickets: '', styleGuide: '' };
            const persisted = key ? (ephor.systemPromptBodiesByContext?.[key] || {}) : {};
            let eph: any = {};
            try {
                eph = key ? ((await import('@/modules/kayako/buttons/ephor/ephorStore.ts')).ephemeralSystemPromptBodiesByContext?.[key] || {}) : {};
            } catch {}
            const bodyOf = (f: 'fileAnalysis'|'pastTickets'|'styleGuide') => {
                const v = (eph as any)[f] ?? (persisted as any)[f] ?? (sysGlobal as any)[f] ?? '';
                return typeof v === 'string' ? v : '';
            };
            out = out
                .replace(/@#\s*FILE_ANALYSIS\s*#@/gi, bodyOf('fileAnalysis'))
                .replace(/@#\s*PAST_TICKETS\s*#@/gi, bodyOf('pastTickets'))
                .replace(/@#\s*STYLE_GUIDE\s*#@/gi, bodyOf('styleGuide'));
        } catch {
            const sys = ephor.systemPromptBodies || { fileAnalysis: '', pastTickets: '', styleGuide: '' };
            out = out
                .replace(/@#\s*FILE_ANALYSIS\s*#@/gi, sys.fileAnalysis || '')
                .replace(/@#\s*PAST_TICKETS\s*#@/gi, sys.pastTickets  || '')
                .replace(/@#\s*STYLE_GUIDE\s*#@/gi, sys.styleGuide   || '');
        }

        // User-defined canned placeholders
        const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        for (const cp of ephor.cannedPrompts || []) {
            if (!cp?.placeholder) continue;
            try {
                const re = new RegExp(esc(cp.placeholder), 'g');
                out = out.replace(re, cp.body ?? '');
            } catch {/* ignore malformed */}
        }

        return out;
    } catch (err) {
        console.warn('[exportChat] fillPromptShared fell back to basic replacement', err);
        return fillPrompt(tpl, transcript);
    }
}

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
