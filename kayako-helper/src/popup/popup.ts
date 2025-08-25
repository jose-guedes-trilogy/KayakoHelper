/* Kayako Helper – popup.ts */

import type { ToBackground, FromBackground } from '@/utils/messageTypes';
import { TicketData } from '@/background/replyDataBg.ts';

interface Prefs {
    trainingMode?: boolean;
    allStyles?: boolean;
    sendChunksWPM?: number;
    uiDarkCompat?: boolean;
    uiDarkTextColor?: string;
    uiDarkBgColor?: string;
    searchInRemember?: boolean;
    searchInDefaults?: string[];
    searchResultsAutoUpdate?: boolean;
    qcButtonEnabled?: boolean;
    qcTemplateOnly?: boolean;
    hideMessenger?: boolean;
}

/* ─ constants & state ─ */
const ITEMS_PER_PAGE = 10;
let currentPage = 0;
const allTickets: Record<string, TicketData> = {};
let currentTicketId: string | null = null;
let currentListMode: 'saved' | 'visited' = 'saved';

/* ─ UI references ─ */
const refs = {
    /* top-level tabs */
    tabButtons : Array.from(document.querySelectorAll<HTMLButtonElement>('nav .tab')),
    panels     : Array.from(document.querySelectorAll<HTMLElement>('section')),

    /* inner settings tabs */
    settingsTabButtons : Array.from(document.querySelectorAll<HTMLButtonElement>('#kh-settings-tabs .setting-tab')),
    settingsPanels     : Array.from(document.querySelectorAll<HTMLElement>('#kh-settings-panels .settings-subsection')),

    /* settings controls */
    chkTraining: document.getElementById('kh-training-mode-checkbox') as HTMLInputElement,
    chkHideMessenger: document.getElementById('kh-hide-messenger-checkbox') as HTMLInputElement,
    chkStyles  : document.getElementById('kh-toggle-styles-checkbox') as HTMLInputElement,
    inpWpm     : document.getElementById('kh-send-in-chunks-wpm-limit') as HTMLInputElement,

    /* Send to QC settings */
    chkQcBtnEnabled : document.getElementById('kh-setting-qc-btn-enabled') as HTMLInputElement,
    chkQcTemplateOnly: document.getElementById('kh-setting-qc-template-only') as HTMLInputElement,

    chkDarkCompat: document.getElementById('kh-ui-dark-compat-checkbox') as HTMLInputElement,
    inpDarkText  : document.getElementById('kh-ui-dark-text-color') as HTMLInputElement,
    inpDarkBg    : document.getElementById('kh-ui-dark-bg-color') as HTMLInputElement,

    /* Search in settings */
    chkSearchInRemember : document.getElementById('kh-searchin-remember') as HTMLInputElement,
    defConv : document.getElementById('kh-searchin-def-conv') as HTMLInputElement,
    defUsers: document.getElementById('kh-searchin-def-users') as HTMLInputElement,
    defOrgs : document.getElementById('kh-searchin-def-orgs') as HTMLInputElement,
    defArts : document.getElementById('kh-searchin-def-articles') as HTMLInputElement,
    defNone : document.getElementById('kh-searchin-def-none') as HTMLInputElement,

    /* search results auto-update */
    chkSearchResultsAuto: document.getElementById('kh-search-results-autoupdate') as HTMLInputElement,

    /* current ticket read-outs */
    lblId     : document.getElementById('kh-popup-ticket-info-id')       as HTMLElement,
    lblSubj   : document.getElementById('kh-popup-ticket-info-subject')  as HTMLElement,
    lblName   : document.getElementById('kh-popup-ticket-info-requester-name')  as HTMLElement,
    lblEmail  : document.getElementById('kh-popup-ticket-info-requester-email') as HTMLElement,
    lblReplies: document.getElementById('kh-popup-ticket-info-reply-count')     as HTMLElement,
    txtNotes  : document.getElementById('kh-popup-ticket-notes')         as HTMLTextAreaElement,

    /* list & paging */
    listTabButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('#kh-ticket-list-tabs .list-tab')),
    searchBox : document.getElementById('kh-search-tickets')  as HTMLInputElement,
    list      : document.getElementById('kh-ticket-list')     as HTMLUListElement,
    pager     : document.getElementById('kh-pagination')      as HTMLElement,

    ephorToken : document.getElementById('kh-ephor-api-token') as HTMLInputElement,

    /* copy open tabs button */
    copyOpenTabsBtn: document.getElementById('kh-copy-open-tabs-btn') as HTMLButtonElement,
};


