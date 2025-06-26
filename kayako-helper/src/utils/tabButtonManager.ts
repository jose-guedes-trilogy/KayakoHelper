/* src/utils/tabButtonManager.ts
   Robust tab‑strip button manager that:
   • Survives all Kayako header re‑renders
   • Never duplicates or flickers the buttons

   2025‑06‑12 patch 8 → 2025‑06‑26 patch 9:
   • 📌 Update label only when it really changed.
   • 📌 Skip “move” if button is already in the correct container.
   • 📌 NEW helper `registerSplitTabButton` to register two‑part (split)
     buttons – makes split controls reusable for any module.
*/

import {
    EXTENSION_SELECTORS,
    KAYAKO_SELECTORS,
} from '@/generated/selectors';

const AGENT_TRIGGER_SEL = KAYAKO_SELECTORS.createTicketButtonContainer;
const ensureCallbacks: Array<() => void> = [];

/* ---------- Global DOM observer ---------- */
let domObserverAttached = false;
function attachDomObserver(): void {
    if (domObserverAttached) return;
    domObserverAttached = true;

    let rafScheduled = false;
    const scheduleEnsureAll = (): void => {
        if (rafScheduled) return;
        rafScheduled = true;
        requestAnimationFrame(() => {
            rafScheduled = false;
            ensureCallbacks.forEach(fn => fn());
        });
    };

    const observer = new MutationObserver(scheduleEnsureAll);
    observer.observe(document.body, {
        childList  : true,
        subtree    : true,
        attributes : true,
    });
}

/* ---------- Agent‑dropdown listeners ---------- */
let agentListenersAttached = false;
function attachAgentTriggerListeners(): void {
    if (agentListenersAttached) return;
    agentListenersAttached = true;

    const reAddButtons = () =>
        setTimeout(() => ensureCallbacks.forEach(fn => fn()), 0);

    const handler = (ev: Event): void => {
        const tgt = ev.target;
        if (!(tgt instanceof Element)) return;
        if (tgt.closest(AGENT_TRIGGER_SEL)) reAddButtons();
    };

    document.addEventListener('mousedown',  handler, true);
    document.addEventListener('contextmenu', handler, true);
}

/* ---------- helper to (re)build container ---------- */
function getOrCreateButtonArea(): HTMLElement | null {
    let area = document.querySelector<HTMLElement>(
        EXTENSION_SELECTORS.tabStripCustomButtonArea,
    );
    if (area) return area;

    const tabStrip = document.querySelector<HTMLElement>(
        KAYAKO_SELECTORS.tabStrip,
    );
    if (!tabStrip) return null;

    area = document.createElement('div');
    area.id = EXTENSION_SELECTORS
        .tabStripCustomButtonArea.replace(/^#/, '');
    tabStrip.appendChild(area);
    return area;
}

/* ------------------------------------------------------------------ */
/* Public types – single‑button helper                                */
/* ------------------------------------------------------------------ */
export interface TabButtonConfig {
    id: string;
    label: () => string;
    onClick: (btn: HTMLButtonElement) => void;
    onContextMenu?: (ev: MouseEvent, btn: HTMLButtonElement) => void;
    routeTest?: () => boolean;
    onRouteChange?: (btn: HTMLButtonElement | null) => void;
}

/* ------------------------------------------------------------------ */
/* Internals – single‑button helper                                   */
/* ------------------------------------------------------------------ */
function createButton(cfg: TabButtonConfig): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.id = cfg.id;
    btn.className = EXTENSION_SELECTORS.defaultButtonClass.replace(/^./, '');
    btn.addEventListener('click', () => cfg.onClick(btn));
    if (cfg.onContextMenu) {
        btn.addEventListener('contextmenu', ev => {
            ev.preventDefault();
            cfg.onContextMenu!(ev, btn);
        });
    }
    return btn;
}

/* ------------------------------------------------------------------ */
/* Public API – single‑button helper                                  */
/* ------------------------------------------------------------------ */
export function registerTabButton(cfg: TabButtonConfig): void {
    attachAgentTriggerListeners();
    attachDomObserver();

    const ensurePresence = (): void => {
        const container = getOrCreateButtonArea();
        if (!container) { cfg.onRouteChange?.(null); return; }

        let btn = document.getElementById(cfg.id) as HTMLButtonElement | null;
        const shouldShow = cfg.routeTest ? cfg.routeTest() : true;

        /* ---------- 🠗  only line that changed in patch 8 🠗 ---------- */
        if (shouldShow && btn && !container.contains(btn)) {
            container.appendChild(btn);       // moved only if truly outside
        }
        /* ------------------------------------------------------------- */

        if (shouldShow && !btn) {
            btn = createButton(cfg);
            container.appendChild(btn);
        }

        if (!shouldShow && btn) { btn.remove(); btn = null; }

        if (btn) {
            const newLabel = cfg.label();
            if (btn.textContent !== newLabel) btn.textContent = newLabel;
        }

        cfg.onRouteChange?.(btn);
    };

    ensureCallbacks.push(ensurePresence);
    ensurePresence();
}

/* ================================================================== */
/*                    🔸  NEW  –  Split‑button helper 🔸               */
/* ================================================================== */

