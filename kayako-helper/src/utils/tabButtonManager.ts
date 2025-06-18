/* utils/tabButtonManager.ts
   Robust tab-strip button manager that:
   • Survives all Kayako header re-renders
   • Never duplicates or flickers the buttons

   2025-06-12 patch 8:
   • 📌 Update label only when it really changed.
   • 📌 Skip “move” if button is already in the correct container.
   • These tweaks eliminate redundant mutations that made the
     buttons flash in DevTools.
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

/* ---------- Agent-dropdown listeners ---------- */
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

/* ---------- Public types ---------- */
export interface TabButtonConfig {
    id: string;
    label: () => string;
    onClick: (btn: HTMLButtonElement) => void;
    onContextMenu?: (ev: MouseEvent, btn: HTMLButtonElement) => void;
    routeTest?: () => boolean;
    onRouteChange?: (btn: HTMLButtonElement | null) => void;
}

/* ---------- Internals ---------- */
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

/* ---------- Public API ---------- */
export function registerTabButton(cfg: TabButtonConfig): void {
    attachAgentTriggerListeners();
    attachDomObserver();

    const ensurePresence = (): void => {
        const container = getOrCreateButtonArea();
        if (!container) {
            cfg.onRouteChange?.(null);
            return;
        }

        /* Locate existing button anywhere in the DOM */
        let btn = document.getElementById(cfg.id) as HTMLButtonElement | null;

        const shouldShow = cfg.routeTest ? cfg.routeTest() : true;

        /* 📌 CHG: only move if not already in correct container */
        if (shouldShow && btn && btn.parentElement !== container) {
            container.appendChild(btn);
        }

        if (shouldShow && !btn) {
            btn = createButton(cfg);
            container.appendChild(btn);
        }

        if (!shouldShow && btn) {
            btn.remove();
            btn = null;
        }

        /* 📌 NEW: update label only when different */
        if (btn) {
            const newLabel = cfg.label();
            if (btn.textContent !== newLabel) btn.textContent = newLabel;
        }

        cfg.onRouteChange?.(btn);
    };

    ensureCallbacks.push(ensurePresence);
    ensurePresence();            // initial run
}
