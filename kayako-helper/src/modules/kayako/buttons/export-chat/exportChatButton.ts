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
    fillPromptShared as fillPrompt, ensureDefaultProviders,
    mainDefaultUrl, providerSignature,
    augmentMissingDefaultProviders,
} from './promptUtils.ts';

import { EXTENSION_SELECTORS } from '@/generated/selectors.ts';
import { fetchTranscript }      from '@/utils/api.js';
import { isConvPage, currentConvId } from '@/utils/location.js';
import { extractProductValueSafe } from '@/modules/kayako/utils/product.ts';
import {
    loadStore, saveStore, findProvider, findUrl,
    Store, UrlEntry,
} from '@/utils/providerStore.ts';
import {
    registerSplitButton,
    SplitButtonConfig,
} from '@/modules/kayako/buttons/buttonManager.ts';
import { openSettingsModal } from './settingsModal.ts';
import { requestMessageSafe } from '@/utils/sendMessageSafe';

/* ───────────────────────── state ───────────────────────── */
let uiState: UiState = 'idle';
let store:   Store;
let currentConv: string | null = null;
let lastMenuSig = '';
let ephorJoinedIds: Set<string> | null = null;

// Load last fetched joined project ids (persisted) to avoid flicker/showing all
try {
    chrome.storage.local.get('kh-ephor-joined-ids').then(r => {
        const arr = r['kh-ephor-joined-ids'];
        if (Array.isArray(arr)) ephorJoinedIds = new Set<string>(arr.map(String));
    }).catch(() => {});
} catch {}

/* ───────────────────────── boot ────────────────────────── */
export async function bootExportChatButton(): Promise<void> {
    try {
        console.info('[exportChat] boot start');
        store = await loadStore();
        console.info('[exportChat] store loaded', { providers: store.providers.length });
        await ensureDefaultProviders(store);
        const changed = await augmentMissingDefaultProviders(store);
        if (changed) console.info('[exportChat] defaults augmented');

        if (!store.mainDefaultProviderId ||
            !findProvider(store, store.mainDefaultProviderId)) {
            store.mainDefaultProviderId = store.providers[0]?.id ?? null;
            await saveStore(store);
            console.info('[exportChat] mainDefaultProviderId set', { id: store.mainDefaultProviderId });
        }

    const cfg: SplitButtonConfig = {
        id: BTN_ID, rightId: MENU_ID, rightLabel: '▾',
        label : () => `${ICON[uiState]} ${uiState === 'idle' ? 'Export' :
            uiState === 'work' ? 'Working…' :
                uiState === 'ok'   ? 'Done' : 'Failed'}`,
        routeTest: isConvPage,
        onClick  : () => {
            // Prefer per-product default if mapped
            let url = mainDefaultUrl(store);
            try {
                const prod = (extractProductValueSafe() || '').trim().toLowerCase();
                if (prod) {
                    const p = findProvider(store, store.mainDefaultProviderId ?? '');
                    const byProd = (p as any)?.defaultUrlIdByProduct || {};
                    const urlId = byProd[prod];
                    if (urlId) url = findUrl(p!, urlId) ?? url;
                }
            } catch {}
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

        groupId   : EXTENSION_SELECTORS.tabStripCustomButtonAreaGroup2,
        groupOrder: 2,
    };

    try {
        registerSplitButton(cfg);
        console.info('[exportChat] button registered');
    } catch (e) {
        console.error('[exportChat] failed to register button', e);
    }
    } catch (e) {
        console.error('[exportChat] boot failed', e);
    }
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

        const sub = div(EXTENSION_SELECTORS.twoPartBtnDropdownSub.replace(/^./,''));
        row.appendChild(sub);

        const dflt = findUrl(p, p.defaultUrlId) ?? p.urls[0];
        row.addEventListener('click',  e => (e as MouseEvent).offsetX < row.offsetWidth - 16 && dflt && performExport(dflt));
        row.addEventListener('mouseenter', () => sub.style.display = 'flex');
        row.addEventListener('mouseleave', () => sub.style.display = 'none');

        // Filter Ephor subitems to only joined projects
        let urls = p.urls;
        if (p.id === 'ephor') {
            const parseProj = (u: UrlEntry) => { try { return new URL(u.url).pathname.split('/').pop() || ''; } catch { return ''; } };
            const useAllForNow = () => urls;
            if (ephorJoinedIds) {
                urls = urls.filter(u => ephorJoinedIds!.has(parseProj(u)) || !/\/project\//.test(u.url));
            } else {
                // kick off fetch and rebuild when ready
                (async () => {
                    try {
                        const res = await new Promise<{ ok?: boolean; data?: any }>(resolve =>
                            chrome.runtime.sendMessage({ action: 'ephor.listProjects' }, resolve),
                        );
                        const list: any[] = Array.isArray(res?.data) ? res!.data : (res?.data?.items ?? res?.data?.data ?? []);
                        ephorJoinedIds = new Set<string>(list.map((it: any) => String(it.id ?? it.project_id ?? it.uuid)));
                        try { chrome.storage.local.set({ 'kh-ephor-joined-ids': Array.from(ephorJoinedIds) }); } catch {}
                        lastMenuSig = '';
                        rebuildDropdown(menu);
                    } catch {
                        /* ignore */
                    }
                })();
                // Until fetched, prefer last persisted set; if none, show nothing for Ephor
                urls = (Array.isArray((ephorJoinedIds && Array.from(ephorJoinedIds))) && ephorJoinedIds)
                    ? urls.filter(u => ephorJoinedIds!.has(parseProj(u)) || !/\/project\//.test(u.url))
                    : urls.filter(u => !/\/project\//.test(u.url));
            }
        }

        for (const u of urls) {
            const li = div(EXTENSION_SELECTORS.twoPartBtnDropdownItem.replace(/^./,''));
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
        const prompt     = await fillPrompt(urlEntry.prompt || BLANK_PROMPT, transcript);
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
    const res = await requestMessageSafe<{ action:string; url:string; prompt:string; mode:ExportMode }, string | { ok?: boolean; error?: string }>(
        { action: 'exportChat.export', url, prompt, mode }, 'exportChat.openViaBg', { timeoutMs: 15000 },
    );
    if (res !== 'ok') throw new Error(typeof res === 'string' ? res : 'background error');
};
