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
import { openCannedPromptModal } from "@/modules/kayako/buttons/ephor/ephorCannedPromptModal.ts";
import { loadEphorStore } from "@/modules/kayako/buttons/ephor/ephorStore.ts";
import { requestMessageSafe } from '@/utils/sendMessageSafe';

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
    modal.style.position = 'fixed';
    modal.style.top = '64px';
    modal.style.left = '64px';
    modal.style.right = 'auto';
    // Ensure no CSS transform interferes with pixel positioning during drag
    modal.style.transform = 'none';
    modal.style.maxWidth = 'min(96vw, 960px)';
    modal.style.maxHeight = 'min(90vh, 720px)';
    modal.style.boxShadow = '0 6px 24px rgba(17,24,39,.12)';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.style.zIndex = '10002';
    modal.style.visibility = 'hidden';
    // Fixed selectors for the inline Add URL row (do not depend on generated types)
    // const NEW_LABEL_SEL = '.kh-exp-new-label';
    // const NEW_URL_SEL   = '.kh-exp-new-url';
    // const NEW_ADD_SEL   = '.kh-exp-add-url-submit';

    // const NEW_LABEL_CLASS = 'kh-exp-new-label';
    // const NEW_URL_CLASS   = 'kh-exp-new-url';
    // const NEW_ADD_CLASS   = 'kh-exp-add-url-submit';

    modal.innerHTML = /* html */`
        <style>
          /* ---------- variables (match Ephor) ---------- */
          ${EXTENSION_SELECTORS.exportSettingsModal}{
            --kh-input-border: hsl(213deg 15% 84%);
            --kh-input-shadow: inset 0 0 4px 0 hsla(0,0%,0%,0.0325), inset 0 0 2px 0 hsla(0,0%,0%,0.0805), inset 0 0 1px 0 hsla(0,0%,0%,0.089);
            --kh-input-bg: #fff;
          }
          /* ---------- buttons (Ephor-like) ---------- */
          .kh-btn{padding:4px 12px;border:1px solid #c9ced6;border-radius:4px;background:#fff;
                  cursor:pointer;font:inherit;display:inline-flex;align-items:center;gap:4px;box-shadow: 0 1px 1px rgba(0,0,0,.05), 0 2px 3px rgba(0,0,0,.04);}
          .kh-btn:hover{background:#f5f7ff;border-color:#8aa4e6;}
          .kh-btn:active{transform:translateY(1px); box-shadow:0 1px 1px rgba(0,0,0,.03);}  
          .kh-btn[disabled]{opacity:.5; pointer-events:none;}
          .kh-btn-primary{background: linear-gradient(180deg, #3d82f2, #2e73e9); color:#fff; border:none; border-radius:4px; box-shadow: 0 2px 4px rgba(0,0,0,.12), 0 1px 0 rgba(255,255,255,.25) inset, 0 0 0 1px rgba(0,0,0,.02);}  
          .kh-btn-primary:hover{background: linear-gradient(180deg, #3576e4, #255ecd); color:#fff;}
          .kh-btn-primary:active{transform:translateY(1px); box-shadow:0 1px 2px rgba(0,0,0,.10), 0 1px 0 rgba(255,255,255,.2) inset;}  

          /* Close button look (match Ephor) */
          .kh-exp-close-btn{ padding:4px 8px; font-weight:600; color:#555; }

          /* ---------- inputs ---------- */
          .kh-exp-input{border:1px solid var(--kh-input-border);border-radius:4px;padding:6px 8px;font:inherit;background:var(--kh-input-bg); box-shadow: var(--kh-input-shadow);}
          .kh-exp-input:focus{outline:none;border-color:#8aa4e6;box-shadow:0 0 0 2px rgba(46,115,233,.15)}
          .kh-exp-url-row{background:hsl(210 10% 98% / 1);padding:6px 8px;border:1px solid #e5e7f2;border-radius:8px;}
          .kh-exp-provider-head{display:flex;align-items:center;gap:8px;}

          /* Outermost provider wrapper with rounder borders (desaturated bg) */
          .${EXTENSION_SELECTORS.exportProviderWrapper.slice(1)}{border:1px solid #e5e7f2;border-radius:12px;padding:10px;margin:10px 0;background:#fafafa;}
          .${EXTENSION_SELECTORS.exportProviderWrapper.slice(1)}.kh-dragging{opacity:.85; background:#eef4ff; border-color:#88a5da;}
          .kh-exp-provider-head{cursor:grab;}
          .kh-exp-provider-head:active{cursor:grabbing;}

          /* Grouped URL fields */
          .kh-exp-group{background:hsl(210 8% 99% / 1);border:1px solid #e8ebf2;border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:6px;}
          .kh-exp-row-head{display:flex;align-items:center;gap:8px;}
          .kh-exp-row-head .kh-right{margin-left:auto;display:inline-flex;align-items:center;gap:10px;}

          /* Radio group layout */
          .${EXTENSION_SELECTORS.exportUrlMode.slice(1)}{display:flex;align-items:center;gap:8px;font-size:11px;}
          .${EXTENSION_SELECTORS.exportUrlMode.slice(1)} > label{display:flex;align-items:center;gap:6px; padding:2px 8px; border-radius:4px; cursor:pointer; transition:background .12s ease, border-color .12s ease;}
          .${EXTENSION_SELECTORS.exportUrlMode.slice(1)} > label:hover{background:#f5f7ff;}
          .${EXTENSION_SELECTORS.exportUrlMode.slice(1)} > label:has(input:checked){background:hsl(216 20% 98% / 1); border:1px solid #adc1e3;}
          .${EXTENSION_SELECTORS.exportUrlMode.slice(1)} input{margin:0 2px 0 0;}

          /* Content container spacing */
          ${EXTENSION_SELECTORS.exportSettingsContent}{margin-top:8px;}
          /* Snap scrolling to one provider at a time */
          ${EXTENSION_SELECTORS.exportSettingsContent}{ scroll-snap-type: y mandatory; }
          .${EXTENSION_SELECTORS.exportProviderWrapper.slice(1)}{ scroll-snap-align: start; scroll-snap-stop: always; }
          /* Accordion */
          .kh-accordion { border-top:1px solid #e5e7f2; margin-top:8px; }
          .kh-acc-item { border-bottom:1px solid #e5e7f2; }
          .kh-acc-header { display:flex; align-items:center; gap:8px; padding:6px 0; cursor:pointer; }
          .kh-acc-chevron { margin-left:auto; transition:transform .2s ease; }
          .kh-acc-open .kh-acc-chevron { transform:rotate(90deg); }
          .kh-acc-body { display:block; padding:6px 0 10px; }
          .kh-acc-open .kh-acc-body { display:block; }

          /* Search */
          .kh-exp-search { display:flex; gap:6px; align-items:center; margin:8px 0; }
          .kh-exp-search input { flex:1 1 auto; min-width:200px; }

          /* Modal base typography to match Ephor */
          ${EXTENSION_SELECTORS.exportSettingsModal}{ font-family: system-ui; font-size: 13px; contain:inline-size; }

          /* Checkboxes (subtle 3D like Ephor) */
          ${EXTENSION_SELECTORS.exportSettingsModal} input[type="checkbox"]{
            -webkit-appearance: none; -moz-appearance: none; appearance: none; width:14px; height:14px; vertical-align:middle;
            border:1px solid var(--kh-input-border); border-radius:3px; background:#fff;
            box-shadow: 0 1px 1px rgba(0,0,0,.05), 0 2px 3px rgba(0,0,0,.04); position: relative; cursor: pointer;
          }
          ${EXTENSION_SELECTORS.exportSettingsModal} input[type="checkbox"]:hover{ background:#f9fbff; border-color:#adc1e3; }
          ${EXTENSION_SELECTORS.exportSettingsModal} input[type="checkbox"]:active{ box-shadow: 0 1px 1px rgba(0,0,0,.03); }
          ${EXTENSION_SELECTORS.exportSettingsModal} input[type="checkbox"]:focus-visible{ outline:none; box-shadow:0 0 0 2px rgba(46,115,233,.25); }
          ${EXTENSION_SELECTORS.exportSettingsModal} input[type="checkbox"]:checked{ border-color:#2e73e9; background: linear-gradient(180deg, #e9f1ff, #dfeaff); }
          ${EXTENSION_SELECTORS.exportSettingsModal} input[type="checkbox"]:checked::after{ content:""; position:absolute; left:3px; top:1px; width:6px; height:9px; border-right:2px solid #2e73e9; border-bottom:2px solid #2e73e9; transform: rotate(45deg); }

          /* URL list styling – match Ephor lists */
          ${EXTENSION_SELECTORS.exportUrlList}{ border:1px solid #ddd; border-radius:4px; padding:4px; background:#fff; overflow-y:auto; }
          ${EXTENSION_SELECTORS.exportUrlList} > * { border:1px solid transparent; border-radius:6px; }
          ${EXTENSION_SELECTORS.exportUrlList} > *:nth-child(odd){ background: hsl(213 66% 98% / 1); }
          ${EXTENSION_SELECTORS.exportUrlList} > *:nth-child(even){ background: hsl(213 54% 94% / 1); }
          ${EXTENSION_SELECTORS.exportUrlList} ${EXTENSION_SELECTORS.exportLinkItem}:hover{ background:#f5f7ff; border-color:#adc1e3; }
          ${EXTENSION_SELECTORS.exportLinkItemActive}, ${EXTENSION_SELECTORS.exportLinkItem}.active{ background:hsl(216 20% 98% / 1) !important; color:#454545; border-color:hsl(216 69% 77% / 1) !important; box-shadow:0 1px 1px rgba(0,0,0,.05), 0 2px 3px rgba(0,0,0,.04); }
          ${EXTENSION_SELECTORS.exportLinkItem}{ transition: background .12s ease, border-color .12s ease, box-shadow .12s ease; }

          /* Deletion links and minor actions */
          ${EXTENSION_SELECTORS.exportDelUrlBtn}{ color:#b11; cursor:pointer; }
          ${EXTENSION_SELECTORS.exportDelUrlBtn}:hover{ color:#900; text-decoration:underline; }
          ${EXTENSION_SELECTORS.exportDelUrlBtn}:active{ color:#700; }
          
          /* Scrollbars (match Ephor) */
          ${EXTENSION_SELECTORS.exportSettingsContent}::-webkit-scrollbar { width: 14px; height: 14px; }
          ${EXTENSION_SELECTORS.exportSettingsContent}::-webkit-scrollbar-thumb { background:#c7cedb; border-radius:10px; border:3px solid #fff; }
          ${EXTENSION_SELECTORS.exportSettingsContent}::-webkit-scrollbar-track { background:transparent; border-radius:10px; }
        </style>
        <div class="kh-exp-header" style="display:flex;align-items:center;gap:12px;">
          <h2 style="margin:0;font-size:16px;">Export chat – settings</h2>
          <span style="margin-left:auto;display:inline-flex;gap:6px;align-items:center;">
            
            <button id="${EXTENSION_SELECTORS.exportSettingsClose.slice(1)}" class="kh-exp-close-btn kh-btn">✕</button>
          </span>
        </div>

        <p class="kh-exp-intro" style="margin:12px 0;">
          Providers and their URLs can be reordered via drag-and-drop (live preview).<br>
          “New / Active tab” can now be chosen per-URL below.
        </p>

        <div class="${EXTENSION_SELECTORS.noActiveTabNotice.slice(1)}" style="display:none;color:#c33;font-size:11px;">
          No active tab detected – selecting “Active tab” will behave like “New tab”.
        </div>

        <div id="${EXTENSION_SELECTORS.exportSettingsContent.slice(1)}" style="flex:1 1 auto; min-height:0; overflow:auto;"></div>

        <div class="kh-exp-footer" style="margin-top:16px;display:flex;align-items:center;gap:8px;">
          <button class="kh-btn ${EXTENSION_SELECTORS.exportCannedBtn.replace(/^\./,'')}" title="Manage placeholders">📑 Placeholders</button>
          <span style="margin-left:auto"></span>
          <button id="${EXTENSION_SELECTORS.exportAddProviderBtn.slice(1)}" class="kh-btn">➕ Add provider</button>
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

        const startRect = modal.getBoundingClientRect();
        const dx = e.clientX - startRect.left;
        const dy = e.clientY - startRect.top;

        const move = (ev: MouseEvent) => {
            let left = ev.clientX - dx;
            let top  = ev.clientY - dy;
            try {
                const rect = modal.getBoundingClientRect();
                const vw = window.innerWidth || 0;
                const vh = window.innerHeight || 0;
                const maxLeft = Math.max(0, vw - rect.width);
                const maxTop  = Math.max(0, vh - rect.height);
                left = Math.min(Math.max(0, left), maxLeft);
                top  = Math.min(Math.max(0, top),  maxTop);
            } catch {}
            modal.style.left = left + 'px';
            modal.style.top  = top  + 'px';
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

    /* Snap-sizing: fit exactly one provider and discrete scroll between them */
    (function applySnapSizing(){
        const content = modal.querySelector<HTMLElement>(EXTENSION_SELECTORS.exportSettingsContent);
        if (!content) return;
        const contentEl = content as HTMLElement;

        const getWrappers = (): HTMLElement[] => Array.from(contentEl.querySelectorAll<HTMLElement>(EXTENSION_SELECTORS.exportProviderWrapper));

        const sizeToOne = () => {
            try {
                const first = getWrappers()[0];
                if (!first) return;
                const rect = first.getBoundingClientRect();
                const targetHeight = Math.ceil(rect.height);
                contentEl.style.height = targetHeight + 'px';
            } catch {}
        };

        let scrollLock = false;
        const scrollToIndex = (idx: number) => {
            const list = getWrappers();
            if (!list.length) return;
            const clamped = Math.max(0, Math.min(list.length - 1, idx));
            const top = list[clamped]!.offsetTop;
            contentEl.scrollTo({ top, behavior: 'smooth' });
        };
        const currentIndex = (): number => {
            const list = getWrappers();
            if (!list.length) return 0;
            let best = 0; let bestDist = Number.POSITIVE_INFINITY;
            const st = contentEl.scrollTop;
            for (let i = 0; i < list.length; i++) {
                const d = Math.abs(list[i]!.offsetTop - st);
                if (d < bestDist) { bestDist = d; best = i; }
            }
            return best;
        };
        const onWheel = (e: WheelEvent) => {
            if (e.ctrlKey) return; // allow zooming
            e.preventDefault();
            if (scrollLock) return;
            scrollLock = true;
            const dir = e.deltaY > 0 ? 1 : -1;
            const next = currentIndex() + dir;
            scrollToIndex(next);
            setTimeout(() => { scrollLock = false; }, 280);
        };

        sizeToOne();
        contentEl.addEventListener('wheel', onWheel, { passive: false });
        window.addEventListener('resize', sizeToOne);
        // Recalculate when providers render/update
        const mo = new MutationObserver(() => requestAnimationFrame(sizeToOne));
        mo.observe(contentEl, { childList: true, subtree: true });
    })();

    /* add-provider */
    modal.querySelector<HTMLButtonElement>(EXTENSION_SELECTORS.exportAddProviderBtn)!
        .addEventListener('click', () => {
            const name = prompt('Provider name?'); if (!name?.trim()) return;
            const id   = `${name.toLowerCase().replace(/\s+/g,'-')}-${crypto.randomUUID().slice(0,4)}`;
            store.providers.push({ id, name, multi:true, urls: [], defaultUrlId: null });
            saveStore(store).then(() =>
                rebuildSettingsUi(modal.querySelector(EXTENSION_SELECTORS.exportSettingsContent)! as HTMLElement, store));
        });

    /* initial size/position: center within viewport and fit safely */
    try {
        const vw = window.innerWidth || 1280;
        const vh = window.innerHeight || 800;
        const width  = Math.min(920, Math.max(560, vw - 40));
        const height = Math.min(600, Math.max(360, vh - 80));
        modal.style.width = `${Math.round(width)}px`;
        modal.style.height = `${Math.round(height)}px`;
        modal.style.left = `${Math.round((vw - width) / 2)}px`;
        modal.style.top  = `${Math.round(Math.max(40, (vh - height) / 2))}px`;
        console.info('[exportSettings] initial center', { left: modal.style.left, top: modal.style.top, width: modal.style.width, height: modal.style.height });
        // re-center after layout to avoid initial paint offset and then show
        const recenter = () => {
            try {
                const rect = modal.getBoundingClientRect();
                const vw2 = window.innerWidth || 0;
                const vh2 = window.innerHeight || 0;
                let w = rect.width;
                let h = rect.height;
                if (w > vw2 - 40) { w = Math.max(320, vw2 - 40); modal.style.width = `${Math.round(w)}px`; }
                if (h > vh2 - 40) { h = Math.max(240, vh2 - 40); modal.style.height = `${Math.round(h)}px`; }
                const left = Math.round((vw2 - w) / 2);
                const top  = Math.round(Math.max(40, (vh2 - h) / 2));
                modal.style.left = `${Math.max(0, left)}px`;
                modal.style.top  = `${Math.max(0, top)}px`;
                console.info('[exportSettings] recentered', { left: modal.style.left, top: modal.style.top, width: modal.style.width, height: modal.style.height });
            } catch {}
            modal.style.visibility = '';
        };
        requestAnimationFrame(() => requestAnimationFrame(recenter));
    } catch { modal.style.visibility = ''; }

    /* keep within viewport on resize */
    const onWinResize = () => {
        try {
            const rect = modal.getBoundingClientRect();
            const vw = window.innerWidth, vh = window.innerHeight;
            let left = rect.left, top = rect.top;
            let width = rect.width, height = rect.height;
            if (width > vw - 40) { width = Math.max(320, vw - 40); modal.style.width = `${Math.round(width)}px`; }
            if (height > vh - 40) { height = Math.max(240, vh - 40); modal.style.height = `${Math.round(height)}px`; }
            left = Math.max(0, Math.min(vw - width, left));
            top  = Math.max(0, Math.min(vh - 40, top));
            modal.style.left = `${Math.round(left)}px`;
            modal.style.top  = `${Math.round(top)}px`;
        } catch {}
    };
    window.addEventListener('resize', onWinResize);

    /* ask background if an active tab exists → update tiny notice */
    (async () => {
        try {
            const res = await requestMessageSafe<{action:string}, {active:boolean}>(
                { action: 'exportChat.getStatus' }, 'exportSettings.getStatus', { timeoutMs: 5000 },
            );
            if (!res?.active)
                modal.querySelector(EXTENSION_SELECTORS.noActiveTabNotice)!.setAttribute('style','');
        } catch {}
    })();

    /* Placeholders button → open shared manager */
    modal.querySelector<HTMLButtonElement>(EXTENSION_SELECTORS.exportCannedBtn)?.addEventListener('click', async () => {
        try {
            const ephor = await loadEphorStore();
            openCannedPromptModal(ephor);
        } catch (e) {
            console.error('[exportSettings] failed to open Placeholders', e);
            alert('Could not open Placeholders.');
        }
    });

    /* expand/collapse controls removed */
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
        const accItem = h(`<div class="kh-acc-item"></div>`);
        acc.appendChild(accItem);
        // no accordion header (collapse/expand removed)
        const accBody = h(`<div class="kh-acc-body"></div>`);
        accItem.appendChild(accBody);

        const newRow = h(`
          <div class="kh-exp-url-row" style="margin:6px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <input class="${NEW_LABEL_CLASS} kh-exp-input" placeholder="Name" style="flex:0 0 160px;min-width:140px;">
            <input class="${NEW_URL_CLASS} kh-exp-input" placeholder="URL" style="flex:1 1 320px;min-width:220px;">
            <button class="${NEW_ADD_CLASS} kh-btn-primary" style="padding:6px 12px;">Add URL</button>
          </div>
        `);
        accBody.appendChild(newRow);

        /* Search bar */
        const searchRow = h(`
          <div class="kh-exp-search">
            <input class="kh-exp-input ${EXTENSION_SELECTORS.exportSearchInput.slice(1)}" placeholder="Search links by name or URL…">
            <button class="kh-btn ${EXTENSION_SELECTORS.exportSearchClear.replace(/^\./,'')}" title="Clear">✕</button>
          </div>
        `);
        accBody.appendChild(searchRow);

        /* two-column container */
        const twoCol = h(`<div style="display:flex;gap:12px;align-items:flex-start;"></div>`);
        accBody.appendChild(twoCol);
        const listCol = h(`<div style="flex:0 0 320px;min-width:240px;max-height:420px;overflow:auto;display:flex;flex-direction:column;gap:6px;"></div>`);
        const detailCol = h(`<div class="${EXTENSION_SELECTORS.exportDetailPane.slice(1)}" style="flex:1 1 auto;min-width:260px;"></div>`);
        twoCol.appendChild(listCol);
        twoCol.appendChild(detailCol);

        /* url-list container */
        const urlList = h(`<div class="${EXTENSION_SELECTORS.exportUrlList.slice(1)}"></div>`);
        listCol.appendChild(urlList);

        /* Show more button (lazy rendering) */
        const showMoreWrap = h(`<div style="display:flex;justify-content:center;margin:6px 0;">
          <button class="kh-btn ${EXTENSION_SELECTORS.exportShowMoreBtn.replace(/^\./,'')}" style="display:none;">Show more…</button>
        </div>`);
        listCol.appendChild(showMoreWrap);

        // accordion removed: always visible body content

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

        /* ─ URL rows with paging ─ */
        const PAGE_SIZE = 50;
        let shownCount = 0;
        let lastQuery = '';
        let selectedId: string | null = null;

        /* render details for a single URL into the detail pane */
        const renderDetail = (u: UrlEntry | undefined): void => {
            const pane = detailCol as HTMLElement;
            pane.textContent = '';
            if (!u) {
                pane.appendChild(h('<div style="color:#666;font-size:12px;">Select a link on the left to edit its details.</div>'));
                return;
            }

            const group = h('<div class="kh-exp-group"></div>');
            pane.appendChild(group);

            const nameUrlRow = h('<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;"></div>');
            group.appendChild(nameUrlRow);
            const nameInputEl = h(
                `<input class="${EXTENSION_SELECTORS.exportLabelInput.slice(1)} kh-exp-input" value="${u.label}" placeholder="Name" style="flex:0 0 220px;min-width:180px;">`
            ) as HTMLInputElement;
            const urlInputEl = h(
                `<input class="${EXTENSION_SELECTORS.exportUrlInput.slice(1)} kh-exp-input" value="${u.url}" placeholder="URL" style="flex:1 1 420px;min-width:260px;">`
            ) as HTMLInputElement;
            nameUrlRow.appendChild(nameInputEl);
            nameUrlRow.appendChild(urlInputEl);

            const promptHead = h('<div class="kh-exp-row-head"></div>');
            const promptLabel = h('<strong>Prompt</strong>');
            const promptRight = h(`<span class="kh-right">
                <button class="${EXTENSION_SELECTORS.exportSetDefaultUrlBtn.slice(1)} kh-btn" style="background:none;border:1px solid transparent;padding:2px 6px;">
                  ${p.defaultUrlId === u.id ? '✔ Default URL' : 'Make default URL'}
                </button>
                <span class="${EXTENSION_SELECTORS.exportUrlMode.slice(1)}">
                  <label><input type="radio" name="exp-mode-${u.id}" value="new-tab"> New tab</label>
                  <label><input type="radio" name="exp-mode-${u.id}" value="active-tab"> Active tab</label>
                </span>
              </span>`);
            promptHead.appendChild(promptLabel);
            promptHead.appendChild(promptRight);
            group.appendChild(promptHead);

            const promptTextarea = h(
                `<textarea class="${EXTENSION_SELECTORS.exportPromptInput.slice(1)} kh-exp-input"
                  style="width:100%;min-height:120px;resize:vertical;"
                  placeholder="Prompt template (placeholders allowed)">${u.prompt}</textarea>`
            ) as HTMLTextAreaElement;
            group.appendChild(promptTextarea);

            const footerRow = h('<div style="display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:6px;"></div>');
            const delBtn = h(`<button class="${EXTENSION_SELECTORS.exportDelUrlBtn.slice(1)}" style="background:none;border:0;padding:0;cursor:pointer;">Delete URL</button>`) as HTMLButtonElement;
            footerRow.appendChild(delBtn);
            group.appendChild(footerRow);

            /* autosave handlers */
            nameInputEl.addEventListener('change', e => { u.label = (e.target as HTMLInputElement).value; void saveStore(store); });
            urlInputEl .addEventListener('change', e => { u.url   = (e.target as HTMLInputElement).value; void saveStore(store); });
            promptTextarea.addEventListener('change', e => { u.prompt= (e.target as HTMLTextAreaElement).value; void saveStore(store); });

            const modeRadios = group.querySelectorAll<HTMLInputElement>(`input[name="exp-mode-${u.id}"]`);
            modeRadios.forEach(r => { r.checked = r.value === (u.mode ?? 'new-tab'); });
            modeRadios.forEach(r => r.addEventListener('change', () => { u.mode = r.value as ExportMode; void saveStore(store); }));

            group.querySelector<HTMLButtonElement>(EXTENSION_SELECTORS.exportSetDefaultUrlBtn)!
                .addEventListener('click', () => {
                    if (p.defaultUrlId !== u.id) {
                        p.defaultUrlId = u.id;
                        void saveStore(store);
                        renderDetail(u); // refresh button label
                    }
                });

            delBtn.addEventListener('click', () => {
                if (!confirm('Delete this URL?')) return;
                p.urls = p.urls.filter(x => x.id !== u.id);
                if (p.defaultUrlId === u.id) p.defaultUrlId = null;
                autoSetDefaultUrl(p);
                void saveStore(store).then(() => rebuildSettingsUi(target, store));
            });
        };

        const renderRows = (term: string, append = false): void => {
            const q = (term || '').trim().toLowerCase();
            if (!append || q !== lastQuery) {
                urlList.textContent = '';
                shownCount = 0;
                lastQuery = q;
            }
            const items = q ? p.urls.filter(u => u.label.toLowerCase().includes(q) || u.url.toLowerCase().includes(q)) : p.urls;
            const nextEnd = Math.min(items.length, shownCount + PAGE_SIZE);
            console.info('[exportSettings] renderRows', { providerId: p.id, q, total: items.length, from: shownCount, to: nextEnd });
            for (let i = shownCount; i < nextEnd; i++) {
                const u = items[i]!;
                const row = h(`<div class="${EXTENSION_SELECTORS.exportLinkItem.slice(1)}" draggable="true"
                               style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #e5e7f2;border-radius:8px;cursor:pointer;"></div>`);
                row.textContent = u.label;
                (row as HTMLElement).dataset['urlId'] = u.id;
                if (u.id === selectedId) row.classList.add(EXTENSION_SELECTORS.exportLinkItemActive.replace(/^\./,''));
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

                row.addEventListener('click', () => {
                    selectedId = u.id;
                    Array.from(urlList.children).forEach(c => (c as HTMLElement).classList.remove(EXTENSION_SELECTORS.exportLinkItemActive.replace(/^\./,'')));
                    row.classList.add(EXTENSION_SELECTORS.exportLinkItemActive.replace(/^\./,''));
                    renderDetail(u);
                });

                /* Join button hint for Ephor entries: render a status tag in list (optional minimal UI) */
                if (p.id === 'ephor') {
                    const projId = (() => { try { return new URL(u.url).pathname.split('/').pop() || ''; } catch { return ''; } })();
                    const statusTag = h('<span style="margin-left:auto;font-size:11px;color:#666;">…</span>');
                    row.appendChild(statusTag);
                    (async () => {
                        try {
                            const joined = await ensureEphorJoinedIds();
                            statusTag.textContent = joined.has(projId) ? 'Joined' : 'Invite';
                        } catch { statusTag.textContent = ''; }
                    })();
                }
            }
            shownCount = nextEnd;
            const showMoreBtn = showMoreWrap.querySelector<HTMLButtonElement>(EXTENSION_SELECTORS.exportShowMoreBtn)!;
            if (shownCount < items.length) {
                showMoreBtn.style.display = '';
                showMoreBtn.disabled = false;
            } else {
                showMoreBtn.style.display = 'none';
            }
        };

        renderRows('');
        // initialize detail with first item if present
        if (p.urls.length) { selectedId = p.urls[0]!.id; renderDetail(p.urls[0]!); }

        /* Search handlers */
        const searchInput = accBody.querySelector<HTMLInputElement>(EXTENSION_SELECTORS.exportSearchInput)!;
        const searchClear = accBody.querySelector<HTMLButtonElement>(EXTENSION_SELECTORS.exportSearchClear)!;
        const showMoreBtn = accBody.querySelector<HTMLButtonElement>(EXTENSION_SELECTORS.exportShowMoreBtn)!;
        const doFilter = () => renderRows(searchInput.value || '');
        searchInput.addEventListener('input', doFilter);
        searchClear.addEventListener('click', () => { searchInput.value = ''; doFilter(); });
        showMoreBtn.addEventListener('click', () => {
            showMoreBtn.disabled = true;
            renderRows(searchInput.value || '', true);
        });
    }
}
