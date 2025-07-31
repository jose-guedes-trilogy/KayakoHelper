/* src/utils/buttonManager.ts – v10 (2025-07-16)
   ════════════════════════════════════════════════════════════════════
   Unified Button Manager
   • Tab-strip buttons  (single + split)      → registerButton(…)
   • Editor-header buttons (single + split)   → registerEditorHeaderButton(…)
   • One global MutationObserver keeps everything alive.
   • Shared grouping, flicker-free updates, idempotent insertion.
*/

import {
    EXTENSION_SELECTORS,
    KAYAKO_SELECTORS,
} from '@/generated/selectors.ts';

/* ================================================================== */
/*                   0 ▸ global observer & helpers                    */
/* ================================================================== */

const ensureCallbacks: Array<() => void> = [];

let domObserverAttached = false;
function attachDomObserver(): void {
    if (domObserverAttached) return;
    domObserverAttached = true;

    let rafScheduled = false;
    const scheduleEnsures = (): void => {
        if (rafScheduled) return;
        rafScheduled = true;
        requestAnimationFrame(() => {
            rafScheduled = false;
            ensureCallbacks.forEach(fn => fn());
        });
    };

    const obs = new MutationObserver(scheduleEnsures);
    obs.observe(document.body, { childList: true, subtree: true, attributes: true });
}

/* ================================================================== */
/*                         1 ▸ TAB-STRIP AREA                         */
/* ================================================================== */
/* ---------- agent-dropdown listeners: Kayako rebuilds header on     */
/*           every brand/team switch, so we re-run ensure callbacks.  */
const AGENT_TRIGGER_SEL = KAYAKO_SELECTORS.createTicketButtonContainer;
let agentListenersAttached = false;
function attachAgentTriggerListeners(): void {
    if (agentListenersAttached) return;
    agentListenersAttached = true;

    const reAddButtons = () => setTimeout(() => ensureCallbacks.forEach(fn => fn()), 0);
    const handler = (ev: Event): void => {
        const tgt = ev.target as Element | null;
        if (tgt?.closest(AGENT_TRIGGER_SEL)) reAddButtons();
    };
    document.addEventListener('mousedown',  handler, true);
    document.addEventListener('contextmenu', handler, true);
}

/* ---------- container + group helpers ----------------------------- */
function getOrCreateButtonArea(): HTMLElement | null {
    const conv = document.querySelector<HTMLElement>(
        KAYAKO_SELECTORS.conversationWindowContainer,
    );
    if (!conv) return null;

    let area = document.querySelector<HTMLElement>(
        EXTENSION_SELECTORS.tabStripCustomButtonArea,
    );

    if (area && area.parentElement !== conv) { area.remove(); area = null; }

    if (!area) {
        area = document.createElement('div');
        area.id = EXTENSION_SELECTORS.tabStripCustomButtonArea.replace(/^#/, '');
    }

    if (conv.children[1] !== area) {
        if (conv.children.length >= 1) conv.insertBefore(area, conv.children[1]);
        else                           conv.appendChild(area);
    }
    return area;
}

const BUTTON_GROUP_CLASS = EXTENSION_SELECTORS
    .tabStripCustomButtonAreaGroup.replace(/^./, '');

function getOrCreateGroupArea(
    groupId?: string, groupOrder?: number,
): HTMLElement | null {
    const root = getOrCreateButtonArea();
    if (!root || !groupId) return root;

    let group = root.querySelector<HTMLElement>(`[data-group-id="${groupId}"]`);
    if (!group) {
        group = document.createElement('span');
        group.dataset.groupId    = groupId;
        group.dataset.groupOrder = String(groupOrder ?? '');
        group.className          = BUTTON_GROUP_CLASS;

        if (groupOrder !== undefined) {
            const before = Array.from(root.querySelectorAll<HTMLElement>('[data-group-id]'))
                .find(g => {
                    const o = Number(g.dataset.groupOrder);
                    return !Number.isNaN(o) && o > groupOrder;
                });
            root.insertBefore(group, before as Node ?? null);
        } else root.appendChild(group);
    } else if (group.parentElement !== root) root.appendChild(group);

    return group;
}

/* ---------- single-tab-button API --------------------------------- */
export interface buttonConfig {
    id: string;
    label: () => string;
    onClick: (btn: HTMLButtonElement) => void;
    onContextMenu?: (ev: MouseEvent, btn: HTMLButtonElement) => void;
    routeTest?: () => boolean;
    onRouteChange?: (btn: HTMLButtonElement | null) => void;
    groupId?: string;
    groupOrder?: number;
}

function createButton(cfg: buttonConfig): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.id        = cfg.id;
    btn.className = EXTENSION_SELECTORS.defaultButtonClass.replace(/^./,'');
    btn.addEventListener('click', () => cfg.onClick(btn));
    if (cfg.onContextMenu) {
        btn.addEventListener('contextmenu', ev => {
            ev.preventDefault(); cfg.onContextMenu!(ev, btn);
        });
    }
    return btn;
}