document.addEventListener('DOMContentLoaded', () => {
    /* top-level tab bar */
    refs.tabButtons.forEach(btn =>
        btn.addEventListener('click', () => {
            refs.tabButtons.forEach(b => b.classList.toggle('active', b === btn));
            refs.panels.forEach(p => p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
        }),
    );

    /* inner settings sub-tabs (General / UI) */
    refs.settingsTabButtons.forEach(btn =>
        btn.addEventListener('click', () => {
            refs.settingsTabButtons.forEach(b => b.classList.toggle('active', b === btn));
            const target = btn.dataset.settings;
            refs.settingsPanels.forEach(p => p.classList.toggle('active', p.id === 'kh-sub-' + target));
        }),
    );

    /* sub-tabs (Saved / Visited) */
    refs.listTabButtons.forEach(btn =>
        btn.addEventListener('click', () => {
            refs.listTabButtons.forEach(b => b.classList.toggle('active', b === btn));
            currentListMode = btn.dataset.list as 'saved' | 'visited';
            currentPage = 0;
            renderList();
        }),
    );

    /* prefs */
    chrome.storage.sync.get([
        'trainingMode',
        'allStyles',
        'sendChunksWPM',
        'uiDarkCompat',
        'uiDarkTextColor',
        'uiDarkBgColor',
        'searchInRemember',
        'searchInDefaults',
        'searchResultsAutoUpdate',
        'qcButtonEnabled',
        'qcTemplateOnly',
        'hideMessenger',
    ] as const, res => {
        const { trainingMode, allStyles, sendChunksWPM, uiDarkCompat, uiDarkTextColor, uiDarkBgColor, searchInRemember, searchInDefaults, searchResultsAutoUpdate, qcButtonEnabled, qcTemplateOnly, hideMessenger } = res as Prefs;
        refs.chkTraining.checked = !!trainingMode;
        if (refs.chkHideMessenger) refs.chkHideMessenger.checked = !!hideMessenger;
        refs.chkStyles.checked   = allStyles       ?? true;
        refs.inpWpm.value        = (sendChunksWPM ?? 200).toString();

        refs.chkDarkCompat.checked = !!uiDarkCompat;
        refs.inpDarkText.value     = uiDarkTextColor ?? '#EAEAEA';
        refs.inpDarkBg.value       = uiDarkBgColor   ?? '#1E1E1E';

        // Search in settings
        const remember = !!searchInRemember;
        refs.chkSearchInRemember.checked = remember;
        toggleDefaultWrapVisibility(remember);

        const defs = Array.isArray(searchInDefaults) ? searchInDefaults : ['Conversations'];

        // None means no others checked
        const none = defs.length === 0;
        refs.defConv.checked  = !none && defs.includes('Conversations');
        refs.defUsers.checked = !none && defs.includes('Users');
        refs.defOrgs .checked = !none && defs.includes('Organizations');
        refs.defArts .checked = !none && defs.includes('Articles');

        // Search results auto-update (default: true)
        refs.chkSearchResultsAuto.checked = typeof searchResultsAutoUpdate === 'boolean' ? searchResultsAutoUpdate : true;
        // Send to QC settings
        if (refs.chkQcBtnEnabled)  refs.chkQcBtnEnabled.checked   = typeof qcButtonEnabled === 'boolean' ? qcButtonEnabled : true;
        if (refs.chkQcTemplateOnly) refs.chkQcTemplateOnly.checked = !!qcTemplateOnly;
    });

    refs.chkTraining.addEventListener('change', () => {
        const enabled = refs.chkTraining.checked;
        chrome.runtime.sendMessage<ToBackground>({ action: 'setTrainingMode', enabled });
        chrome.storage.sync.set({ trainingMode: enabled });
    });
    refs.chkHideMessenger?.addEventListener('change', () => {
        const hide = !!refs.chkHideMessenger.checked;
        try { console.debug('[KH] Setting hideMessenger ->', hide); } catch {}
        chrome.storage.sync.set({ hideMessenger: hide });
    });
    refs.chkStyles.addEventListener('change', () => {
        const enabled = refs.chkStyles.checked;
        chrome.runtime.sendMessage<ToBackground>({ action: 'setAllStylesEnabled', enabled });
        chrome.storage.sync.set({ allStyles: enabled });
    });
    refs.inpWpm.addEventListener('change', () => {
        const wpm = Math.max(50, Math.min(800, Number(refs.inpWpm.value) || 200));
        refs.inpWpm.value = wpm.toString();
        chrome.storage.sync.set({ sendChunksWPM: wpm });
    });

    /* ------- Send to QC settings ------- */
    refs.chkQcBtnEnabled?.addEventListener('change', () => {
        const enabled = !!refs.chkQcBtnEnabled.checked;
        chrome.storage.sync.set({ qcButtonEnabled: enabled });
    });
    refs.chkQcTemplateOnly?.addEventListener('change', () => {
        const only = !!refs.chkQcTemplateOnly.checked;
        chrome.storage.sync.set({ qcTemplateOnly: only });
    });

    /* ------- UI Dark Mode compatibility ------- */
    refs.chkDarkCompat.addEventListener('change', () => {
        chrome.storage.sync.set({ uiDarkCompat: refs.chkDarkCompat.checked });
    });
    // live updates while dragging the color picker
    refs.inpDarkText.addEventListener('input', () => {
        const val = refs.inpDarkText.value || '#EAEAEA';
        chrome.storage.sync.set({ uiDarkTextColor: val });
    });
    refs.inpDarkText.addEventListener('change', () => {
        const val = refs.inpDarkText.value || '#EAEAEA';
        chrome.storage.sync.set({ uiDarkTextColor: val });
    });
    refs.inpDarkBg.addEventListener('input', () => {
        const val = refs.inpDarkBg.value || '#1E1E1E';
        chrome.storage.sync.set({ uiDarkBgColor: val });
    });
    refs.inpDarkBg.addEventListener('change', () => {
        const val = refs.inpDarkBg.value || '#1E1E1E';
        chrome.storage.sync.set({ uiDarkBgColor: val });
    });

    /* ------- Search in settings ------- */
    refs.chkSearchInRemember?.addEventListener('change', () => {
        const remember = !!refs.chkSearchInRemember.checked;
        chrome.storage.sync.set({ searchInRemember: remember });
        toggleDefaultWrapVisibility(remember);
    });

    [refs.defConv, refs.defUsers, refs.defOrgs, refs.defArts].forEach(cb => {
        cb?.addEventListener('change', () => {
            saveDefaultInSelection();
        });
    });

    /* ------- Results page auto-update setting ------- */
    refs.chkSearchResultsAuto?.addEventListener('change', () => {
        const enabled = !!refs.chkSearchResultsAuto.checked;
        chrome.storage.sync.set({ searchResultsAutoUpdate: enabled });
    });

    /* ------- Ephor API token ------- */
    const MISC_KEY = 'kh-ephor-misc';

    // populate
    chrome.storage.local.get(MISC_KEY, raw => {
        refs.ephorToken.value = raw[MISC_KEY]?.token ?? '';
    });

    // save on change
    refs.ephorToken.addEventListener('change', () => {
        const token = refs.ephorToken.value.trim();
        chrome.storage.local.get(MISC_KEY, raw => {
            const misc = raw[MISC_KEY] ?? { apiBase: 'https://api.ephor.ai', token: '' };
            misc.token = token;
            chrome.storage.local.set({ [MISC_KEY]: misc });
        });
    });

    /* live ticket info */
    getCurrentTabTicketId().then(ticketId => {
        currentTicketId = ticketId;
        if (!ticketId) return;

        refs.lblId.textContent = ticketId;
        chrome.runtime.sendMessage<ToBackground>({ action: 'getStats', ticketId });

        refs.txtNotes.disabled = false;
        refs.txtNotes.addEventListener('input', () => {
            chrome.runtime.sendMessage<ToBackground>({
                action: 'saveNotes',
                ticketId,
                notes: refs.txtNotes.value.trim(),
            });
        });
    });

    /* ticket list */
    chrome.runtime.sendMessage<ToBackground>({ action: 'getAllTickets' });
    refs.searchBox.addEventListener('input', () => { currentPage = 0; renderList(); });

    /* copy all open Kayako ticket URLs/IDs */
    refs.copyOpenTabsBtn?.addEventListener('click', (ev) => {
        const asCsv = !!(ev as MouseEvent).ctrlKey;
        collectOpenKayakoTabs().then(({ urls }) => {
            const text = asCsv ? urls.join(',') : urls.join('\n');
            copyToClipboard(text);
        });
    });
    // Right-click: copy IDs (newline separated)
    refs.copyOpenTabsBtn?.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        collectOpenKayakoTabs().then(({ ids }) => {
            const text = ids.join('\n');
            copyToClipboard(text);
        });
        return false;
    });
});

