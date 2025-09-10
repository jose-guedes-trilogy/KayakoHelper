/* Kayako Helper – popup.ts */

import type { ToBackground, FromBackground } from '@/utils/messageTypes';
import { TicketData } from '@/background/replyDataBg.ts';
import { sendMessageSafe } from '@/utils/sendMessageSafe';
import { AIHorizonsAPI } from '@/modules/alpha/sis/alphaInfoFetch';
import alphaUiHtml from '@/modules/alpha/sis/alpha-ui.html?raw';

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
    replyFixedHeightEnabled?: boolean;
    replyFixedHeightPx?: number;
    replyRememberLastHeight?: boolean;
    expandNoteWidth?: boolean;
}

/* ─ constants & state ─ */
const ITEMS_PER_PAGE = 20;
let currentPage = 0;
const allTickets: Record<string, TicketData> = {};
let currentTicketId: string | null = null;
let currentListMode: 'saved' | 'visited' | 'bookmarked' = 'saved';
let currentTicketBookmarked = false;

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
    chkExpandNotes: document.getElementById('kh-expand-note-width') as HTMLInputElement,
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

    /* Reply resizer settings */
    chkReplyFixedEnabled: document.getElementById('kh-reply-fixed-height-enabled') as HTMLInputElement,
    inpReplyFixedPx: document.getElementById('kh-reply-fixed-height-px') as HTMLInputElement,
    chkReplyRememberLast: document.getElementById('kh-reply-remember-last-height') as HTMLInputElement,

    /* current ticket read-outs */
    lblId     : document.getElementById('kh-popup-ticket-info-id')       as HTMLElement,
    lblSubj   : document.getElementById('kh-popup-ticket-info-subject')  as HTMLElement,
    lblName   : document.getElementById('kh-popup-ticket-info-requester-name')  as HTMLElement,
    lblEmail  : document.getElementById('kh-popup-ticket-info-requester-email') as HTMLElement,
    lblReplies: document.getElementById('kh-popup-ticket-info-reply-count')     as HTMLElement,
    lblProduct: document.getElementById('kh-popup-ticket-info-product')         as HTMLElement,
    lblLast   : document.getElementById('kh-popup-ticket-info-last')            as HTMLElement,
    txtNotes  : document.getElementById('kh-popup-ticket-notes')         as HTMLTextAreaElement,
    bookmarkToggle: document.getElementById('kh-bookmark-toggle') as HTMLButtonElement,

    /* list & paging */
    listTabButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('#kh-ticket-list-tabs .list-tab')),
    searchBox : document.getElementById('kh-search-tickets')  as HTMLInputElement,
    list      : document.getElementById('kh-ticket-list')     as HTMLUListElement,
    pager     : document.getElementById('kh-pagination')      as HTMLElement,

    ephorToken : document.getElementById('kh-ephor-api-token') as HTMLInputElement,

    /* copy open tabs button */
    copyOpenTabsBtn: document.getElementById('kh-copy-open-tabs-btn') as HTMLButtonElement,
    /* date range filter */
    dateTrigger: document.getElementById('kh-date-range-trigger') as HTMLButtonElement,
    datePicker : document.getElementById('kh-date-range-picker') as HTMLElement,
    dateMonth  : document.getElementById('kh-date-month') as HTMLElement,
    dateGrid   : document.getElementById('kh-date-grid') as HTMLElement,
    datePrev   : document.getElementById('kh-date-prev') as HTMLButtonElement,
    dateNext   : document.getElementById('kh-date-next') as HTMLButtonElement,
    dateApply  : document.getElementById('kh-date-apply') as HTMLButtonElement,
    dateClear  : document.getElementById('kh-date-clear') as HTMLButtonElement,
    dateDisplay: document.getElementById('kh-date-range-display') as HTMLElement,

    /* Alpha SIS tester */
    alphaSearchTerm: document.getElementById('kh-alpha-search-term') as HTMLInputElement,
    alphaSearchPage: document.getElementById('kh-alpha-search-page') as HTMLInputElement,
    alphaSearchPageSize: document.getElementById('kh-alpha-search-page-size') as HTMLInputElement,
    alphaSearchBtn: document.getElementById('kh-alpha-search-btn') as HTMLButtonElement,
    alphaStudentsPage: document.getElementById('kh-alpha-students-page') as HTMLInputElement,
    alphaStudentsPageSize: document.getElementById('kh-alpha-students-page-size') as HTMLInputElement,
    alphaStudentsBtn: document.getElementById('kh-alpha-students-btn') as HTMLButtonElement,
    alphaStaffPage: document.getElementById('kh-alpha-staff-page') as HTMLInputElement,
    alphaStaffPageSize: document.getElementById('kh-alpha-staff-page-size') as HTMLInputElement,
    alphaStaffBtn: document.getElementById('kh-alpha-staff-btn') as HTMLButtonElement,
    alphaOrgsPage: document.getElementById('kh-alpha-orgs-page') as HTMLInputElement,
    alphaOrgsPageSize: document.getElementById('kh-alpha-orgs-page-size') as HTMLInputElement,
    alphaOrgsBtn: document.getElementById('kh-alpha-orgs-btn') as HTMLButtonElement,
    alphaStudentId: document.getElementById('kh-alpha-student-id') as HTMLInputElement,
    alphaProfileBtn: document.getElementById('kh-alpha-profile-btn') as HTMLButtonElement,
    alphaUserFormId: document.getElementById('kh-alpha-userform-id') as HTMLInputElement,
    alphaUserFormBtn: document.getElementById('kh-alpha-userform-btn') as HTMLButtonElement,
    alphaAdmissionId: document.getElementById('kh-alpha-admission-id') as HTMLInputElement,
    alphaAdmissionBtn: document.getElementById('kh-alpha-admission-btn') as HTMLButtonElement,
    // notifications UI is hidden; keep references guarded if present in DOM
    alphaNotifsRecipient: document.getElementById('kh-alpha-notifs-recipient') as HTMLInputElement,
    alphaNotifsBtn: document.getElementById('kh-alpha-notifs-btn') as HTMLButtonElement,
    alphaOutput: document.getElementById('kh-alpha-output') as HTMLElement,
    alphaClearOutput: document.getElementById('kh-alpha-clear-output') as HTMLButtonElement,
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

    /* sub-tabs (Replied to / Visited / Bookmark) */
    refs.listTabButtons.forEach(btn =>
        btn.addEventListener('click', () => {
            refs.listTabButtons.forEach(b => b.classList.toggle('active', b === btn));
            currentListMode = btn.dataset.list as 'saved' | 'visited' | 'bookmarked';
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
        'replyFixedHeightEnabled',
        'replyFixedHeightPx',
        'replyRememberLastHeight',
        'expandNoteWidth',
    ] as const, res => {
        const { trainingMode, allStyles, sendChunksWPM, uiDarkCompat, uiDarkTextColor, uiDarkBgColor, searchInRemember, searchInDefaults, searchResultsAutoUpdate, qcButtonEnabled, qcTemplateOnly, hideMessenger, replyFixedHeightEnabled, replyFixedHeightPx, replyRememberLastHeight, expandNoteWidth } = res as Prefs;
        refs.chkTraining.checked = !!trainingMode;
        if (refs.chkHideMessenger) refs.chkHideMessenger.checked = !!hideMessenger;
        refs.chkStyles.checked   = allStyles       ?? true;
        refs.inpWpm.value        = (sendChunksWPM ?? 200).toString();
        if (refs.chkExpandNotes) refs.chkExpandNotes.checked = !!expandNoteWidth; // default OFF

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

        // Reply resizer settings
        const fixedEnabled = !!replyFixedHeightEnabled && !replyRememberLastHeight; // enforce mutual exclusivity on load
        const fixedPx = Math.max(44, Math.min(1000, Number(replyFixedHeightPx ?? 200)));
        const rememberLast = !!replyRememberLastHeight && !fixedEnabled;
        if (refs.chkReplyFixedEnabled) refs.chkReplyFixedEnabled.checked = fixedEnabled;
        if (refs.inpReplyFixedPx) {
            refs.inpReplyFixedPx.value = String(fixedPx);
            refs.inpReplyFixedPx.disabled = !fixedEnabled;
        }
        if (refs.chkReplyRememberLast) refs.chkReplyRememberLast.checked = rememberLast;
        // If both were true due to old state, normalize storage
        if (replyFixedHeightEnabled && replyRememberLastHeight) {
            chrome.storage.sync.set({ replyRememberLastHeight: false });
        }
    });

    refs.chkTraining.addEventListener('change', () => {
        const enabled = refs.chkTraining.checked;
        sendMessageSafe<ToBackground>({ action: 'setTrainingMode', enabled }, 'popup:setTrainingMode');
        chrome.storage.sync.set({ trainingMode: enabled });
    });
    refs.chkHideMessenger?.addEventListener('change', () => {
        const hide = !!refs.chkHideMessenger.checked;
        try { console.debug('[KH] Setting hideMessenger ->', hide); } catch {}
        chrome.storage.sync.set({ hideMessenger: hide });
    });
    refs.chkStyles.addEventListener('change', () => {
        const enabled = refs.chkStyles.checked;
        sendMessageSafe<ToBackground>({ action: 'setAllStylesEnabled', enabled }, 'popup:setAllStylesEnabled');
        chrome.storage.sync.set({ allStyles: enabled });
    });
    refs.chkExpandNotes?.addEventListener('change', () => {
        const on = !!refs.chkExpandNotes.checked;
        try { console.debug('[KH] Setting expandNoteWidth ->', on); } catch {}
        chrome.storage.sync.set({ expandNoteWidth: on });
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

    /* ------- Reply resizer settings ------- */
    refs.chkReplyFixedEnabled?.addEventListener('change', () => {
        const enabled = !!refs.chkReplyFixedEnabled.checked;
        try { console.debug('[KH][ReplyResizer] fixedHeightEnabled →', enabled); } catch {}
        if (refs.inpReplyFixedPx) refs.inpReplyFixedPx.disabled = !enabled;
        // Mutual exclusivity: turning this on turns off remember-last
        const set: Record<string, unknown> = { replyFixedHeightEnabled: enabled };
        if (enabled && refs.chkReplyRememberLast) {
            refs.chkReplyRememberLast.checked = false;
            set['replyRememberLastHeight'] = false;
        }
        chrome.storage.sync.set(set);
    });
    refs.inpReplyFixedPx?.addEventListener('change', () => {
        let px = Number(refs.inpReplyFixedPx.value) || 200;
        px = Math.max(44, Math.min(1000, px));
        refs.inpReplyFixedPx.value = String(px);
        try { console.debug('[KH][ReplyResizer] fixedHeightPx →', px); } catch {}
        chrome.storage.sync.set({ replyFixedHeightPx: px });
    });
    refs.chkReplyRememberLast?.addEventListener('change', () => {
        const remember = !!refs.chkReplyRememberLast.checked;
        try { console.debug('[KH][ReplyResizer] rememberLastHeight →', remember); } catch {}
        // Mutual exclusivity: turning this on turns off fixed-height
        const set: Record<string, unknown> = { replyRememberLastHeight: remember };
        if (remember && refs.chkReplyFixedEnabled) {
            refs.chkReplyFixedEnabled.checked = false;
            if (refs.inpReplyFixedPx) refs.inpReplyFixedPx.disabled = true;
            set['replyFixedHeightEnabled'] = false;
        }
        chrome.storage.sync.set(set);
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
        sendMessageSafe<ToBackground>({ action: 'getStats', ticketId }, 'popup:getStats');

        // Bookmark toggle wiring
        if (refs.bookmarkToggle) {
            refs.bookmarkToggle.disabled = true; // enabled after stats arrive
            refs.bookmarkToggle.addEventListener('click', () => {
                if (!currentTicketId) return;
                const next = !currentTicketBookmarked;
                sendMessageSafe<ToBackground>({ action: 'setBookmark', ticketId: currentTicketId, bookmarked: next }, 'popup:setBookmark');
                // Optimistic UI update
                currentTicketBookmarked = next;
                updateBookmarkButton(next);
            });
        }

        refs.txtNotes.disabled = false;
        refs.txtNotes.addEventListener('input', () => {
            sendMessageSafe<ToBackground>({
                action: 'saveNotes',
                ticketId,
                notes: refs.txtNotes.value.trim(),
            }, 'popup:saveNotes');
        });
    });

    /* ticket list */
    sendMessageSafe<ToBackground>({ action: 'getAllTickets' }, 'popup:getAllTickets');
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

    /* ------- Alpha SIS: mount UI and wire persistence ------- */
    try {
        initAlphaUi();
    } catch (e) {
        try { console.error('[KH][AlphaSIS] failed to initialize Alpha UI', e); } catch {}
    }

    /* ------- Alpha SIS: load stored role and wire UI ------- */
    const ALPHA_KEY = 'kh-alpha-misc';
    try { console.debug('[KH][AlphaSIS] init: wiring UI and loading stored role'); } catch {}
    // Role UI removed; rely on storage capture or pinned tab acquisition

    refs.alphaClearOutput?.addEventListener('click', () => {
        if (refs.alphaOutput) refs.alphaOutput.textContent = '(no output)';
    });

    // Bind buttons to API calls
    refs.alphaSearchBtn?.addEventListener('click', () => withApi('searchUsers', async (api) => {
        const term = (refs.alphaSearchTerm?.value || '').trim();
        const page = Math.max(1, Number(refs.alphaSearchPage?.value) || 1);
        const size = Math.max(1, Number(refs.alphaSearchPageSize?.value) || 5);
        try { console.debug('[KH][AlphaSIS] searchUsers', { term, page, size }); } catch {}
        const res = await api.searchUsers(term, page, size);
        appendAlphaOutput(res);
    }));

    refs.alphaStudentsBtn?.addEventListener('click', () => withApi('getStudents', async (api) => {
        const page = Math.max(1, Number(refs.alphaStudentsPage?.value) || 1);
        const size = Math.max(1, Number(refs.alphaStudentsPageSize?.value) || 4);
        try { console.debug('[KH][AlphaSIS] getStudents', { page, size }); } catch {}
        const res = await api.getStudents(page, size);
        appendAlphaOutput(res);
    }));

    refs.alphaStaffBtn?.addEventListener('click', () => withApi('getStaff', async (api) => {
        const page = Math.max(1, Number(refs.alphaStaffPage?.value) || 1);
        const size = Math.max(1, Number(refs.alphaStaffPageSize?.value) || 4);
        try { console.debug('[KH][AlphaSIS] getStaff', { page, size }); } catch {}
        const res = await api.getStaff(page, size);
        appendAlphaOutput(res);
    }));

    refs.alphaOrgsBtn?.addEventListener('click', () => withApi('getOrganizations', async (api) => {
        const page = Math.max(1, Number(refs.alphaOrgsPage?.value) || 1);
        const size = Math.max(1, Number(refs.alphaOrgsPageSize?.value) || 4);
        try { console.debug('[KH][AlphaSIS] getOrganizations', { page, size }); } catch {}
        const res = await api.getOrganizations(page, size);
        appendAlphaOutput(res);
    }));

    refs.alphaProfileBtn?.addEventListener('click', () => withApi('getStudentProfile', async (api) => {
        const id = (refs.alphaStudentId?.value || '').trim();
        try { console.debug('[KH][AlphaSIS] getStudentProfile', { id }); } catch {}
        const res = await api.getStudentProfile(id);
        appendAlphaOutput(res);
    }));

    refs.alphaUserFormBtn?.addEventListener('click', () => withApi('getUserForm', async (api) => {
        const id = (refs.alphaUserFormId?.value || '').trim();
        try { console.debug('[KH][AlphaSIS] getUserForm', { id }); } catch {}
        const res = await api.getUserForm(id);
        appendAlphaOutput(res);
    }));

    refs.alphaAdmissionBtn?.addEventListener('click', () => withApi('getAdmissionProcessStep', async (api) => {
        const id = (refs.alphaAdmissionId?.value || '').trim();
        try { console.debug('[KH][AlphaSIS] getAdmissionProcessStep', { id }); } catch {}
        const res = await api.getAdmissionProcessStep(id);
        appendAlphaOutput(res);
    }));

    refs.alphaNotifsBtn?.addEventListener('click', () => withApi('getNotifications', async (api) => {
        const id = (refs.alphaNotifsRecipient?.value || '').trim();
        try { console.debug('[KH][AlphaSIS] getNotifications', { id }); } catch {}
        const res = await api.getNotifications(id);
        appendAlphaOutput(res);
    }));
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
            if (refs.lblProduct) refs.lblProduct.textContent = (msg as any).product || '-';
            if (refs.lblLast) refs.lblLast.textContent = (msg as any).lastAccess ? formatDate(new Date((msg as any).lastAccess)) : '-';
            // Bookmark UI setup
            currentTicketBookmarked = !!(msg as any).bookmarked;
            updateBookmarkButton(currentTicketBookmarked);
            if (refs.bookmarkToggle) refs.bookmarkToggle.disabled = false;
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
            const isBookmarked = !!(t as any).bookmarked;
            if (currentListMode === 'saved' && !inSaved)   return false;
            if (currentListMode === 'visited' && !inVisited) return false;
            if (currentListMode === 'bookmarked' && !isBookmarked) return false;

            /* search filter */
            const searchOk = (!term ||
                _.includes(term) ||
                (t.subject || '').toLowerCase().includes(term) ||
                (t.name || '').toLowerCase().includes(term) ||
                (t.email || '').toLowerCase().includes(term) ||
                (t.notes ?? '').toLowerCase().includes(term) ||
                (t as any).product?.toLowerCase?.().includes(term));

            if (!searchOk) return false;

            /* date range filter */
            if (dateState.start || dateState.end) {
                const ts = t.lastAccess || 0;
                if (!ts) return false;
                const d = startOfDay(new Date(ts)).getTime();
                if (dateState.start && d < startOfDay(dateState.start).getTime()) return false;
                if (dateState.end && d > startOfDay(dateState.end).getTime()) return false;
            }
            return true;
        })
        .sort((a, b) => (b[1].lastAccess ?? 0) - (a[1].lastAccess ?? 0));   // newest first

    /* paging */
    const pageCount = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
    try { console.debug('[KH] popup.renderList', {
        mode: currentListMode,
        term,
        dateStart: dateState.start ? dateState.start.toISOString() : null,
        dateEnd: dateState.end ? dateState.end.toISOString() : null,
        total: Object.keys(allTickets).length,
        filtered: filtered.length,
        page: currentPage + 1,
        pageCount,
    }); } catch {}
    currentPage = Math.min(currentPage, pageCount - 1);
    const pageItems = filtered.slice(currentPage * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE + ITEMS_PER_PAGE);

    /* list */
    refs.list.textContent = '';
    pageItems.forEach(([id, t]) => {
        const li = document.createElement('li');
        li.className = 'kh-ticket-item';
        const product = (t as any).product || '';
        const dateTxt = t.lastAccess ? formatDate(new Date(t.lastAccess)) : '';
        li.innerHTML = `
            <div class="kh-item-row">
                <div class="kh-item-main">
                    <a href="https://central-supportdesk.kayako.com/agent/conversations/${id}" target="_blank" style="text-decoration:none"><strong>${id}</strong></a>
                    <span class="kh-item-subject">– ${t.subject || '(no subject)'}</span>
                </div>
                <button class="kh-delete-btn" data-id="${id}" title="Delete">×</button>
            </div>
            <div class="kh-item-meta">
                <span class="kh-badge">${product || '-'}</span>
                <span class="kh-date">${dateTxt || '-'}</span>
                <small>${t.name || ''}&nbsp;&lt;${t.email || ''}&gt;</small>
            </div>
        `;
        li.querySelector('.kh-delete-btn')!.addEventListener('click', ev => {
            const delId = (ev.currentTarget as HTMLButtonElement).dataset.id!;
            if (!confirm(`Delete ticket ${delId} from storage?`)) return;
            try { console.debug('[KH] popup.deleteTicket', { ticketId: delId }); } catch {}
            sendMessageSafe<ToBackground>({ action: 'deleteTicket', ticketId: delId }, 'popup:deleteTicket');
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
function updateBookmarkButton(isBookmarked: boolean): void {
    const btn = refs.bookmarkToggle;
    if (!btn) return;
    if (isBookmarked) {
        btn.textContent = '★ Bookmarked';
        btn.title = 'Click to remove bookmark';
        btn.classList.add('kh-btn-primary');
    } else {
        btn.textContent = '☆ Bookmark this ticket';
        btn.title = 'Bookmark this ticket';
        btn.classList.remove('kh-btn-primary');
    }
}

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

/* ─ Alpha SIS helpers ─ */
function initAlphaUi(): void {
    const root = document.getElementById('kh-alpha-ui-root');
    if (!root) return;
    try { console.debug('[KH][AlphaSIS] Mounting Alpha UI template into popup'); } catch {}
    try {
        root.innerHTML = alphaUiHtml;
    } catch (e) {
        try { console.error('[KH][AlphaSIS] Failed to inject alpha-ui.html', e); } catch {}
        return;
    }

    restoreAlphaUiState(root).then(() => {
        try { console.debug('[KH][AlphaSIS] Restored Alpha UI state'); } catch {}
    }).catch(err => {
        try { console.warn('[KH][AlphaSIS] Could not restore Alpha UI state', err); } catch {}
    });
    wireAlphaUiPersistence(root);
}

type AlphaFieldValue = string | number | boolean | null;
type AlphaUiState = Record<string, AlphaFieldValue>;

function makeAlphaFieldKey(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, index: number): string {
    const id = el.getAttribute('id');
    const name = el.getAttribute('name');
    const type = (el as HTMLInputElement).type || el.tagName.toLowerCase();
    const base = id || name || `${el.tagName.toLowerCase()}[${type}]`;
    return `${base}#${index}`;
}

function readAlphaFieldValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): AlphaFieldValue {
    if (el instanceof HTMLInputElement) {
        if (el.type === 'checkbox') return !!el.checked;
        if (el.type === 'radio') return !!el.checked;
        if (el.type === 'number') {
            const n = Number(el.value);
            return Number.isFinite(n) ? n : null;
        }
        if (el.type === 'file') return null; // skip files
        return el.value;
    }
    if (el instanceof HTMLSelectElement) return el.value;
    return (el as HTMLTextAreaElement).value;
}

function writeAlphaFieldValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, v: AlphaFieldValue): void {
    if (el instanceof HTMLInputElement) {
        if (el.type === 'checkbox' || el.type === 'radio') {
            el.checked = !!v;
            return;
        }
        if (el.type === 'number') {
            if (typeof v === 'number') el.value = String(v);
            else if (typeof v === 'string') el.value = v;
            return;
        }
        if (el.type === 'file') return; // cannot restore
        if (v == null) return;
        el.value = String(v);
        return;
    }
    if (el instanceof HTMLSelectElement) {
        if (v != null) el.value = String(v);
        return;
    }
    (el as HTMLTextAreaElement).value = v == null ? '' : String(v);
}

function collectAlphaUiState(root: HTMLElement): AlphaUiState {
    const state: AlphaUiState = {};
    const fields = root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select');
    fields.forEach((el, idx) => {
        const key = makeAlphaFieldKey(el, idx);
        const value = readAlphaFieldValue(el);
        state[key] = value;
    });
    return state;
}

async function restoreAlphaUiState(root: HTMLElement): Promise<void> {
    return new Promise(resolve => {
        const STORAGE_KEY = 'kh-alpha-ui-state';
        chrome.storage.local.get(STORAGE_KEY, raw => {
            const stored = (raw && raw[STORAGE_KEY]) as AlphaUiState | undefined;
            if (!stored) return resolve();
            const fields = root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select');
            fields.forEach((el, idx) => {
                const key = makeAlphaFieldKey(el, idx);
                if (Object.prototype.hasOwnProperty.call(stored, key)) {
                    writeAlphaFieldValue(el, stored[key]);
                }
            });
            resolve();
        });
    });
}

function wireAlphaUiPersistence(root: HTMLElement): void {
    const STORAGE_KEY = 'kh-alpha-ui-state';
    const save = () => {
        const state = collectAlphaUiState(root);
        try { console.debug('[KH][AlphaSIS] Persisting Alpha UI state', { keys: Object.keys(state).length }); } catch {}
        chrome.storage.local.set({ [STORAGE_KEY]: state });
    };
    const fields = root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select');
    fields.forEach(el => {
        el.addEventListener('change', save);
        el.addEventListener('input', save);
    });
}

function getAlphaRole(): Promise<string> {
    return new Promise(resolve => {
        const ALPHA_KEY = 'kh-alpha-misc';
        // Try sync first (captured from aihorizons), then local fallback
        chrome.storage.sync.get('aih_customSisRole', syncRes => {
            const syncRole = (syncRes?.aih_customSisRole || '').trim();
            if (syncRole) return resolve(syncRole);
            chrome.storage.local.get(ALPHA_KEY, raw => {
                const role = raw[ALPHA_KEY]?.role ?? '';
                resolve(typeof role === 'string' ? role : '');
            });
        });
    });
}

async function withApi(label: string, fn: (api: AIHorizonsAPI) => Promise<void>): Promise<void> {
    let role = (refs.alphaRole?.value || '').trim() || await getAlphaRole();
    if (!role) {
        // Attempt to acquire role via a pinned aihorizons.school tab
        appendAlphaOutput('Missing role. Attempting to acquire from aihorizons.school…');
        try { console.debug('[KH][AlphaSIS] role missing; attempting pinned-tab acquisition'); } catch {}
        role = await tryAcquireAlphaRoleViaPinnedTab();
        if (role) {
            if (refs.alphaRole) refs.alphaRole.value = role;
            try { chrome.storage.sync.set({ aih_customSisRole: role }); } catch {}
            appendAlphaOutput('Acquired role from aihorizons.school.');
        }
    }
    if (!role) {
        const msg = '[AlphaSIS] Missing custom SIS role. Please open aihorizons.school and sign in.';
        try { console.warn('[KH]' + msg); } catch {}
        appendAlphaOutput(msg);
        return;
    }
    try {
        const api = new AIHorizonsAPI(role);
        await fn(api);
    } catch (err: any) {
        try { console.error('[KH][AlphaSIS] API error in ' + label, err); } catch {}
        appendAlphaOutput({ error: String(err?.message || err) });
    }
}

function appendAlphaOutput(data: unknown): void {
    if (!refs.alphaOutput) return;
    const now = new Date();
    const ts = now.toLocaleTimeString();
    const text = typeof data === 'string' ? data : safeStringify(data);
    const line = `[${ts}] ${text}`;
    refs.alphaOutput.textContent = (refs.alphaOutput.textContent && refs.alphaOutput.textContent !== '(no output)')
        ? refs.alphaOutput.textContent + '\n' + line
        : line;
}

function safeStringify(obj: unknown): string {
    try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
}

// Try to retrieve role by opening (or reusing) a pinned aihorizons.school tab and closing it if we opened it
async function tryAcquireAlphaRoleViaPinnedTab(): Promise<string> {
    const AIH_URL = 'https://aihorizons.school/';
    const roleFromResults = (results?: chrome.scripting.InjectionResult[] | void): string => {
        try {
            const r = results && results[0] && (results[0] as any).result;
            return typeof r === 'string' ? r : '';
        } catch { return ''; }
    };

    const executeGetRole = (tabId: number): Promise<string> => new Promise(resolve => {
        try {
            chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    try { return localStorage.getItem('currentUserRole') || ''; } catch { return ''; }
                },
            }, (res) => resolve(roleFromResults(res)));
        } catch { resolve(''); }
    });

    const waitForComplete = (tabId: number): Promise<void> => new Promise(resolve => {
        try {
            chrome.tabs.get(tabId, (t) => {
                if (!t || t.status === 'complete') return resolve();
                const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
                    if (updatedTabId === tabId && info.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        resolve();
                    }
                };
                chrome.tabs.onUpdated.addListener(listener);
            });
        } catch { resolve(); }
    });

    const getFromExisting = (): Promise<string> => new Promise(resolve => {
        try {
            chrome.tabs.query({ url: 'https://aihorizons.school/*' }, async (tabs) => {
                const tab = tabs && tabs[0];
                if (!tab?.id) return resolve('');
                const r = await executeGetRole(tab.id);
                return resolve(r);
            });
        } catch { resolve(''); }
    });

    // 1) Try existing tab first
    let role = await getFromExisting();
    if (role) {
        try { console.debug('[KH][AlphaSIS] acquired role from existing aihorizons tab'); } catch {}
        return role;
    }

    // 2) Open a pinned tab, wait complete, read role, then close the tab
    return new Promise(resolve => {
        try {
            chrome.tabs.create({ url: AIH_URL, active: false, pinned: true }, async (tab) => {
                const createdId = tab?.id;
                if (!createdId) return resolve('');
                try { console.debug('[KH][AlphaSIS] created pinned tab to acquire role', { tabId: createdId }); } catch {}
                await waitForComplete(createdId);
                // give the content script a brief moment
                await new Promise(r => setTimeout(r, 250));
                const r = await executeGetRole(createdId);
                // Close the tab we opened
                try { chrome.tabs.remove(createdId); } catch {}
                resolve(r || '');
            });
        } catch { resolve(''); }
    });
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

