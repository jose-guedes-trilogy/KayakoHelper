// src/modules/export-chat/settingsModal.ts
// 🔗 1. **Add at top**:
import { EXTENSION_SELECTORS } from '@/generated/selectors.ts';
import { autoSetDefaultUrl }   from './promptUtils.ts';
import {
    DEFAULT_INSERTER_PROVIDERS,
} from './defaultProviders.ts';
import {saveStore, Store, UrlEntry} from "@/utils/providerStore.ts";
import {ExportMode} from "@/modules/kayako/buttons/export-chat/constants.ts";

export function openSettingsModal(store: Store): void {
    if (document.querySelector(EXTENSION_SELECTORS.exportSettingsModal)) return;

    const modal = document.createElement('div');
    modal.id = EXTENSION_SELECTORS.exportSettingsModal.slice(1);
    modal.style.padding = '10px';
    modal.innerHTML = /* html */`
        <div class="kh-exp-header" style="display:flex;align-items:center;gap:12px;">
          <h2 style="margin:0;font-size:16px;">Export chat – settings</h2>
          <button id="${EXTENSION_SELECTORS.exportSettingsClose.slice(1)}" class="kh-exp-close-btn"
                  style="margin-left:auto;font-size:18px;line-height:1;">✕</button>
        </div>

        <p class="kh-exp-intro" style="margin:12px 0;">
          Providers and their URLs can be reordered via drag-and-drop (live preview).<br>
          “New / Active tab” can now be chosen per-URL below.
        </p>

        <div class="${EXTENSION_SELECTORS.noActiveTabNotice.slice(1)}" style="display:none;color:#c33;font-size:11px;">
          No active tab detected – selecting “Active tab” will behave like “New tab”.
        </div>

        <div id="${EXTENSION_SELECTORS.exportSettingsContent.slice(1)}"></div>

        <div class="kh-exp-footer" style="margin-top:16px;text-align:right;">
          <button id="${EXTENSION_SELECTORS.exportAddProviderBtn.slice(1)}">➕ Add provider</button>
        </div>
    `;
    document.body.appendChild(modal);

    /* close */
    modal.querySelector<HTMLButtonElement>(EXTENSION_SELECTORS.exportSettingsClose)!
        .addEventListener('click', () => modal.remove());

    /* ────────── modal drag-move (padding or header, not ✕ button) ────────── */
    const headerEl = modal.querySelector<HTMLDivElement>('.kh-exp-header')!;
    headerEl.style.cursor = 'move';

    const startDrag = (e: MouseEvent): void => {
        const isPadding = e.target === modal;
        const isHeader  = !!(e.target as HTMLElement).closest('.kh-exp-header') &&
            !(e.target as HTMLElement).closest('.kh-exp-close-btn');
        if (!isPadding && !isHeader) return;

        const dx = e.clientX - modal.offsetLeft;
        const dy = e.clientY - modal.offsetTop;

        const move = (ev: MouseEvent) => {
            modal.style.left = ev.clientX - dx + 'px';
            modal.style.top  = ev.clientY - dy + 'px';
        };
        const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup',   up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup',   up);
        e.preventDefault();
    };

    modal .addEventListener('mousedown', startDrag);  // padding
    headerEl.addEventListener('mousedown', startDrag); // header

    /* render provider list */
    rebuildSettingsUi(modal.querySelector(EXTENSION_SELECTORS.exportSettingsContent)! as HTMLElement, store);

    /* add-provider */
    modal.querySelector<HTMLButtonElement>(EXTENSION_SELECTORS.exportAddProviderBtn)!
        .addEventListener('click', () => {
            const name = prompt('Provider name?'); if (!name?.trim()) return;
            const id   = `${name.toLowerCase().replace(/\s+/g,'-')}-${crypto.randomUUID().slice(0,4)}`;
            store.providers.push({ id, name, multi:true, urls: [], defaultUrlId: null });
            saveStore(store).then(() =>
                rebuildSettingsUi(modal.querySelector(EXTENSION_SELECTORS.exportSettingsContent)! as HTMLElement, store));
        });

    /* ask background if an active tab exists → update tiny notice */
    chrome.runtime.sendMessage({ action: 'exportChat.getStatus' },
        (res: {active:boolean}) => {
            if (!res?.active)
                modal.querySelector(EXTENSION_SELECTORS.noActiveTabNotice)!.setAttribute('style','');
        });
}

/* ───────────────────────── settings UI (re)build ───────────────────────── */