export function registerButton(cfg: buttonConfig): void {
    attachDomObserver(); attachAgentTriggerListeners();

    const ensure = (): void => {
        const box = getOrCreateGroupArea(cfg.groupId, cfg.groupOrder);
        if (!box) { cfg.onRouteChange?.(null); return; }

        let btn = document.getElementById(cfg.id) as HTMLButtonElement | null;
        const visible = cfg.routeTest ? cfg.routeTest() : true;

        if (visible && btn && !box.contains(btn)) box.appendChild(btn);
        if (visible && !btn) { btn = createButton(cfg); box.appendChild(btn); }
        if (!visible && btn) { btn.remove(); btn = null; }

        if (btn) {
            const newLabel = cfg.label();
            if (btn.textContent !== newLabel) btn.textContent = newLabel;
        }
        cfg.onRouteChange?.(btn ?? null);
    };

    ensureCallbacks.push(ensure); ensure();
}

/* ---------- split-tab-button API ---------------------------------- */
export interface SplitButtonConfig {
    id: string;                     // left-half id
    label: () => string;            // left-half label
    onClick: (left: HTMLButtonElement) => void;
    onContextMenu?: (ev: MouseEvent, left: HTMLButtonElement) => void;
    buildMenu: (menu: HTMLElement) => void;
    rightLabel?: string;
    rightId?: string;
    hideDelayMs?: number;
    routeTest?: () => boolean;
    onRouteChange?: (leftBtn: HTMLButtonElement | null) => void;
    groupId?: string;
    groupOrder?: number;
}

