// src/modules/export-chat/settingsModal.ts
// 🔗 1. **Add at top**:
import { EXTENSION_SELECTORS } from '@/generated/selectors.ts';
import { autoSetDefaultUrl, augmentMissingDefaultProviders }   from './promptUtils.ts';
import { ExportMode, BLANK_PROMPT } from '@/modules/kayako/buttons/export-chat/constants.ts';
import {
    DEFAULT_INSERTER_PROVIDERS,
    EPHOR_PROJECT_INVITES,
} from './defaultProviders.ts';
import {saveStore, Store, UrlEntry} from "@/utils/providerStore.ts";

// ── Inline Add URL row selectors (module scope) ───────────────────────────
const NEW_LABEL_SEL = '.kh-exp-new-label';
const NEW_URL_SEL   = '.kh-exp-new-url';
const NEW_ADD_SEL   = '.kh-exp-add-url-submit';
const NEW_LABEL_CLASS = 'kh-exp-new-label';
const NEW_URL_CLASS   = 'kh-exp-new-url';
const NEW_ADD_CLASS   = 'kh-exp-add-url-submit';

export function openSettingsModal(store: Store): void {
    if (document.querySelector(EXTENSION_SELECTORS.exportSettingsModal)) return;

    const modal = document.createElement('div');
    modal.id = EXTENSION_SELECTORS.exportSettingsModal.slice(1);
    modal.style.padding = '12px';
    modal.style.resize = 'both';            // make the whole window resizable
    modal.style.overflow = 'auto';
    modal.style.border = '1px solid #e5e7f2';
    modal.style.borderRadius = '12px';
    modal.style.background = '#fff';
    // Fixed selectors for the inline Add URL row (do not depend on generated types)
    // const NEW_LABEL_SEL = '.kh-exp-new-label';
    // const NEW_URL_SEL   = '.kh-exp-new-url';
    // const NEW_ADD_SEL   = '.kh-exp-add-url-submit';

    // const NEW_LABEL_CLASS = 'kh-exp-new-label';
    // const NEW_URL_CLASS   = 'kh-exp-new-url';
    // const NEW_ADD_CLASS   = 'kh-exp-add-url-submit';

    modal.innerHTML = /* html */`
        <style>
          /* ---------- buttons (Ephor-like) ---------- */
          .kh-btn{padding:4px 12px;border:1px solid #c9ced6;border-radius:8px;background:#fff;
                  cursor:pointer;font:inherit;display:inline-flex;align-items:center;gap:4px;}
          .kh-btn:hover{background:#f5f7ff;border-color:#8aa4e6;}
          .kh-btn-primary{background:#2e73e9;color:#fff;border-color:#2e73e9;}
          .kh-btn-primary:hover{background:#255ecd;color:#fff;}

          /* ---------- inputs ---------- */
          .kh-exp-input{border:1px solid #c9ced6;border-radius:8px;padding:6px 8px;font:inherit;background:#fff;}
          .kh-exp-input:focus{outline:none;border-color:#8aa4e6;box-shadow:0 0 0 2px rgba(46,115,233,.15)}
          .kh-exp-url-row{background:hsl(213 20% 97% / 1);padding:6px 8px;border:1px solid #e5e7f2;border-radius:10px;}
          .kh-exp-provider-head{display:flex;align-items:center;gap:8px;}

          /* Outermost provider wrapper with rounder borders */
          .${EXTENSION_SELECTORS.exportProviderWrapper.slice(1)}{border:1px solid #e5e7f2;border-radius:12px;padding:10px;margin:10px 0;background:#fafbff;}

          /* Radio group layout */
          .${EXTENSION_SELECTORS.exportUrlMode.slice(1)}{display:flex;align-items:center;gap:8px;font-size:11px;}
          .${EXTENSION_SELECTORS.exportUrlMode.slice(1)} > label{display:flex;align-items:center;gap:4px;}

          /* Content container spacing */
          ${EXTENSION_SELECTORS.exportSettingsContent}{margin-top:8px;}
          /* Accordion */
          .kh-accordion { border-top:1px solid #e5e7f2; margin-top:8px; }
          .kh-acc-item { border-bottom:1px solid #e5e7f2; }
          .kh-acc-header { display:flex; align-items:center; gap:8px; padding:6px 0; cursor:pointer; }
          .kh-acc-chevron { margin-left:auto; transition:transform .2s ease; }
          .kh-acc-open .kh-acc-chevron { transform:rotate(90deg); }
          .kh-acc-body { display:none; padding:6px 0 10px; }
          .kh-acc-open .kh-acc-body { display:block; }

          /* Search */
          .kh-exp-search { display:flex; gap:6px; align-items:center; margin:8px 0; }
          .kh-exp-search input { flex:1 1 auto; min-width:200px; }
        </style>
        <div class="kh-exp-header" style="display:flex;align-items:center;gap:12px;">
          <h2 style="margin:0;font-size:16px;">Export chat – settings</h2>
          <button id="${EXTENSION_SELECTORS.exportSettingsClose.slice(1)}" class="kh-exp-close-btn kh-btn"
                  style="margin-left:auto;">Close</button>
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

    /* Ensure any missing default providers (Gemini, Ephor) are present */
    void augmentMissingDefaultProviders(store).then(changed => {
        if (changed) {
            console.info('[exportSettings] missing defaults added');
            rebuildSettingsUi(modal.querySelector(EXTENSION_SELECTORS.exportSettingsContent)! as HTMLElement, store);
        }
    });

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
    console.info('[exportSettings] opening settings modal – building UI');
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
            .map(el => (el as HTMLElement).dataset['provId']!);
        store.providers.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
        saveStore(store);
    };

    /* iterate providers */
    for (const p of store.providers) {
        /* cache Ephor joined-project IDs once per rebuild to avoid N network calls */
        let ephorJoinedIdsPromise: Promise<Set<string>> | null = null;
        const ensureEphorJoinedIds = (): Promise<Set<string>> => {
            if (p.id !== 'ephor') return Promise.resolve(new Set<string>());
            if (ephorJoinedIdsPromise) return ephorJoinedIdsPromise;
            console.info('[exportSettings] fetching Ephor joined projects (once)');
            ephorJoinedIdsPromise = new Promise<Set<string>>((resolve) => {
                chrome.runtime.sendMessage({ action: 'ephor.listProjects' }, (res: { ok?: boolean; data?: any }) => {
                    try {
                        const list: any[] = Array.isArray(res?.data) ? res!.data : (res?.data?.items ?? res?.data?.data ?? []);
                        const set = new Set<string>(list.map((it: any) => String(it.id ?? it.project_id ?? it.uuid)));
                        resolve(set);
                    } catch (err) {
                        console.warn('[exportSettings] ephor.listProjects failed; treating as empty', err);
                        resolve(new Set<string>());
                    }
                });
            });
            return ephorJoinedIdsPromise;
        };
        /* ─ provider wrapper ─ */
        const wrap = h(`<div class="${EXTENSION_SELECTORS.exportProviderWrapper.slice(1)}" draggable="true"></div>`);
        (wrap as HTMLElement).dataset['provId'] = p.id;
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

        /* header + accordion shell */
        wrap.appendChild(h(/* html */`
      <div class="kh-exp-provider-head">
        <strong>${p.name}</strong>
        <em style="font-size:11px;">multi-URL</em>
        ${DEFAULT_INSERTER_PROVIDERS.has(p.id) ? '' :
            `<button class="${EXTENSION_SELECTORS.exportDelProvBtn.slice(1)} kh-btn">🗑</button>`}
        <label style="margin-left:auto;font-size:11px;font-weight:normal;">
          Default&nbsp;for&nbsp;main&nbsp;button
          <input type="radio" name="exp-main-default">
        </label>
      </div>`));

        /* accordion container */
        const acc = h(`<div class="kh-accordion"></div>`);
        wrap.appendChild(acc);

        /* Section: Manage links (accordion item) */
        const accItem = h(`<div class="kh-acc-item kh-acc-open"></div>`);
        acc.appendChild(accItem);
        accItem.appendChild(h(`<div class="kh-acc-header">
            <span>Links</span>
            <span class="kh-acc-chevron">▸</span>
        </div>`));
        const accBody = h(`<div class="kh-acc-body"></div>`);
        accItem.appendChild(accBody);

        const newRow = h(`
          <div class="kh-exp-url-row" style="margin:6px 0;display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;">
            <div style="display:flex;gap:6px;">
              <input class="${NEW_LABEL_CLASS} kh-exp-input" placeholder="Name" style="flex:0 0 140px;">
              <input class="${NEW_URL_CLASS} kh-exp-input" placeholder="URL" style="flex:1 1 auto;min-width:220px;">
            </div>
            <button class="${NEW_ADD_CLASS} kh-btn-primary" style="padding:6px 14px;justify-self:end;border-radius:999px;">Add URL</button>
          </div>
        `);
        accBody.appendChild(newRow);

        /* Search bar */
        const searchRow = h(`
          <div class="kh-exp-search">
            <input class="kh-exp-input kh-exp-search-input" placeholder="Search links by name or URL…">
            <button class="kh-btn kh-exp-search-clear" title="Clear">✕</button>
          </div>
        `);
        accBody.appendChild(searchRow);

        /* url-list container */
        const urlList = h(`<div class="${EXTENSION_SELECTORS.exportUrlList.slice(1)}"></div>`);
        accBody.appendChild(urlList);

        /* Accordion toggle */
        const accHeader = accItem.querySelector('.kh-acc-header')! as HTMLElement;
        accHeader.addEventListener('click', () => accItem.classList.toggle('kh-acc-open'));

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

        /* add-URL logic (uses always-visible inputs) */
        const addFromInputs = (): void => {
            const nameEl = wrap.querySelector<HTMLInputElement>(NEW_LABEL_SEL)!;
            const urlEl  = wrap.querySelector<HTMLInputElement>(NEW_URL_SEL)!;
            const addBtn = wrap.querySelector<HTMLButtonElement>(NEW_ADD_SEL)!;

            const rawName = (nameEl.value ?? '').trim();
            const rawUrl  = (urlEl.value ?? '').trim();
            console.log('[exportSettings] addUrl clicked', { providerId: p.id, nameLen: rawName.length, urlPreview: rawUrl.slice(0, 64) });

            if (!rawName) { console.warn('[exportSettings] addUrl aborted: empty name'); nameEl.focus(); return; }
            if (!rawUrl)  { console.warn('[exportSettings] addUrl aborted: empty url');  urlEl.focus();  return; }
            try { void new URL(rawUrl); } catch {
                console.warn('[exportSettings] addUrl aborted: invalid URL', rawUrl);
                alert('Please enter a valid URL (e.g., https://example.com).');
                urlEl.focus();
                return;
            }

            const newEntry: UrlEntry = {
                id: crypto.randomUUID(),
                label: rawName,
                url  : rawUrl,
                prompt: BLANK_PROMPT,
                supportsInsertion: DEFAULT_INSERTER_PROVIDERS.has(p.id),
                // Default to "active-tab" as requested
                mode: 'active-tab',
            };

            p.urls.push(newEntry);
            autoSetDefaultUrl(p);
            addBtn.disabled = true;
            saveStore(store).then(() => {
                console.info('[exportSettings] URL added & saved', { providerId: p.id, urlId: newEntry.id });
                nameEl.value = '';
                urlEl.value = '';
                rebuildSettingsUi(target, store);
            }).catch(err => {
                console.error('[exportSettings] failed to save new URL', err);
                addBtn.disabled = false;
            });
        };

        const nameInput = wrap.querySelector<HTMLInputElement>(NEW_LABEL_SEL)!;
        const urlInput  = wrap.querySelector<HTMLInputElement>(NEW_URL_SEL)!;
        const addBtn    = wrap.querySelector<HTMLButtonElement>(NEW_ADD_SEL)!;

        const updateAddBtn = () => {
            const ok = !!(nameInput.value?.trim() && urlInput.value?.trim());
            addBtn.disabled = !ok;
        };
        nameInput.addEventListener('input', updateAddBtn);
        urlInput .addEventListener('input', updateAddBtn);
        nameInput.addEventListener('keyup', (e) => { if ((e as KeyboardEvent).key === 'Enter') addFromInputs(); });
        urlInput .addEventListener('keyup', (e) => { if ((e as KeyboardEvent).key === 'Enter') addFromInputs(); });
        addBtn   .addEventListener('click', addFromInputs);
        updateAddBtn();

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
                .map(el => (el as HTMLElement).dataset['urlId']!);
            p.urls.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
            saveStore(store);
        };

        /* ─ URL rows ─ */
        const renderRows = (term: string): void => {
            urlList.textContent = '';
            const q = term.trim().toLowerCase();
            const items = q ? p.urls.filter(u => u.label.toLowerCase().includes(q) || u.url.toLowerCase().includes(q)) : p.urls;
            for (const u of items) {
            const row = h(`<div class="${EXTENSION_SELECTORS.exportUrlRow.slice(1)}" draggable="true"
                               style="display:flex;flex-direction:column;gap:4px;"></div>`);
            (row as HTMLElement).dataset['urlId'] = u.id;
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

            /* ===== SECOND ROW – text inputs + Join control for Ephor ===== */
            const inputRow = h('<div style="display:flex;gap:6px;"></div>');
            row.appendChild(inputRow);

            inputRow.appendChild(h(
                `<input class="${EXTENSION_SELECTORS.exportLabelInput.slice(1)} kh-exp-input" value="${u.label}" style="flex:0 0 140px;">`));
            inputRow.appendChild(h(
                `<input class="${EXTENSION_SELECTORS.exportUrlInput.slice(1)} kh-exp-input" value="${u.url}" style="flex:1 1 auto;">`));

            /* Join button for Ephor project links */
            if (p.id === 'ephor') {
                const projId = (() => { try { return new URL(u.url).pathname.split('/').pop() || ''; } catch { return ''; } })();
                const joinBtn = h(`<button class="kh-btn" style="flex:0 0 auto;">Check…</button>`) as HTMLButtonElement;
                inputRow.appendChild(joinBtn);

                const updateJoined = async () => {
                    joinBtn.disabled = true;
                    try {
                        const joined = await ensureEphorJoinedIds();
                        const has = joined.has(projId);
                        joinBtn.textContent = has ? 'Joined' : 'Join';
                        joinBtn.classList.toggle('kh-btn-primary', !has);
                        joinBtn.disabled = false;
                    } catch (err) {
                        console.warn('[exportSettings] failed updating Ephor join state', err);
                        joinBtn.textContent = 'Join';
                        joinBtn.disabled = false;
                    }
                };
                joinBtn.disabled = true;
                void updateJoined();

                joinBtn.addEventListener('click', async () => {
                    if (joinBtn.textContent === 'Joined') return;
                    const invite = EPHOR_PROJECT_INVITES[projId];
                    if (!invite) { alert('Join link not found for this project.'); return; }
                    joinBtn.textContent = 'Joining…';
                    joinBtn.disabled = true;
                    const resp = await new Promise<{ ok: boolean; joined?: boolean; error?: any }>(r =>
                        chrome.runtime.sendMessage({ action: 'ephor.joinByInvite', inviteId: invite, projectId: projId }, r));
                    if (resp?.ok && resp.joined) {
                        joinBtn.textContent = 'Joined';
                        joinBtn.classList.remove('kh-btn-primary');
                        joinBtn.disabled = false;
                        // update cache eagerly so subsequent rows reflect joined status without refetch
                        try { (await ensureEphorJoinedIds()).add(projId); } catch { /* ignore */ }
                    } else {
                        joinBtn.textContent = 'Join';
                        joinBtn.disabled = false;
                        alert('Could not join project – open ephor.ai and sign in, then try again.');
                    }
                });
            }

            /* ===== THIRD ROW – prompt ===== */
            row.appendChild(h(
                `<textarea class="${EXTENSION_SELECTORS.exportPromptInput.slice(1)} kh-exp-input"
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
        };

        renderRows('');

        /* Search handlers */
        const searchInput = accBody.querySelector<HTMLInputElement>('.kh-exp-search-input')!;
        const searchClear = accBody.querySelector<HTMLButtonElement>('.kh-exp-search-clear')!;
        const doFilter = () => renderRows(searchInput.value || '');
        searchInput.addEventListener('input', doFilter);
        searchClear.addEventListener('click', () => { searchInput.value = ''; doFilter(); });
    }
}
