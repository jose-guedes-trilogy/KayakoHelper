/* ===========================================================================
 * src/modules/export-chat/exportChatButton.ts
 *
 * Export-chat button – v2.4.0 (2025-06-26)
 *  • Uses tabButtonManager.registerSplitTabButton for native two-part UI
 *  • Keeps all original settings-modal logic intact
 *  • Removes legacy split-button helper and dangling code fragment
 * ---------------------------------------------------------------------------
 */

import { EXTENSION_SELECTORS as sel }      from '@/generated/selectors';
import { fetchTranscript }                 from '@/utils/api.js';
import { isConvPage, currentConvId }        from '@/utils/location.js';
import {
    loadStore, saveStore,
    findProvider, findUrl,
    UrlEntry, Store,
} from '@/utils/providerStore';
import {
    registerSplitTabButton,
    SplitTabButtonConfig,
} from '@/utils/tabButtonManager';

/* ────────────────────────────────────────────────────────────────────────── */

const BTN_ID        = 'exportChatButton';
const MENU_BTN_ID   = 'exportChatButton__menu';
const ICON          = { idle: '📤', work: '⏳', ok: '✅', err: '❌' } as const;
type  UiState       = keyof typeof ICON;

const RESET_MS      = 2_000;
const HIDE_DELAY_MS = 120;        // “safety margin”
const PLACEHOLDERS  = {
    URL       : '@#URL#@',
    ID        : '@#ID#@',
    TRANSCRIPT: '@#TRANSCRIPT#@',
    TRASNCRIPT: '@#TRASNCRIPT#@',
} as const;

const BLANK_PROMPT = `${PLACEHOLDERS.TRANSCRIPT}\n`;
type  ExportMode   = 'new-tab' | 'active-tab';

/* ────────────────────────────────────────────────────────────────────────── */

let uiState: UiState   = 'idle';
let store  : Store;
let currentConv: string | null = null;

/* helper: default providers that support prompt insertion */
const DEFAULT_INSERTER_PROVIDERS = new Set(['chatgpt', 'gemini', 'ephor']);

const DEFAULT_PROVIDERS: Store['providers'] = [
    {
        id: 'chatgpt',
        name: 'ChatGPT',
        multi: false,
        defaultUrlId: 'chatgpt-0',
        urls: [
            {
                id: 'chatgpt-0',
                label: 'ChatGPT',
                url: 'https://chat.openai.com/',
                prompt: BLANK_PROMPT,
                supportsInsertion: true,
            },
        ],
    },
    {
        id: 'gemini',
        name: 'Gemini',
        multi: false,
        defaultUrlId: 'gemini-0',
        urls: [
            {
                id: 'gemini-0',
                label: 'Gemini',
                url: 'https://gemini.google.com/app',
                prompt: BLANK_PROMPT,
                supportsInsertion: true,
            },
        ],
    },
    {
        id: 'ephor',
        name: 'Ephor',
        multi: false,
        defaultUrlId: 'ephor-0',
        urls: [
            {
                id: 'ephor-0',
                label: 'Ephor',
                url: 'https://ephor.ai/',
                prompt: BLANK_PROMPT,
                supportsInsertion: true,
            },
        ],
    },
];

/* ------------------------------------------------------------------ */
/* helpers – unchanged                                                */
/* ------------------------------------------------------------------ */

async function ensureDefaultProviders(): Promise<void> {
    if (store.providers.length === 0) {
        store.providers = structuredClone(DEFAULT_PROVIDERS);
        store.mainDefaultProviderId = 'chatgpt';
        await saveStore(store);
    }
}

/** ensure a provider with a single URL always has that one as default */
function autoSetDefaultUrl(p: Store['providers'][number]): void {
    if (p.urls.length === 1) p.defaultUrlId = p.urls[0].id;
}

function providerSignature(): string {
    return JSON.stringify(
        store.providers.map(p => ({
            id   : p.id,
            def  : p.defaultUrlId,
            urls : p.urls.map(u => u.id),
        })),
    );
}

let lastMenuSig = '';

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