function rebuildSettingsUi(target: HTMLElement, store: Store): void {
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
        if (dragProvEl) dragProvEl.classList.remove('kh-dragging');
        dragProvEl = null;          // ← split fixes “null not assignable”
        dragProvId = null;
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
        const wrap = h(`<div class="${EXTENSION_SELECTORS.exportProviderWrapper.slice(1)}" draggable="true"></div>`);
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
        <button class="${EXTENSION_SELECTORS.exportAddUrlBtn.slice(1)}">➕ Add URL</button>
        ${DEFAULT_INSERTER_PROVIDERS.has(p.id) ? '' :
            `<button class="${EXTENSION_SELECTORS.exportDelProvBtn.slice(1)}">🗑</button>`}
        <label style="margin-left:auto;font-size:11px;font-weight:normal;">
          Default&nbsp;for&nbsp;main&nbsp;button
          <input type="radio" name="exp-main-default">
        </label>
      </div>`));

        /* url-list container */
        const urlList = h(`<div class="${EXTENSION_SELECTORS.exportUrlList.slice(1)}"></div>`);
        wrap.appendChild(urlList);

        /* header-level handlers */
        wrap.querySelector<HTMLInputElement>('input[name="exp-main-default"]')!.checked =
            p.id === store.mainDefaultProviderId;

        wrap.querySelector<HTMLInputElement>('input[name="exp-main-default"]')!
            .addEventListener('change', () => {
                store.mainDefaultProviderId = p.id;
                saveStore(store);
            });

        const delProvBtn = wrap.querySelector<HTMLButtonElement>(EXTENSION_SELECTORS.exportDelProvBtn);
        if (delProvBtn) {
            delProvBtn.addEventListener('click', () => {
                if (!confirm('Delete provider and all its URLs?')) return;
                store.providers = store.providers.filter(x => x.id !== p.id);
                if (store.mainDefaultProviderId === p.id) store.mainDefaultProviderId = null;
                saveStore(store).then(() => rebuildSettingsUi(target, store));
            });
        }

        /* add-URL */
        wrap.querySelector<HTMLButtonElement>(EXTENSION_SELECTORS.exportAddUrlBtn)!
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
                saveStore(store).then(() => rebuildSettingsUi(target, store));
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
            if (dragUrlEl) dragUrlEl.classList.remove('kh-dragging');
            dragUrlEl = null;       // ← split fixes “null not assignable”
            dragUrlId = null;
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
            const row = h(`<div class="${EXTENSION_SELECTORS.exportUrlRow.slice(1)}" draggable="true"
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
                `<button class="${EXTENSION_SELECTORS.exportSetDefaultUrlBtn.slice(1)}"
                         style="background:none;border:0;padding:0;cursor:pointer;">${defBtnTxt}</button>`));

            /* per-URL export-mode selector */
            ctrlRow.appendChild(h(`
                <span class="${EXTENSION_SELECTORS.exportUrlMode.slice(1)}"
                      style="display:inline-flex;align-items:center;gap:4px;font-size:11px;">
                  <label><input type="radio" name="exp-mode-${u.id}" value="new-tab"> Open new tab</label>
                  <label><input type="radio" name="exp-mode-${u.id}" value="active-tab"> Use the selected Active tab</label>
                </span>`));

            /* “Delete URL” button (right-aligned) */
            ctrlRow.appendChild(h(
                `<button class="${EXTENSION_SELECTORS.exportDelUrlBtn.slice(1)}"
                         style="background:none;border:0;padding:0;cursor:pointer;margin-left:auto;">Delete URL</button>`));

            /* ===== SECOND ROW – text inputs ===== */
            const inputRow = h('<div style="display:flex;gap:6px;"></div>');
            row.appendChild(inputRow);

            inputRow.appendChild(h(
                `<input class="${EXTENSION_SELECTORS.exportLabelInput.slice(1)}" value="${u.label}" style="flex:0 0 120px;">`));
            inputRow.appendChild(h(
                `<input class="${EXTENSION_SELECTORS.exportUrlInput.slice(1)}" value="${u.url}" style="flex:1;">`));

            /* ===== THIRD ROW – prompt ===== */
            row.appendChild(h(
                `<textarea class="${EXTENSION_SELECTORS.exportPromptInput.slice(1)}"
                  style="width:100%;min-height:42px;resize:vertical;"
                  placeholder="Prompt template (placeholders allowed)">${u.prompt}</textarea>`));

            /* field handlers */
            row.querySelector<HTMLInputElement>(EXTENSION_SELECTORS.exportLabelInput)!
                .addEventListener('change', e => { u.label = (e.target as HTMLInputElement).value; saveStore(store); });
            row.querySelector<HTMLInputElement>(EXTENSION_SELECTORS.exportUrlInput)!
                .addEventListener('change', e => { u.url   = (e.target as HTMLInputElement).value; saveStore(store); });
            row.querySelector<HTMLTextAreaElement>(EXTENSION_SELECTORS.exportPromptInput)!
                .addEventListener('change', e => { u.prompt= (e.target as HTMLTextAreaElement).value; saveStore(store); });

            /* mode radio */
            const modeRadios = row.querySelectorAll<HTMLInputElement>(`input[name="exp-mode-${u.id}"]`);
            modeRadios.forEach(r => { r.checked = r.value === (u.mode ?? 'new-tab'); });
            modeRadios.forEach(r => r.addEventListener('change', () => {
                u.mode = r.value as ExportMode; saveStore(store);
            }));

            /* default selector button handler */
            row.querySelector<HTMLButtonElement>(EXTENSION_SELECTORS.exportSetDefaultUrlBtn)!
                .addEventListener('click', () => {
                    if (p.defaultUrlId !== u.id) {
                        p.defaultUrlId = u.id;
                        saveStore(store).then(() => rebuildSettingsUi(target, store));
                    }
                });

            /* delete URL handler */
            row.querySelector<HTMLButtonElement>(EXTENSION_SELECTORS.exportDelUrlBtn)!
                .addEventListener('click', () => {
                    if (!confirm('Delete this URL?')) return;
                    p.urls = p.urls.filter(x => x.id !== u.id);
                    if (p.defaultUrlId === u.id) p.defaultUrlId = null;
                    autoSetDefaultUrl(p);
                    saveStore(store).then(() => rebuildSettingsUi(target, store));
                });
        }
    }
}
