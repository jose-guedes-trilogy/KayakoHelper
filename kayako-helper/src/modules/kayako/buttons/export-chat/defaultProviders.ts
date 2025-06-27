// src/modules/export-chat/defaultProviders.ts
import { Provider } from '@/utils/providerStore.ts';
import { BLANK_PROMPT } from './constants.ts';

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
        id: 'ephor',   name: 'Ephor',   multi: false, defaultUrlId: 'ephor-0',
        urls: [{ id:'ephor-0',   label:'Ephor',   url:'https://ephor.ai/',
            prompt: BLANK_PROMPT, supportsInsertion: true }],
    },
];