/* ─ background messages ─ */
chrome.runtime.onMessage.addListener((msg: FromBackground) => {
    switch (msg.action) {
        case 'stats': {
            if (currentTicketId !== msg.ticketId) break;
            refs.lblSubj.textContent    = msg.subject || '-';
            refs.lblName.textContent    = msg.name    || '-';
            refs.lblEmail.textContent   = msg.email   || '-';
            refs.lblReplies.textContent = msg.count.toString();
            refs.txtNotes.value         = msg.notes ?? '';
            break;
        }
        case 'allTickets': {
            Object.assign(allTickets, msg.tickets);
            currentPage = 0;
            renderList();
            break;
        }
    }
});

/* ─ list rendering ─ */
function renderList(): void {
    const term = refs.searchBox.value.trim().toLowerCase();

    const filtered = Object.entries(allTickets)
        .filter(([_, t]) => {
            const inSaved   = t.count > 0;
            const inVisited = t.count === 0;
            if (currentListMode === 'saved' && !inSaved)   return false;
            if (currentListMode === 'visited' && !inVisited) return false;

            /* search filter */
            return !term ||
                _.includes(term) ||
                t.subject.toLowerCase().includes(term) ||
                t.name.toLowerCase().includes(term) ||
                t.email.toLowerCase().includes(term) ||
                (t.notes ?? '').toLowerCase().includes(term);
        })
        .sort((a, b) => (b[1].lastAccess ?? 0) - (a[1].lastAccess ?? 0));   // newest first

    /* paging */
    const pageCount = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
    currentPage = Math.min(currentPage, pageCount - 1);
    const pageItems = filtered.slice(currentPage * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE + ITEMS_PER_PAGE);

    /* list */
    refs.list.textContent = '';
    pageItems.forEach(([id, t]) => {
        const li = document.createElement('li');
        li.style.marginBottom = '.4rem';
        li.innerHTML = `
            <a href="https://central-supportdesk.kayako.com/agent/conversations/${id}"
               target="_blank" style="text-decoration:none"><strong>${id}</strong></a>
            – ${t.subject || '(no subject)'}<br>
            <small>${t.name}&nbsp;&lt;${t.email}&gt;</small>
            <button data-id="${id}" title="Delete" style="margin-left:.5rem;cursor:pointer">🗑</button>
        `;
        li.querySelector('button')!.addEventListener('click', ev => {
            const delId = (ev.currentTarget as HTMLButtonElement).dataset.id!;
            if (!confirm(`Delete ticket ${delId} from storage?`)) return;
            chrome.runtime.sendMessage<ToBackground>({ action: 'deleteTicket', ticketId: delId });
            delete allTickets[delId];
            renderList();
        });
        refs.list.appendChild(li);
    });

    /* pagination controls */
    refs.pager.textContent = '';
    const prev = makePageBtn('Prev', currentPage > 0, () => { currentPage--; renderList(); });
    const next = makePageBtn('Next', currentPage < pageCount - 1, () => { currentPage++; renderList(); });
    refs.pager.appendChild(prev);
    refs.pager.append(` Page ${currentPage + 1} / ${pageCount} `);
    refs.pager.appendChild(next);
}
function makePageBtn(label: string, enabled: boolean, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.disabled = !enabled;
    if (enabled) btn.addEventListener('click', onClick);
    return btn;
}