export interface SplitTabButtonConfig {
    /** id for the *left‑half* button                               */
    id: string;
    /** label callback for the left‑half button                     */
    label: () => string;
    /** Main‑action click handler (left‑half)                       */
    onClick: (leftBtn: HTMLButtonElement) => void;
    /** Optional context‑menu for left‑half                         */
    onContextMenu?: (ev: MouseEvent, leftBtn: HTMLButtonElement) => void;

    /** Builds (or rebuilds) the dropdown menu each time it’s needed */
    buildMenu: (menuRoot: HTMLElement) => void;

    /** Optional selector for when the control is shown              */
    routeTest?: () => boolean;
    /** Called whenever route causes (dis)appearance                 */
    onRouteChange?: (leftBtn: HTMLButtonElement | null) => void;

    /** Label for the right‑half button (default ▾)                 */
    rightLabel?: string;
    /** right‑half button id (defaults to `${id}__menu`)             */
    rightId?: string;

    /** Hide‑delay (ms) for safe hover, default 120 ms               */
    hideDelayMs?: number;
}

export function registerSplitTabButton(cfg: SplitTabButtonConfig): void {
    attachAgentTriggerListeners();
    attachDomObserver();

    const WRAP_ID   = `${cfg.id}__wrap`;
    const RIGHT_ID  = cfg.rightId ?? `${cfg.id}__menu`;
    const hideDelay = cfg.hideDelayMs ?? 120;

    const ensurePresence = (): void => {
        const container = getOrCreateButtonArea();
        if (!container) { cfg.onRouteChange?.(null); return; }

        /* ---------- wrapper ---------- */
        let wrap = document.getElementById(WRAP_ID) as HTMLSpanElement | null;
        const shouldShow = cfg.routeTest ? cfg.routeTest() : true;

        if (!shouldShow && wrap) { wrap.remove(); wrap = null; cfg.onRouteChange?.(null); return; }
        if (!shouldShow) { cfg.onRouteChange?.(null); return; }

        if (!wrap) {
            wrap = document.createElement('span');
            wrap.id = WRAP_ID;
            wrap.className = EXTENSION_SELECTORS.twoPartBtnParentElement.slice(1);
            wrap.style.display = 'inline-flex';
            wrap.style.position = 'relative';
            container.appendChild(wrap);
        } else if (!container.contains(wrap)) {
            container.appendChild(wrap);
        }

        /* ---------- left‑half button ---------- */
        let leftBtn = document.getElementById(cfg.id) as HTMLButtonElement | null;
        if (!leftBtn) {
            leftBtn = document.createElement('button');
            leftBtn.id = cfg.id;
            leftBtn.className = [
                EXTENSION_SELECTORS.defaultButtonClass.replace(/^./, ''),
                EXTENSION_SELECTORS.twoPartBtnLeftHalf.slice(1),
            ].join(' ');
            leftBtn.addEventListener('click', () => cfg.onClick(leftBtn!));
            if (cfg.onContextMenu) {
                leftBtn.addEventListener('contextmenu', ev => {
                    ev.preventDefault();
                    cfg.onContextMenu!(ev, leftBtn!);
                });
            }
            wrap.appendChild(leftBtn);
        }

        /* ---------- right‑half button ---------- */
        let rightBtn = document.getElementById(RIGHT_ID) as HTMLButtonElement | null;
        if (!rightBtn) {
            rightBtn = document.createElement('button');
            rightBtn.id = RIGHT_ID;
            rightBtn.textContent = cfg.rightLabel ?? '▾';
            rightBtn.className = [
                EXTENSION_SELECTORS.defaultButtonClass.replace(/^./, ''),
                EXTENSION_SELECTORS.twoPartBtnRightHalf.slice(1),
                leftBtn.className,              // keep ext‑specific theme classes
            ].join(' ');
            rightBtn.style.minWidth = '24px';
            rightBtn.style.padding  = '0 6px';
            wrap.appendChild(rightBtn);

            /* --- dropdown container --- */
            const menu = document.createElement('div');
            menu.className = EXTENSION_SELECTORS.twoPartBtnDropdown.slice(1);
            menu.style.cssText = [
                'position:absolute',
                'left:0',
                'top:100%',
                'z-index:2147483647',
                'display:none',
            ].join(';');
            rightBtn.appendChild(menu);

            /* safe‑hover helpers */
            let hideTo: number | null = null;
            const show = () => { if (hideTo) {clearTimeout(hideTo); hideTo=null;} menu.style.display='block'; };
            const hide = ()  => { hideTo = window.setTimeout(()=>{menu.style.display='none';}, hideDelay); };

            rightBtn.addEventListener('mouseenter', show);
            rightBtn.addEventListener('mouseleave', hide);
            menu.addEventListener('mouseenter',  show);
            menu.addEventListener('mouseleave',  hide);
        }

        /* keep DOM order: left, right */
        if (wrap.firstChild !== leftBtn) wrap.insertBefore(leftBtn, wrap.firstChild);
        if (leftBtn.nextSibling !== rightBtn) wrap.appendChild(rightBtn!);

        /* update labels */
        const newLabel = cfg.label();
        if (leftBtn.textContent !== newLabel) leftBtn.textContent = newLabel;

        /* (re)build dropdown */
        const dropdown = rightBtn!.querySelector<HTMLElement>(
            EXTENSION_SELECTORS.twoPartBtnDropdown,
        )!;
        cfg.buildMenu(dropdown);

        cfg.onRouteChange?.(leftBtn);
    };

    ensureCallbacks.push(ensurePresence);
    ensurePresence();
}
