// src/modules/export-chat/constants.ts
import { EXTENSION_SELECTORS } from '@/generated/selectors.ts';

export const BTN_ID   = EXTENSION_SELECTORS.exportChatButton.replace(/^#/, '');
export const MENU_ID  = EXTENSION_SELECTORS.exportChatButtonRight.replace(/^#/, '');

export const ICON  = { idle: '📤', work: '⏳', ok: '✅', err: '❌' } as const;
export type UiState = keyof typeof ICON;

export const RESET_MS      = 2_000;
export const HIDE_DELAY_MS = 120;

export const PH = {
    URL       : '@#URL#@',
    ID        : '@#ID#@',
    TRANSCRIPT: '@#TRANSCRIPT#@',
} as const;

export const BLANK_PROMPT = `${PH.TRANSCRIPT}\n`;

export type ExportMode = 'new-tab' | 'active-tab';
