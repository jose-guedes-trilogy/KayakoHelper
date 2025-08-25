// src/modules/export-chat/defaultProviders.ts
import { Provider } from '@/utils/providerStore.ts';
import { BLANK_PROMPT } from './constants.ts';
import ephorProjects from './defaultEphorProjects.json';

type EphorProject = { project_id: string; invite_link_id: string };

/* Build default Ephor URLs from the JSON list */
let EPHOR_DEFAULT_URLS_FALLBACK: { id: string; label: string; url: string; prompt: string; supportsInsertion: boolean }[] = [
    { id: 'ephor-0', label: 'Ephor', url: 'https://ephor.ai/', prompt: BLANK_PROMPT, supportsInsertion: true },
];

export const EPHOR_DEFAULT_URLS = (() => {
    try {
        const entries = Object.entries(ephorProjects as Record<string, EphorProject>);
        if (!entries.length) return EPHOR_DEFAULT_URLS_FALLBACK;
        return entries.map(([label, meta], idx) => ({
            id: `ephor-${idx}`,
            label,
            url: `https://ephor.ai/project/${meta.project_id}`,
            prompt: BLANK_PROMPT,
            supportsInsertion: true,
        }));
    } catch (e) {
        console.error('[exportChat] failed to build Ephor defaults from JSON, using fallback', e);
        return EPHOR_DEFAULT_URLS_FALLBACK;
    }
})();

/* Prefer the "Default" project if present */
export const EPHOR_DEFAULT_URL_ID = (() => {
    const i = EPHOR_DEFAULT_URLS.findIndex(u => /^(default)$/i.test(u.label.trim()));
    return i >= 0 ? EPHOR_DEFAULT_URLS[i].id : EPHOR_DEFAULT_URLS[0]?.id ?? 'ephor-0';
})();

/* project_id → invite_link_id mapping for join flow */
export const EPHOR_PROJECT_INVITES: Record<string, string> = (() => {
    try {
        return Object.values(ephorProjects as Record<string, EphorProject>)
            .reduce((acc, v) => { acc[v.project_id] = v.invite_link_id; return acc; }, {} as Record<string, string>);
    } catch (e) {
        console.error('[exportChat] failed to build invite map from JSON', e);
        return {} as Record<string, string>;
    }
})();

export const DEFAULT_INSERTER_PROVIDERS = new Set(['chatgpt', 'gemini', 'ephor']);

export const DEFAULT_PROVIDERS: Provider[] = [
    {
        id: 'chatgpt', name: 'ChatGPT', multi: false, defaultUrlId: 'chatgpt-0',
        urls: [{ id:'chatgpt-0', label:'ChatGPT', url:'https://chat.openai.com/',
            prompt: BLANK_PROMPT, supportsInsertion: true }],
    },
    {
        id: 'gemini',  name: 'Gemini',  multi: false, defaultUrlId: 'gemini-0',
        urls: [{ id:'gemini-0',  label:'Gemini',  url:'https://gemini.google.com/app',
            prompt: BLANK_PROMPT, supportsInsertion: true }],
    },
    {
        id: 'ephor',   name: 'Ephor',   multi: true, defaultUrlId: EPHOR_DEFAULT_URL_ID,
        urls: EPHOR_DEFAULT_URLS,
    },
];