export function registerSplitButton(cfg: SplitButtonConfig): void {
    attachDomObserver(); attachAgentTriggerListeners();

    const WRAP_ID  = `${cfg.id}__wrap`;
    const RIGHT_ID = cfg.rightId ?? `${cfg.id}__menu`;
    const HOVER_MS = cfg.hideDelayMs ?? 120;

    const ensure = (): void => {
        const box = getOrCreateGroupArea(cfg.groupId, cfg.groupOrder);
        if (!box) { cfg.onRouteChange?.(null); return; }

        let wrap = document.getElementById(WRAP_ID) as HTMLSpanElement | null;
        const visible = cfg.routeTest ? cfg.routeTest() : true;

        if (!visible && wrap) { wrap.remove(); wrap = null; cfg.onRouteChange?.(null); return; }
        if (!visible) { cfg.onRouteChange?.(null); return; }

        if (!wrap) {
            wrap = document.createElement('span');
            wrap.id = WRAP_ID;
            wrap.className = EXTENSION_SELECTORS.twoPartBtnParentElement.slice(1);
            box.appendChild(wrap);
        } else if (!box.contains(wrap)) box.appendChild(wrap);

        /* left button */
        let left = document.getElementById(cfg.id) as HTMLButtonElement | null;
        if (!left) {
            left = document.createElement('button');
            left.id = cfg.id;
            left.className = [
                EXTENSION_SELECTORS.defaultButtonClass.replace(/^./,''),
                EXTENSION_SELECTORS.twoPartBtnLeftHalf.slice(1),
            ].join(' ');
            left.addEventListener('click', () => cfg.onClick(left!));
            if (cfg.onContextMenu) {
                left.addEventListener('contextmenu', ev => {
                    ev.preventDefault(); cfg.onContextMenu!(ev, left!);
                });
            }
            wrap.appendChild(left);
        }

        /* right button + dropdown */
        let right = document.getElementById(RIGHT_ID) as HTMLButtonElement | null;
        if (!right) {
            right = document.createElement('button');
            right.id = RIGHT_ID.replace(/^#/, '');
            right.className = [
                EXTENSION_SELECTORS.defaultButtonClass.replace(/^./,''),
                EXTENSION_SELECTORS.twoPartBtnRightHalf.slice(1),
            ].join(' ');
            right.innerHTML = `<div class="${EXTENSION_SELECTORS
                .twoPartBtnChevron.replace(/^./,'')}">${cfg.rightLabel ?? '▾'}</div>`;
            wrap.appendChild(right);

            const menu = document.createElement('div');
            menu.className = EXTENSION_SELECTORS.twoPartBtnDropdown.slice(1);
            Object.assign(menu.style, {
                position:'absolute', left:'0', top:'100%', zIndex:'2147483647',
                display:'none',
            });
            right.appendChild(menu);

            let to: number | null = null;
            const show = () => { if (to) { clearTimeout(to); to = null; } menu.style.display='flex'; };
            const hide = () => { to = window.setTimeout(()=>{ menu.style.display='none'; }, HOVER_MS); };

            right.addEventListener('mouseenter', show);
            right.addEventListener('mouseleave', hide);
            menu .addEventListener('mouseenter', show);
            menu .addEventListener('mouseleave', hide);
        }

        /* order-fix */
        if (wrap.firstChild !== left)  wrap.insertBefore(left!, wrap.firstChild);
        if (left!.nextSibling !== right) wrap.appendChild(right!);

        /* label update */
        const txt = cfg.label();
        if (left!.textContent !== txt) left!.textContent = txt;

        /* build / rebuild dropdown */
        const dropdown = right!.querySelector<HTMLElement>(
            EXTENSION_SELECTORS.twoPartBtnDropdown,
        )!;
        cfg.buildMenu(dropdown);

        cfg.onRouteChange?.(left);
    };

    ensureCallbacks.push(ensure); ensure();
}

/* ================================================================== */
/*                    2 ▸ EDITOR-HEADER CONTROLS                      */
/* ================================================================== */

/* ---------- slot enum (0-based index in header.children) ----------- */
export enum HeaderSlot { FIRST=0, SECOND=1, THIRD=2, AFTER_LAST=9999 }

/* ---------- config types ------------------------------------------ */
interface BaseHeaderCfg {
    id: string;
    type: 'simple' | 'split';
    slot: HeaderSlot;
    label: string | (() => string);
    onClick: (btn: HTMLButtonElement) => void | Promise<void>;
    onContextMenu?: (ev: MouseEvent, btn: HTMLButtonElement) => void;
}
export interface SimpleHeaderButtonCfg extends BaseHeaderCfg { type:'simple' }
export interface SplitHeaderButtonCfg  extends BaseHeaderCfg {
    type:'split';
    rightId: string;
    rightLabel: string;
    buildMenu: (menu: HTMLElement) => void;
    hideDelayMs?: number;
}
type HeaderCfg = SimpleHeaderButtonCfg | SplitHeaderButtonCfg;

/* ---------- implementation ---------------------------------------- */
export function registerEditorHeaderButton(cfg: HeaderCfg): void {
    attachDomObserver();          // reuse global observer

    const ensure = (): void => {
        document.querySelectorAll<HTMLElement>(
            KAYAKO_SELECTORS.textEditorHeader,
        ).forEach(header => {
            /* wrapper lookup / creation */
            const existingWrap = header.querySelector<HTMLElement>(
                `[data-kh-wrap="${cfg.id}"]`,
            );
            let wrap = existingWrap;
            if (!wrap) {
                wrap = document.createElement('div');
                wrap.dataset.khWrap = cfg.id;
                wrap.style.cssText = 'display:flex;align-items:center;';
                /* slot insertion */
                if (cfg.slot === HeaderSlot.AFTER_LAST ||
                    cfg.slot >= header.children.length) {
                    header.appendChild(wrap);
                } else {
                    header.insertBefore(wrap, header.children[cfg.slot]);
                }
            }

            /* if simple */
            if (cfg.type === 'simple') {
                let btn = wrap.querySelector<HTMLElement>(`${cfg.id}`) as HTMLButtonElement | null;
                if (!btn) {
                    btn = createHeaderBtn(cfg.id, cfg.label);
                    btn.addEventListener('click', () => cfg.onClick(btn!));
                    if (cfg.onContextMenu) {
                        btn.addEventListener('contextmenu', ev => {
                            ev.preventDefault(); cfg.onContextMenu!(ev, btn!);
                        });
                    }
                    wrap.appendChild(btn);
                } else {
                    const newLabel = typeof cfg.label==='function' ? cfg.label() : cfg.label;
                    if (btn.textContent !== newLabel) btn.textContent = newLabel;
                }
                return; // simple done
            }

            /* split variant */
            const sCfg = cfg as SplitHeaderButtonCfg;
            const RIGHT_ID = sCfg.rightId;
            let left = wrap.querySelector<HTMLButtonElement>(`${cfg.id}`);
            let right = wrap.querySelector<HTMLButtonElement>(`${RIGHT_ID}`);

            if (!left) {
                left = createHeaderBtn(cfg.id, cfg.label);
                left.classList.add(EXTENSION_SELECTORS.twoPartBtnLeftHalf.slice(1));
                left.addEventListener('click', () => sCfg.onClick(left!));
                if (sCfg.onContextMenu) {
                    left.addEventListener('contextmenu', ev=>{
                        ev.preventDefault(); sCfg.onContextMenu!(ev,left!);
                    });
                }
                wrap.appendChild(left);
            } else {
                const newLabel = typeof cfg.label==='function' ? cfg.label() : cfg.label;
                if (left.textContent !== newLabel) left.textContent = newLabel;
            }

            if (!right) {
                right = createHeaderBtn(RIGHT_ID, sCfg.rightLabel);
                right.classList.add(EXTENSION_SELECTORS.twoPartBtnRightHalf.slice(1));
                wrap.appendChild(right);

                const menu = document.createElement('div');
                menu.className = EXTENSION_SELECTORS.twoPartBtnDropdownSub.slice(1);
                menu.style.display = 'none';
                right.appendChild(menu);

                let hideTo: number|null = null;
                const delay = sCfg.hideDelayMs ?? 250;
                const show = () => { if (hideTo){clearTimeout(hideTo);hideTo=null;} menu.style.display='flex'; };
                const hide = () => { hideTo = window.setTimeout(()=>{menu.style.display='none';}, delay); };

                right.addEventListener('mouseenter',show);
                right.addEventListener('mouseleave',hide);
                menu .addEventListener('mouseenter',show);
                menu .addEventListener('mouseleave',hide);
            }

            /* rebuild dropdown every cycle */
            const menuDiv = right!.querySelector<HTMLElement>(
                `.${EXTENSION_SELECTORS.twoPartBtnDropdownSub.replace(/^./,'')}`
            )!;
            sCfg.buildMenu(menuDiv);
        });
    };

    ensureCallbacks.push(ensure); ensure();
}

/* tiny creator shared by both variants */
function createHeaderBtn(id: string, lbl: string | (()=>string)): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.id        = id.replace(/^#/, '');
    btn.type      = 'button';
    btn.className = EXTENSION_SELECTORS.defaultButtonClass.replace(/^./,'');
    btn.textContent = typeof lbl==='function' ? lbl() : lbl;
    return btn;
}