/* ─ util ─ */
function getCurrentTabTicketId(): Promise<string | null> {
    return new Promise(resolve => {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            const url = tabs[0]?.url ?? '';
            const m = url.match(/\/conversations?\/(\d+)/i);
            resolve(m ? m[1] : null);
        });
    });
}

/* ─ copy open Kayako tabs helpers ─ */
async function collectOpenKayakoTabs(): Promise<{ urls: string[]; ids: string[] }> {
    return new Promise(resolve => {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            const tabId = tabs[0]?.id;
            if (!tabId) return resolve({ urls: [], ids: [] });

            chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    try {
                        const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('[class*=ko-tab-strip_tab__link_]'));
                        const seen = new Set<string>();
                        const urls: string[] = [];
                        const ids: string[] = [];
                        anchors.forEach(a => {
                            const href = a.getAttribute('href') || '';
                            if (!/\/agent\/conversations\//i.test(href)) return;
                            const full = `${location.origin}${href}`;
                            if (seen.has(full)) return;
                            seen.add(full);
                            urls.push(full);
                            const m = href.match(/(\d+)(?:\/?$)/);
                            if (m) ids.push(m[1]);
                        });
                        return { urls, ids };
                    } catch (_e) {
                        return { urls: [], ids: [] };
                    }
                },
            }, (results) => {
                const data = results && results[0] && results[0].result ? results[0].result as { urls: string[]; ids: string[] } : { urls: [], ids: [] };
                resolve(data);
            });
        });
    });
}

function copyToClipboard(text: string): void {
    if (!text) return;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}
function fallbackCopy(text: string): void {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
}

/* ─ helpers for settings ─ */
function toggleDefaultWrapVisibility(remember: boolean): void {
    const wrap = document.getElementById('kh-searchin-defaults-wrap');
    if (!wrap) return;
    wrap.style.display = remember ? 'none' : '';
}

function saveDefaultInSelection(): void {
    const defs: string[] = [];
    if (refs.defConv?.checked)  defs.push('Conversations');
    if (refs.defUsers?.checked) defs.push('Users');
    if (refs.defOrgs?.checked)  defs.push('Organizations');
    if (refs.defArts?.checked)  defs.push('Articles');
    chrome.storage.sync.set({ searchInDefaults: defs });
}