export async function bootExportChatButton(): Promise<void> {
    store = await loadStore();
    await ensureDefaultProviders();

    if (!store.mainDefaultProviderId ||
        !findProvider(store, store.mainDefaultProviderId)) {
        store.mainDefaultProviderId = store.providers[0]?.id ?? null;
        await saveStore(store);
    }

    /* ---------- UI helpers ---------- */
    const label = (): string =>
        uiState === 'idle' ? `${ICON.idle} Export`
            : uiState === 'work' ? `${ICON.work} Working…`
                : uiState === 'ok'   ? `${ICON.ok} Done`
                    : `${ICON.err} Failed`;

    /* ---------- split-button registration ---------- */
    const cfg: SplitTabButtonConfig = {
        id        : BTN_ID,
        rightId   : MENU_BTN_ID,
        rightLabel: '▾',
        label,
        routeTest : isConvPage,
        onClick   : () => {
            const url = mainDefaultUrl();
            if (!url) return alert('Please configure a default URL first.');
            void performExport(url);
        },
        onContextMenu: () => openSettingsModal(),
        onRouteChange: (btn) => {
            if (!btn) {
                currentConv = null;
                lastMenuSig = '';
                return;
            }
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

/* keep exported helper for external callers */
export function setState(state: UiState, el?: HTMLElement | null): void {
    uiState = state;
    (el ?? document.getElementById(BTN_ID))!.textContent =
        (state === 'idle' ? ICON.idle + ' Export'
            : state === 'work' ? ICON.work + ' Working…'
                : state === 'ok' ? ICON.ok   + ' Done'
                    : ICON.err   + ' Failed');
}

/* ---------- local helpers ---------- */
function mainDefaultUrl(): UrlEntry | undefined {
    const prov = findProvider(store, store.mainDefaultProviderId ?? '');
    return prov ? findUrl(prov, prov.defaultUrlId) ?? prov.urls[0] : undefined;
}

/* ───────────────────────── dropdown build ────────────────────────── */

function rebuildDropdown(menu: HTMLElement): void {
    /* -------- early-exit: nothing changed, skip DOM work -------- */
    const sig = providerSignature();
    if (sig === lastMenuSig) return;
    lastMenuSig = sig;
    /* ------------------------------------------------------------- */

    menu.textContent = '';     // rebuild only when necessary

    const div = (cls: string) => { const d = document.createElement('div'); d.className = cls; return d; };

    for (const p of store.providers) {
        const row = div(sel.twoPartBtnDropdownItem.slice(1));
        row.textContent = `${p.name} ▸`;
        menu.appendChild(row);

        const sub = div(sel.twoPartBtnDropdownSub.slice(1));
        sub.style.top = '0';
        row.appendChild(sub);

        const dflt = findUrl(p, p.defaultUrlId) ?? p.urls[0];
        row.addEventListener('click', e => {
            if ((e as MouseEvent).offsetX < row.offsetWidth - 16 && dflt)
                void performExport(dflt);
        });

        row.addEventListener('mouseenter', () => (sub.style.display = 'block'));
        row.addEventListener('mouseleave', () => (sub.style.display = 'none'));

        for (const u of p.urls) {
            const li = div(sel.twoPartBtnDropdownItem.slice(1));
            li.textContent = u.label;
            li.addEventListener('click', () => void performExport(u));
            sub.appendChild(li);
        }
    }
}

/* ───────────────────────── export logic ─────────────────────────── */

async function performExport(urlEntry: UrlEntry): Promise<void> {
    const btn = document.getElementById(BTN_ID)! as HTMLButtonElement;
    setState('work', btn);

    try {
        const transcript = await fetchTranscript(1_000);
        const prompt     = fill(urlEntry.prompt || BLANK_PROMPT, transcript);
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
    } finally { setTimeout(() => setState('idle'), RESET_MS); }
}

function fill(tpl: string, transcript: string): string {
    return tpl.replaceAll(PLACEHOLDERS.TRANSCRIPT, transcript)
        .replaceAll(PLACEHOLDERS.TRASNCRIPT, transcript)
        .replaceAll(PLACEHOLDERS.URL, location.href)
        .replaceAll(PLACEHOLDERS.ID,  currentConvId() ?? '');
}

async function openViaBg(url: string, prompt: string, mode: ExportMode): Promise<void> {
    const res = await chrome.runtime.sendMessage({
        action : 'exportChat.export',
        url, prompt, mode,
    });
    if (res !== 'ok') throw new Error(typeof res === 'string' ? res : 'background error');
}

/* ───────────────────────── settings modal  ───────────────────────── */

function openSettingsModal(): void {
    if (document.querySelector(sel.exportSettingsModal)) return;

    const modal = document.createElement('div');
    modal.id = sel.exportSettingsModal.slice(1);
    modal.style.padding = '10px';
    modal.innerHTML = /* html */`
        <div class="kh-exp-header" style="display:flex;align-items:center;gap:12px;">
          <h2 style="margin:0;font-size:16px;">Export chat – settings</h2>
          <button id="${sel.exportSettingsClose.slice(1)}" class="kh-exp-close-btn"
                  style="margin-left:auto;font-size:18px;line-height:1;">✕</button>
        </div>

        <p class="kh-exp-intro" style="margin:12px 0;">
          Providers and their URLs can be reordered via drag-and-drop (live preview).<br>
          “New / Active tab” can now be chosen per-URL below.
        </p>

        <div class="${sel.noActiveTabNotice.slice(1)}" style="display:none;color:#c33;font-size:11px;">
          No active tab detected – selecting “Active tab” will behave like “New tab”.
        </div>

        <div id="${sel.exportSettingsContent.slice(1)}"></div>

        <div class="kh-exp-footer" style="margin-top:16px;text-align:right;">
          <button id="${sel.exportAddProviderBtn.slice(1)}">➕ Add provider</button>
        </div>
    `;
    document.body.appendChild(modal);

    /* close */
    modal.querySelector<HTMLButtonElement>(sel.exportSettingsClose)!
        .addEventListener('click', () => modal.remove());

    /* drag-move – draggable only on the modal itself (border/padding area) */
    let dx=0, dy=0;
    modal.addEventListener('mousedown', e => {
        if (e.target !== modal) return;
        dx = e.clientX - modal.offsetLeft;
        dy = e.clientY - modal.offsetTop;
        const move = (ev: MouseEvent) => {
            modal.style.left = ev.clientX - dx + 'px';
            modal.style.top  = ev.clientY - dy + 'px';
        };
        const up   = () => {
            window.removeEventListener('mousemove',move);
            window.removeEventListener('mouseup',up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    });

    /* render provider list */
    rebuildSettingsUi(modal.querySelector(sel.exportSettingsContent)! as HTMLElement);

    /* add-provider */
    modal.querySelector<HTMLButtonElement>(sel.exportAddProviderBtn)!
        .addEventListener('click', () => {
            const name = prompt('Provider name?'); if (!name?.trim()) return;
            const id   = `${name.toLowerCase().replace(/\s+/g,'-')}-${crypto.randomUUID().slice(0,4)}`;
            store.providers.push({ id, name, multi:true, urls: [], defaultUrlId: null });
            saveStore(store).then(() =>
                rebuildSettingsUi(modal.querySelector(sel.exportSettingsContent)! as HTMLElement));
        });

    /* ask background if an active tab exists → update tiny notice */
    chrome.runtime.sendMessage({ action: 'exportChat.getStatus' },
        (res: {active:boolean}) => {
            if (!res?.active)
                modal.querySelector(sel.noActiveTabNotice)!.setAttribute('style','');
        });
}

/* ───────────────────────── settings UI (re)build ───────────────────────── */

function rebuildSettingsUi(target: HTMLElement): void {
    target.textContent = '';

    if (store.providers.length === 0) {
        const empty = document.createElement('p');
        empty.style.cssText = 'color:#666;font-size:13px;';
        empty.textContent = 'No providers configured yet. Use “➕ Add provider”.';
        target.appendChild(empty);
        return;
    }

    const h = (html: string) => {
        const tpl = document.createElement('template');
        tpl.innerHTML = html.trim();
        return tpl.content.firstElementChild as HTMLElement;
    };

    /* ----- provider drag-and-drop helpers ----- */
    let dragProvId: string | null = null;
    let dragProvEl: HTMLElement | null = null;

    const onProvDragStart = (ev: DragEvent, id: string, el: HTMLElement) => {
        dragProvId = id;
        dragProvEl = el;
        dragProvEl.classList.add('kh-dragging');
        (ev.dataTransfer as DataTransfer).effectAllowed = 'move';
    };
    const onProvDragEnd = () => {
        dragProvEl?.classList.remove('kh-dragging');
        dragProvId = dragProvEl = null;
    };
    const moveProvPreview = (targetEl: HTMLElement, before: boolean) => {
        if (!dragProvEl || dragProvEl === targetEl) return;
        const parent = targetEl.parentElement!;
        if (before) parent.insertBefore(dragProvEl, targetEl);
        else        parent.insertBefore(dragProvEl, targetEl.nextSibling);
    };
    const commitProvOrder = () => {
        const order: string[] = Array.from(target.children)
            .map(el => (el as HTMLElement).dataset.provId!);
        store.providers.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
        saveStore(store);
    };

    /* iterate providers */
    for (const p of store.providers) {
        /* ─ provider wrapper ─ */
        const wrap = h(`<div class="${sel.exportProviderWrapper.slice(1)}" draggable="true"></div>`);
        wrap.dataset.provId = p.id;
        target.appendChild(wrap);

        /* live preview on drag-over */
        wrap.addEventListener('dragover', ev => {
            ev.preventDefault();
            if (dragProvId) {
                const rect = wrap.getBoundingClientRect();
                const before = ev.clientY < rect.top + rect.height / 2;
                moveProvPreview(wrap, before);
            }
        });

        wrap.addEventListener('dragstart', ev => onProvDragStart(ev, p.id, wrap));
        wrap.addEventListener('dragend',   () => { onProvDragEnd(); commitProvOrder(); });

        /* header */
        wrap.appendChild(h(/* html */`
      <div class="kh-exp-provider-head" style="display:flex;align-items:center;gap:8px;">
        <strong>${p.name}</strong>
        <em style="font-size:11px;">multi-URL</em>
        <button class="${sel.exportAddUrlBtn.slice(1)}">➕ Add URL</button>
        ${DEFAULT_INSERTER_PROVIDERS.has(p.id) ? '' :
            `<button class="${sel.exportDelProvBtn.slice(1)}">🗑</button>`}
        <label style="margin-left:auto;font-size:11px;font-weight:normal;">
          Default&nbsp;for&nbsp;main&nbsp;button
          <input type="radio" name="exp-main-default">
        </label>
      </div>`));

        /* url-list container */
        const urlList = h(`<div class="${sel.exportUrlList.slice(1)}"></div>`);
        wrap.appendChild(urlList);

        /* header-level handlers */
        wrap.querySelector<HTMLInputElement>('input[name="exp-main-default"]')!.checked =
            p.id === store.mainDefaultProviderId;

        wrap.querySelector<HTMLInputElement>('input[name="exp-main-default"]')!
            .addEventListener('change', () => {
                store.mainDefaultProviderId = p.id;
                saveStore(store);
            });

        const delProvBtn = wrap.querySelector<HTMLButtonElement>(sel.exportDelProvBtn);
        if (delProvBtn) {
            delProvBtn.addEventListener('click', () => {
                if (!confirm('Delete provider and all its URLs?')) return;
                store.providers = store.providers.filter(x => x.id !== p.id);
                if (store.mainDefaultProviderId === p.id) store.mainDefaultProviderId = null;
                saveStore(store).then(() => rebuildSettingsUi(target));
            });
        }

        /* add-URL */
        wrap.querySelector<HTMLButtonElement>(sel.exportAddUrlBtn)!
            .addEventListener('click', () => {
                const label = prompt('Label?'); if (!label) return;
                const url   = prompt('URL?');   if (!url)   return;
                const newEntry: UrlEntry = {
                    id: crypto.randomUUID(),
                    label, url,
                    prompt: BLANK_PROMPT,
                    supportsInsertion: DEFAULT_INSERTER_PROVIDERS.has(p.id),
                    mode: 'new-tab',
                };
                p.urls.push(newEntry);
                autoSetDefaultUrl(p);
                saveStore(store).then(() => rebuildSettingsUi(target));
            });

        /* ----- URL drag-and-drop helpers (per-provider) ----- */
        let dragUrlId: string | null = null;
        let dragUrlEl: HTMLElement | null = null;

        const onUrlDragStart = (ev: DragEvent, id: string, el: HTMLElement) => {
            dragUrlId = id;
            dragUrlEl = el;
            dragUrlEl.classList.add('kh-dragging');
            (ev.dataTransfer as DataTransfer).effectAllowed = 'move';
        };
        const onUrlDragEnd = () => {
            dragUrlEl?.classList.remove('kh-dragging');
            dragUrlId = dragUrlEl = null;
        };
        const moveUrlPreview = (targetRow: HTMLElement, before: boolean) => {
            if (!dragUrlEl || dragUrlEl === targetRow) return;
            const parent = targetRow.parentElement!;
            if (before) parent.insertBefore(dragUrlEl, targetRow);
            else        parent.insertBefore(dragUrlEl, targetRow.nextSibling);
        };
        const commitUrlOrder = () => {
            const order: string[] = Array.from(urlList.children)
                .map(el => (el as HTMLElement).dataset.urlId!);
            p.urls.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
            saveStore(store);
        };

        /* ─ URL rows ─ */
        for (const u of p.urls) {
            const row = h(`<div class="${sel.exportUrlRow.slice(1)}" draggable="true"
                               style="display:flex;flex-direction:column;gap:4px;"></div>`);
            row.dataset.urlId = u.id;
            urlList.appendChild(row);

            row.addEventListener('dragover', ev => {
                ev.preventDefault();
                if (dragUrlId) {
                    const rect = row.getBoundingClientRect();
                    const before = ev.clientY < rect.top + rect.height / 2;
                    moveUrlPreview(row, before);
                }
            });
            row.addEventListener('dragstart', ev => onUrlDragStart(ev, u.id, row));
            row.addEventListener('dragend',   () => { onUrlDragEnd(); commitUrlOrder(); });

            /* ===== FIRST ROW – controls ===== */
            const ctrlRow = h('<div style="display:flex;align-items:center;gap:8px;"></div>');
            row.appendChild(ctrlRow);

            /* “Make / ✔ Default URL” button */
            const defBtnTxt = p.defaultUrlId === u.id ? '✔ Default URL' : 'Make default URL';
            ctrlRow.appendChild(h(
                `<button class="${sel.exportSetDefaultUrlBtn.slice(1)}"
                         style="background:none;border:0;padding:0;cursor:pointer;">${defBtnTxt}</button>`));

            /* per-URL export-mode selector */
            ctrlRow.appendChild(h(`
                <span class="${sel.exportUrlMode.slice(1)}"
                      style="display:inline-flex;align-items:center;gap:4px;font-size:11px;">
                  <label><input type="radio" name="exp-mode-${u.id}" value="new-tab"> Open new tab</label>
                  <label><input type="radio" name="exp-mode-${u.id}" value="active-tab"> Use the selected Active tab</label>
                </span>`));

            /* “Delete URL” button (right-aligned) */
            ctrlRow.appendChild(h(
                `<button class="${sel.exportDelUrlBtn.slice(1)}"
                         style="background:none;border:0;padding:0;cursor:pointer;margin-left:auto;">Delete URL</button>`));

            /* ===== SECOND ROW – text inputs ===== */
            const inputRow = h('<div style="display:flex;gap:6px;"></div>');
            row.appendChild(inputRow);

            inputRow.appendChild(h(
                `<input class="${sel.exportLabelInput.slice(1)}" value="${u.label}" style="flex:0 0 120px;">`));
            inputRow.appendChild(h(
                `<input class="${sel.exportUrlInput.slice(1)}" value="${u.url}" style="flex:1;">`));

            /* ===== THIRD ROW – prompt ===== */
            row.appendChild(h(
                `<textarea class="${sel.exportPromptInput.slice(1)}"
                  style="width:100%;min-height:42px;resize:vertical;"
                  placeholder="Prompt template (placeholders allowed)">${u.prompt}</textarea>`));

            /* field handlers */
            row.querySelector<HTMLInputElement>(sel.exportLabelInput)!
                .addEventListener('change', e => { u.label = (e.target as HTMLInputElement).value; saveStore(store); });
            row.querySelector<HTMLInputElement>(sel.exportUrlInput)!
                .addEventListener('change', e => { u.url   = (e.target as HTMLInputElement).value; saveStore(store); });
            row.querySelector<HTMLTextAreaElement>(sel.exportPromptInput)!
                .addEventListener('change', e => { u.prompt= (e.target as HTMLTextAreaElement).value; saveStore(store); });

            /* mode radio */
            const modeRadios = row.querySelectorAll<HTMLInputElement>(`input[name="exp-mode-${u.id}"]`);
            modeRadios.forEach(r => { r.checked = r.value === (u.mode ?? 'new-tab'); });
            modeRadios.forEach(r => r.addEventListener('change', () => {
                u.mode = r.value as ExportMode; saveStore(store);
            }));

            /* default selector button handler */
            row.querySelector<HTMLButtonElement>(sel.exportSetDefaultUrlBtn)!
                .addEventListener('click', () => {
                    if (p.defaultUrlId !== u.id) {
                        p.defaultUrlId = u.id;
                        saveStore(store).then(() => rebuildSettingsUi(target));
                    }
                });

            /* delete URL handler */
            row.querySelector<HTMLButtonElement>(sel.exportDelUrlBtn)!
                .addEventListener('click', () => {
                    if (!confirm('Delete this URL?')) return;
                    p.urls = p.urls.filter(x => x.id !== u.id);
                    if (p.defaultUrlId === u.id) p.defaultUrlId = null;
                    autoSetDefaultUrl(p);
                    saveStore(store).then(() => rebuildSettingsUi(target));
                });
        }
    }
}
