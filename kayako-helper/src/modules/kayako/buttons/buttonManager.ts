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

/* Cache-aware HTML setter to avoid infinite reflows / blinking */
function setHtmlIfChanged(el: HTMLElement, html: string): void {
    const key = '__khHtmlSig';
    // @ts-expect-error – augmenting element with a private cache
    if (el[key] === html) return;
    el.innerHTML = html;
    // @ts-expect-error
    el[key] = html;
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
        if (conv.children.length >= 1) conv.insertBefore(area, conv.children[1] ?? null);
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
        group.dataset['groupId']    = groupId;
        group.dataset['groupOrder'] = String(groupOrder ?? '');
        group.className          = BUTTON_GROUP_CLASS;

        if (groupOrder !== undefined) {
            const before = Array.from(root.querySelectorAll<HTMLElement>('[data-group-id]'))
                .find(g => {
                    const o = Number(g.dataset['groupOrder']);
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
    btn.addEventListener('click', (ev: MouseEvent) => {
        ev.stopPropagation();            // prevent host UI from swallowing our click
        cfg.onClick(btn);
    });
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
            setHtmlIfChanged(btn, newLabel);   // HTML-aware & stable
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
            /* Fire only on left-button mouseup to avoid accidental drags and to
               comply with UX requirement to activate on release. */
            left.addEventListener('mouseup', (ev) => {
                if ((ev as MouseEvent).button !== 0) return;
                ev.stopPropagation();
                cfg.onClick(left!);
            });
            // Prevent default click activation to avoid double-fire on some UIs
            left.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); });
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

            /* Render dropdown in a fixed-position portal attached to body to
               avoid clipping and layout feedback loops. */
            const menu = document.createElement('div');
            menu.className = EXTENSION_SELECTORS.twoPartBtnDropdown.slice(1);
            Object.assign(menu.style, {
                position: 'fixed',
                left: '0px',
                top: '0px',
                zIndex: '2147483647',
                display: 'none',
                width: 'max-content',
            } as Partial<CSSStyleDeclaration>);
            menu.dataset['khAnchor'] = right.id;
            document.body.appendChild(menu);

            let to: number | null = null;
            let outsideDownAttached = false;
            const updateMenuPosition = () => {
                const rect = right!.getBoundingClientRect();
                // Temporarily reveal to measure size
                const prevDisplay = menu.style.display;
                const prevVisibility = menu.style.visibility;
                menu.style.visibility = 'hidden';
                menu.style.display = 'flex';
                const menuWidth = menu.offsetWidth;
                const menuHeight = menu.offsetHeight;
                const margin = 8;
                let left = rect.right - menuWidth; // align right edges
                let top  = rect.bottom;            // open downward by default
                // Clamp within viewport
                if (left < margin) left = margin;
                const maxLeft = Math.max(margin, window.innerWidth - menuWidth - margin);
                if (left > maxLeft) left = maxLeft;
                // If bottom overflows, try opening upwards
                if (top + menuHeight + margin > window.innerHeight) {
                    const upTop = rect.top - menuHeight;
                    if (upTop >= margin) top = upTop;
                }
                menu.style.left = `${Math.round(left)}px`;
                menu.style.top  = `${Math.round(top)}px`;
                // Restore visibility state
                if (prevDisplay === 'none') {
                    menu.style.display = prevDisplay;
                    menu.style.visibility = prevVisibility || '';
                } else {
                    menu.style.visibility = '';
                }
            };
            const onOutsidePointerDown = (ev: Event) => {
                const target = (ev as MouseEvent | TouchEvent).target as Node | null;
                if (!target) return;
                if (menu.contains(target) || right!.contains(target as Node)) return;
                menu.style.display = 'none';
                if (outsideDownAttached) {
                    window.removeEventListener('mousedown', onOutsidePointerDown, true);
                    window.removeEventListener('touchstart', onOutsidePointerDown, true);
                    outsideDownAttached = false;
                }
            };
            const show = () => {
                if (to) { clearTimeout(to); to = null; }
                menu.style.display='flex';
                updateMenuPosition();
                if (!outsideDownAttached) {
                    window.addEventListener('mousedown', onOutsidePointerDown, true);
                    window.addEventListener('touchstart', onOutsidePointerDown, true);
                    outsideDownAttached = true;
                }
            };
            const hide = () => {
                to = window.setTimeout(()=>{
                    menu.style.display='none';
                    if (outsideDownAttached) {
                        window.removeEventListener('mousedown', onOutsidePointerDown, true);
                        window.removeEventListener('touchstart', onOutsidePointerDown, true);
                        outsideDownAttached = false;
                    }
                }, HOVER_MS);
            };

            right.addEventListener('mouseenter', show);
            right.addEventListener('mouseleave', hide);
            menu .addEventListener('mouseenter', show);
            menu .addEventListener('mouseleave', hide);
            const onScrollOrResize = () => { if (menu.style.display !== 'none') updateMenuPosition(); };
            window.addEventListener('scroll', onScrollOrResize, true);
            window.addEventListener('resize', onScrollOrResize);
        }

        /* order-fix */
        if (wrap.firstChild !== left)  wrap.insertBefore(left!, wrap.firstChild);
        if (left!.nextSibling !== right) wrap.appendChild(right!);

        /* label update (left) */
        const txt = cfg.label();
        setHtmlIfChanged(left!, txt);     // HTML-aware & stable

        /* build dropdown once to avoid MutationObserver feedback loops */
        const dropdown = document.querySelector<HTMLElement>(
            `.${EXTENSION_SELECTORS.twoPartBtnDropdown.replace(/^./,'')}[data-kh-anchor="${right!.id}"]`
        )!;
        if (dropdown.childElementCount === 0) cfg.buildMenu(dropdown);

        /* cleanup orphaned portaled menus */
        const dropdownClass = EXTENSION_SELECTORS.twoPartBtnDropdown.replace(/^./,'');
        document.querySelectorAll<HTMLElement>(`.${dropdownClass}[data-kh-anchor]`).forEach(el => {
            const anchorId = el.dataset['khAnchor'];
            if (anchorId && !document.getElementById(anchorId)) el.remove();
        });

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
    label: string | ((header: HTMLElement) => string);
    onClick: (btn: HTMLButtonElement) => void | Promise<void>;
    onContextMenu?: (ev: MouseEvent, btn: HTMLButtonElement) => void;
    /* Optional filter to decide which editor headers should host this control */
    headerFilter?: (headerEl: HTMLElement) => boolean;
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
            /* If a filter is provided and this header is not accepted, ensure any
               previous wrapper for this control is removed and skip. */
            if (cfg.headerFilter && !cfg.headerFilter(header)) {
                const existing = header.querySelector<HTMLElement>(
                    `[data-kh-wrap="${cfg.id}"]`,
                );
                if (existing) existing.remove();
                return;
            }
            /* wrapper lookup / creation */
            const existingWrap = header.querySelector<HTMLElement>(
                `[data-kh-wrap="${cfg.id}"]`,
            );
            let wrap = existingWrap;
            if (!wrap) {
                wrap = document.createElement('div');
                wrap.dataset['khWrap'] = cfg.id;
                wrap.style.cssText = 'display:flex;align-items:center;';
                /* slot insertion */
                if (cfg.slot === HeaderSlot.AFTER_LAST ||
                    cfg.slot >= header.children.length) {
                    header.appendChild(wrap);
                } else {
                    header.insertBefore(wrap, header.children[cfg.slot] ?? null);
                }
            }

            /* if simple */
            if (cfg.type === 'simple') {
                let btn = wrap.querySelector<HTMLElement>(`${cfg.id}`) as HTMLButtonElement | null;
                if (!btn) {
                    btn = createHeaderBtn(cfg.id, cfg.label, header);
                    btn.addEventListener('click', () => cfg.onClick(btn!));
                    if (cfg.onContextMenu) {
                        btn.addEventListener('contextmenu', ev => {
                            ev.preventDefault(); cfg.onContextMenu!(ev, btn!);
                        });
                    }
                    wrap.appendChild(btn);
                } else {
                    const newLabel = typeof cfg.label==='function' ? cfg.label(header) : cfg.label;
                    setHtmlIfChanged(btn, newLabel);    // HTML-aware & stable
                }
                return; // simple done
            }

            /* split variant */
            const sCfg = cfg as SplitHeaderButtonCfg;
            const RIGHT_ID = sCfg.rightId;
            let left = wrap.querySelector<HTMLButtonElement>(`${cfg.id}`);
            let right = wrap.querySelector<HTMLButtonElement>(`${RIGHT_ID}`);

            if (!left) {
                left = createHeaderBtn(cfg.id, cfg.label, header);
                left.classList.add(EXTENSION_SELECTORS.twoPartBtnLeftHalf.slice(1));
                left.addEventListener('click', () => sCfg.onClick(left!));
                if (sCfg.onContextMenu) {
                    left.addEventListener('contextmenu', ev=>{
                        ev.preventDefault(); sCfg.onContextMenu!(ev,left!);
                    });
                }
                wrap.appendChild(left);
            } else {
                const newLabel = typeof cfg.label==='function' ? cfg.label(header) : cfg.label;
                setHtmlIfChanged(left, newLabel);       // HTML-aware & stable
            }

            if (!right) {
                right = createHeaderBtn(RIGHT_ID, sCfg.rightLabel, header);
                right.classList.add(EXTENSION_SELECTORS.twoPartBtnRightHalf.slice(1));
                // Anchor dropdown to the right-half, and render a chevron similar to Export Chat
                right.style.position = 'relative';
                right.innerHTML = `<div class="${EXTENSION_SELECTORS.twoPartBtnChevron.replace(/^./,'')}">${sCfg.rightLabel}</div>`;
                wrap.appendChild(right);

                const menu = document.createElement('div');
                menu.className = EXTENSION_SELECTORS.twoPartBtnDropdown.slice(1);
                menu.style.display = 'none';
                // Render in a portal to avoid clipping by overflow:hidden ancestors
                // Use fixed positioning relative to the viewport
                Object.assign(menu.style, {
                    position: 'fixed',
                    left: '0px',
                    top: '0px',
                    right: 'auto',
                    bottom: 'auto',
                    width: 'max-content',
                    zIndex: '2147483647',
                } as Partial<CSSStyleDeclaration>);
                // Anchor id for rebuilds/cleanup
                menu.dataset['khAnchor'] = right.id;
                document.body.appendChild(menu);

                let hideTo: number|null = null;
                const delay = sCfg.hideDelayMs ?? 250;
                const updateMenuPosition = () => {
                    const rect = right!.getBoundingClientRect();
                    // Show below the right-half; align right edges; keep on-screen
                    // Temporarily make visible to measure width/height
                    const prevDisplay = menu.style.display;
                    const prevVisibility = menu.style.visibility;
                    menu.style.visibility = 'hidden';
                    menu.style.display = 'flex';
                    const menuWidth = menu.offsetWidth;
                    const menuHeight = menu.offsetHeight;
                    const margin = 8;
                    let left = rect.right - menuWidth;
                    let top  = rect.bottom;
                    // Clamp horizontally
                    if (left < margin) left = margin;
                    const maxLeft = Math.max(margin, window.innerWidth - menuWidth - margin);
                    if (left > maxLeft) left = maxLeft;
                    // If bottom overflows, try opening upwards
                    if (top + menuHeight + margin > window.innerHeight) {
                        const upTop = rect.top - menuHeight;
                        if (upTop >= margin) top = upTop;
                    }
                    menu.style.left = `${Math.round(left)}px`;
                    menu.style.top  = `${Math.round(top)}px`;
                    console.debug('[KH][HeaderSplit] dropdown positioned', { left: menu.style.left, top: menu.style.top, menuWidth, menuHeight });
                    // Restore visibility state if we only measured
                    if (prevDisplay === 'none') {
                        menu.style.display = prevDisplay;
                        menu.style.visibility = prevVisibility || '';
                    } else {
                        menu.style.visibility = '';
                    }
                };
                const onScrollOrResize = () => { if (menu.style.display !== 'none') updateMenuPosition(); };
                const onOutsidePointerDown = (ev: Event) => {
                    const e = ev as MouseEvent | TouchEvent;
                    const target = (e as MouseEvent).target as Node | null;
                    if (!target) return;
                    // If clicking inside the menu or on the right button, ignore
                    if (menu.contains(target) || right!.contains(target as Node)) return;
                    menu.style.display = 'none';
                };
                const show = () => {
                    if (hideTo){clearTimeout(hideTo);hideTo=null;}
                    menu.style.display='flex';
                    updateMenuPosition();
                    window.addEventListener('mousedown', onOutsidePointerDown, true);
                    window.addEventListener('touchstart', onOutsidePointerDown, true);
                    console.info('[KH][HeaderSplit] dropdown show');
                };
                const hide = () => { hideTo = window.setTimeout(()=>{menu.style.display='none';}, delay); };
                const toggle = () => {
                    if (hideTo) { clearTimeout(hideTo); hideTo = null; }
                    const visible = menu.style.display !== 'none';
                    const next = visible ? 'none' : 'flex';
                    console.info('[KH][HeaderSplit] right-half toggle', { visible: !visible });
                    menu.style.display = next;
                    if (next !== 'none') updateMenuPosition();
                    if (next === 'none') {
                        window.removeEventListener('mousedown', onOutsidePointerDown, true);
                        window.removeEventListener('touchstart', onOutsidePointerDown, true);
                    } else {
                        window.addEventListener('mousedown', onOutsidePointerDown, true);
                        window.addEventListener('touchstart', onOutsidePointerDown, true);
                    }
                };

                right.addEventListener('mouseenter',show);
                right.addEventListener('mouseleave',hide);
                menu .addEventListener('mouseenter',show);
                menu .addEventListener('mouseleave',hide);
                right.addEventListener('click', (ev) => {
                    if ((ev as MouseEvent).button !== 0) return; // left-click only
                    ev.preventDefault(); ev.stopPropagation(); toggle();
                });
                right.addEventListener('contextmenu', (ev) => { ev.stopPropagation(); });
                window.addEventListener('scroll', onScrollOrResize, true);
                window.addEventListener('resize', onScrollOrResize);
            }

            /* rebuild dropdown every cycle */
            const menuDiv = document.querySelector<HTMLElement>(
                `.${EXTENSION_SELECTORS.twoPartBtnDropdown.replace(/^./,'')}[data-kh-anchor="${right!.id}"]`
            )!;
            // Build once to avoid MutationObserver feedback loops causing flicker
            if (menuDiv.childElementCount === 0) {
                sCfg.buildMenu(menuDiv);
            }
        });
        // Cleanup orphaned portaled menus whose anchors are gone
        const dropdownClass = EXTENSION_SELECTORS.twoPartBtnDropdown.replace(/^./,'');
        document.querySelectorAll<HTMLElement>(`.${dropdownClass}[data-kh-anchor]`).forEach(el => {
            const anchorId = el.dataset['khAnchor'];
            if (anchorId && !document.getElementById(anchorId)) {
                el.remove();
            }
        });
    };

    ensureCallbacks.push(ensure); ensure();
}

/* tiny creator shared by both variants */
function createHeaderBtn(
    id: string,
    lbl: string | ((header: HTMLElement) => string),
    header: HTMLElement,
): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.id        = id.replace(/^#/, '');
    btn.type      = 'button';
    btn.className = EXTENSION_SELECTORS.defaultButtonClass.replace(/^./,'');
    const html = typeof lbl==='function' ? lbl(header) : lbl;
    setHtmlIfChanged(btn, html);   // initial cache
    return btn;
}
