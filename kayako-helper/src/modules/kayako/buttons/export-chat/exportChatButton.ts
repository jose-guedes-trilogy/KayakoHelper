/* src/modules/export-chat/exportChatButton.ts
 * v3.0.0 – split refactor + newline-safe export
 */
import {
    BTN_ID, MENU_ID, ICON, UiState,
    HIDE_DELAY_MS, RESET_MS, BLANK_PROMPT, ExportMode,
} from './constants.ts';
import {
    DEFAULT_INSERTER_PROVIDERS,
} from './defaultProviders.ts';
import {
    fillPrompt, ensureDefaultProviders,
    mainDefaultUrl, providerSignature,
} from './promptUtils.ts';

import { EXTENSION_SELECTORS } from '@/generated/selectors.ts';
import { fetchTranscript }      from '@/utils/api.js';
import { isConvPage, currentConvId } from '@/utils/location.js';
import {
    loadStore, saveStore, findProvider, findUrl,
    Store, UrlEntry,
} from '@/utils/providerStore.ts';
import {
    registerSplitTabButton,
    SplitTabButtonConfig,
} from '@/utils/tabButtonManager.ts';
import { openSettingsModal } from './settingsModal.ts';

/* ───────────────────────── state ───────────────────────── */
let uiState: UiState = 'idle';
let store:   Store;
let currentConv: string | null = null;
let lastMenuSig = '';

/* ───────────────────────── boot ────────────────────────── */
export async function bootExportChatButton(): Promise<void> {
    store = await loadStore();
    await ensureDefaultProviders(store);

    if (!store.mainDefaultProviderId ||
        !findProvider(store, store.mainDefaultProviderId)) {
        store.mainDefaultProviderId = store.providers[0]?.id ?? null;
        await saveStore(store);
    }

    const cfg: SplitTabButtonConfig = {
        id: BTN_ID, rightId: MENU_ID, rightLabel: '▾',
        label : () => `${ICON[uiState]} ${uiState === 'idle' ? 'Export' :
            uiState === 'work' ? 'Working…' :
                uiState === 'ok'   ? 'Done' : 'Failed'}`,
        routeTest: isConvPage,
        onClick  : () => {
            const url = mainDefaultUrl(store);
            if (!url) alert('Please configure a default URL first.');
            else      void performExport(url);
        },
        onContextMenu: () => openSettingsModal(store),
        onRouteChange: (btn) => {
            if (!btn) { currentConv = null; lastMenuSig = ''; return; }
            if (currentConv !== currentConvId()) {
                currentConv = currentConvId();
                setState('idle', btn);
            }
        },
        hideDelayMs: HIDE_DELAY_MS,
        buildMenu  : rebuildDropdown,
    };

    registerSplitTabButton(cfg);
}

/* External helper (used by tests & background) */
export const setState = (s: UiState, el?: HTMLElement | null): void => {
    uiState = s;
    (el ?? document.getElementById(BTN_ID))!.textContent =
        `${ICON[s]} ${s === 'idle' ? 'Export' :
            s === 'work' ? 'Working…' :
                s === 'ok'   ? 'Done' : 'Failed'}`;
};

/* ───────── dropdown (unchanged logic, just smaller) ───────── */
function rebuildDropdown(menu: HTMLElement): void {
    const sig = providerSignature(store);
    if (sig === lastMenuSig) return;
    lastMenuSig = sig;
    menu.textContent = '';

    const div = (cls: string) => Object.assign(document.createElement('div'), { className: cls });

    for (const p of store.providers) {
        const row = div(EXTENSION_SELECTORS.twoPartBtnDropdownItem.slice(1));
        row.innerHTML =
            `<span style="display:flex;justify-content:space-between">${p.name}
         <div class="${EXTENSION_SELECTORS.twoPartBtnChevron.replace(/^./,'')} horizontal">▸</div>
       </span>`;
        menu.appendChild(row);

        const sub = div(EXTENSION_SELECTORS.twoPartBtnDropdownSub.slice(1));
        sub.style.top = '0'; row.appendChild(sub);

        const dflt = findUrl(p, p.defaultUrlId) ?? p.urls[0];
        row.addEventListener('click',  e => (e as MouseEvent).offsetX < row.offsetWidth - 16 && dflt && performExport(dflt));
        row.addEventListener('mouseenter', () => sub.style.display = 'flex');
        row.addEventListener('mouseleave', () => sub.style.display = 'none');

        for (const u of p.urls) {
            const li = div(EXTENSION_SELECTORS.twoPartBtnDropdownItem.slice(1));
            li.textContent = u.label;
            li.addEventListener('click', () => void performExport(u));
            sub.appendChild(li);
        }
    }
}

/* ───────────────────────── export ───────────────────────── */
async function performExport(urlEntry: UrlEntry): Promise<void> {
    const btn = document.getElementById(BTN_ID)! as HTMLButtonElement;
    setState('work', btn);

    try {
        const transcript = await fetchTranscript(1_000);
        const prompt     = fillPrompt(urlEntry.prompt || BLANK_PROMPT, transcript);
        const mode       = urlEntry.mode ?? 'new-tab';

        if (urlEntry.supportsInsertion) {
            await openViaBg(urlEntry.url, prompt, mode);
        } else {
            await navigator.clipboard.writeText(prompt);
            alert('Prompt copied to clipboard (automatic insertion not available).');
        }
        setState('ok', btn);
    } catch (err) {
        console.error('[exportChat] failed', err);
        setState('err', btn);
        alert(`Export failed: ${(err as Error).message}`);
    } finally {
        setTimeout(() => setState('idle'), RESET_MS);
    }
}

const openViaBg = async (url: string, prompt: string, mode: ExportMode): Promise<void> => {
    const res = await chrome.runtime.sendMessage({ action:'exportChat.export', url, prompt, mode });
    if (res !== 'ok') throw new Error(typeof res === 'string' ? res : 'background error');
};
