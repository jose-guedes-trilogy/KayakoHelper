/* Kayako Helper – popup.ts */

import type { ToBackground, FromBackground } from '@/utils/messageTypes';

interface Prefs { trainingMode?: boolean; allStyles?: boolean; sendChunksWPM?: number; }
interface TicketData { count: number; name: string; email: string; subject: string; notes?: string }

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

    /* settings controls */
    chkTraining: document.getElementById('kh-training-mode-checkbox') as HTMLInputElement,
    chkStyles  : document.getElementById('kh-toggle-styles-checkbox') as HTMLInputElement,
    inpWpm     : document.getElementById('kh-send-in-chunks-wpm-limit') as HTMLInputElement,

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
};

/* ─ boot ─ */
document.addEventListener('DOMContentLoaded', () => {
    /* top-level tab bar */
    refs.tabButtons.forEach(btn =>
        btn.addEventListener('click', () => {
            refs.tabButtons.forEach(b => b.classList.toggle('active', b === btn));
            refs.panels.forEach(p => p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
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
    chrome.storage.sync.get(['trainingMode', 'allStyles', 'sendChunksWPM'] as const, res => {
        const { trainingMode, allStyles, sendChunksWPM } = res as Prefs;
        refs.chkTraining.checked = !!trainingMode;
        refs.chkStyles.checked   = allStyles       ?? true;
        refs.inpWpm.value        = (sendChunksWPM ?? 200).toString();
    });

    refs.chkTraining.addEventListener('change', () => {
        const enabled = refs.chkTraining.checked;
        chrome.runtime.sendMessage<ToBackground>({ action: 'setTrainingMode', enabled });
        chrome.storage.sync.set({ trainingMode: enabled });
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
        .sort((a, b) => Number(b[0]) - Number(a[0]));   // newest first

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