/* ─ date range picker state + helpers ─ */
type DateState = { monthCursor: Date; start: Date | null; end: Date | null; tempStart: Date | null; tempEnd: Date | null };
const dateState: DateState = {
    monthCursor: startOfMonth(new Date()),
    start: null,
    end: null,
    tempStart: null,
    tempEnd: null,
};

function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function startOfDay(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function isSameDay(a: Date, b: Date): boolean { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function addMonths(d: Date, n: number): Date { const nd = new Date(d); nd.setMonth(nd.getMonth()+n); return startOfMonth(nd); }
function formatMonth(d: Date): string { return d.toLocaleString(undefined, { month: 'long', year: 'numeric' }); }
function formatDate(d: Date): string { return d.toLocaleDateString(); }

function openDatePicker(): void {
    if (!refs.datePicker) return;
    refs.datePicker.style.display = 'block';
    dateState.tempStart = dateState.start;
    dateState.tempEnd = dateState.end;
    renderCalendar();
    try { console.debug('[KH] popup.datePicker.open'); } catch {}
}
function closeDatePicker(): void { if (refs.datePicker) refs.datePicker.style.display = 'none'; }

function renderCalendar(): void {
    if (!refs.dateGrid || !refs.dateMonth) return;
    const first = startOfMonth(dateState.monthCursor);
    const last = endOfMonth(dateState.monthCursor);
    const firstWeekday = new Date(first).getDay();
    refs.dateMonth.textContent = formatMonth(first);

    const daysInMonth = last.getDate();
    const weekdays = ['Su','Mo','Tu','We','Th','Fr','Sa'];
    const cells: string[] = [];
    // header row
    cells.push(...weekdays.map(w => `<div class="kh-date-weekday">${w}</div>`));
    // blank leading cells
    for (let i=0;i<firstWeekday;i++) cells.push('<div></div>');
    for (let day=1; day<=daysInMonth; day++) {
        const cur = new Date(first.getFullYear(), first.getMonth(), day);
        const inRange = dateState.tempStart && dateState.tempEnd && cur >= startOfDay(dateState.tempStart) && cur <= startOfDay(dateState.tempEnd);
        const selected = (dateState.tempStart && isSameDay(cur, dateState.tempStart)) || (dateState.tempEnd && isSameDay(cur, dateState.tempEnd));
        const cls = `kh-date-cell${inRange ? ' kh-in-range' : ''}${selected ? ' kh-selected' : ''}`;
        cells.push(`<div class="${cls}" data-day="${day}">${day}</div>`);
    }
    refs.dateGrid.innerHTML = cells.join('');

    refs.dateGrid.querySelectorAll<HTMLElement>('.kh-date-cell[data-day]').forEach(cell => {
        cell.addEventListener('click', () => {
            const day = Number(cell.dataset.day);
            const clicked = new Date(first.getFullYear(), first.getMonth(), day);
            if (!dateState.tempStart || (dateState.tempStart && dateState.tempEnd)) {
                dateState.tempStart = clicked;
                dateState.tempEnd = null;
            } else if (clicked < dateState.tempStart) {
                dateState.tempEnd = dateState.tempStart;
                dateState.tempStart = clicked;
            } else {
                dateState.tempEnd = clicked;
            }
            renderCalendar();
        });
    });
}

function syncDateDisplay(): void {
    if (!refs.dateDisplay) return;
    if (dateState.start && dateState.end) {
        refs.dateDisplay.textContent = `${formatDate(dateState.start)} – ${formatDate(dateState.end)}`;
    } else if (dateState.start) {
        refs.dateDisplay.textContent = `${formatDate(dateState.start)} – …`;
    } else {
        refs.dateDisplay.textContent = 'All dates';
    }
}

// Wire up picker controls
refs.dateTrigger?.addEventListener('click', (e) => {
    if (!refs.datePicker) return;
    e.stopPropagation();
    const visible = refs.datePicker.style.display === 'block';
    if (visible) { closeDatePicker(); try { console.debug('[KH] popup.datePicker.toggle', { open: false }); } catch {} }
    else { openDatePicker(); try { console.debug('[KH] popup.datePicker.toggle', { open: true }); } catch {} }
});
refs.datePrev?.addEventListener('click', (e) => { e.stopPropagation(); dateState.monthCursor = addMonths(dateState.monthCursor, -1); renderCalendar(); try { console.debug('[KH] popup.datePicker.prev', { month: dateState.monthCursor }); } catch {} });
refs.dateNext?.addEventListener('click', (e) => { e.stopPropagation(); dateState.monthCursor = addMonths(dateState.monthCursor, +1); renderCalendar(); try { console.debug('[KH] popup.datePicker.next', { month: dateState.monthCursor }); } catch {} });
refs.dateClear?.addEventListener('click', (e) => {
    e.stopPropagation();
    dateState.start = null; dateState.end = null; dateState.tempStart = null; dateState.tempEnd = null; syncDateDisplay(); renderList(); closeDatePicker();
    try { console.debug('[KH] popup.datePicker.clear'); } catch {}
});
refs.dateApply?.addEventListener('click', (e) => {
    e.stopPropagation();
    dateState.start = dateState.tempStart; dateState.end = dateState.tempEnd; syncDateDisplay(); renderList(); closeDatePicker();
    try { console.debug('[KH] popup.datePicker.apply', { start: dateState.start, end: dateState.end }); } catch {}
});

// Close calendar when clicking outside
document.addEventListener('click', (e) => {
    const target = e.target as Node;
    if (!refs.datePicker || !refs.dateTrigger) return;
    // Keep open when clicking inside picker
    if (refs.datePicker.contains(target) || refs.dateTrigger.contains(target)) return;
    closeDatePicker();
});

// Prevent immediate close when interacting inside picker
refs.datePicker?.addEventListener('click', (e) => { e.stopPropagation(); });
