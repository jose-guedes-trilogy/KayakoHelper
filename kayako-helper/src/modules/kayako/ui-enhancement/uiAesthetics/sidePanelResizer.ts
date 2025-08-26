import { KAYAKO_SELECTORS } from '@/generated/selectors.ts';

interface DragState {
    isDragging: boolean;
    startX: number;
    startWidth: number;
    containerRect?: DOMRect;
}

const dragState: DragState = {
    isDragging: false,
    startX: 0,
    startWidth: 0,
};

const RESIZER_CLASS = 'kh-side-resizer';
const STORAGE_KEY = 'khSidePanelWidthPx';

function createResizerHandle(): HTMLDivElement {
    const handle = document.createElement('div');
    handle.className = RESIZER_CLASS;
    handle.style.cssText = [
        'position: absolute',
        'top: 0',
        'left: -6px',
        'width: 12px',
        'height: 100%',
        'cursor: col-resize',
        'z-index: 9999',
        'user-select: none',
        'background: transparent',
        'touch-action: none',
        'pointer-events: auto'
    ].join(';');
    return handle;
}

function loadSavedWidth(): number | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const v = Number(raw);
        return Number.isFinite(v) && v > 0 ? v : null;
    } catch {
        return null;
    }
}

function saveWidth(px: number): void {
    try {
        localStorage.setItem(STORAGE_KEY, String(Math.round(px)));
    } catch {}
}

function setupStylesOnce(): void {
    if (document.getElementById('kh-side-resizer-style')) return;
    const s = document.createElement('style');
    s.id = 'kh-side-resizer-style';
    s.textContent = `
.${RESIZER_CLASS} { background: transparent !important; }
.${RESIZER_CLASS}:hover { background: transparent !important; }
.${RESIZER_CLASS}::after { display: none !important; }
`;
    (document.head || document.documentElement).appendChild(s);
}

function clampWidth(px: number, containerWidth: number): number {
    const min = 180; // sensible min width
    const max = Math.min(Math.max(360, Math.round(containerWidth * 0.6)), containerWidth - 180);
    return Math.max(min, Math.min(max, px));
}

function isElementVisible(el: HTMLElement): boolean {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function isScOpen(): boolean {
    try {
        const openSel = (KAYAKO_SELECTORS as any).sideConversationContainer || "[class*='side-conversations-panel__side-panel_'][class*='side-conversations-panel__open_']";
        const openEl = document.querySelector<HTMLElement>(openSel);
        const open = !!openEl && isElementVisible(openEl);
        try { console.debug('[KH side-resizer] isScOpen()', { found: !!openEl, visible: open }); } catch {}
        return open;
    } catch {
        return false;
    }
}

function isCollapsed(side: HTMLElement): boolean {
    try {
        const rect = side.getBoundingClientRect();
        const collapsedByGeom = rect.width < 5 || getComputedStyle(side).display === 'none';
        const scOpen = isScOpen();
        const collapsed = collapsedByGeom || !scOpen;
        try { console.debug('[KH side-resizer] isCollapsed()', { rectW: rect.width, display: getComputedStyle(side).display, scOpen, collapsed }); } catch {}
        return collapsed;
    } catch {
        return false;
    }
}

function clearInlineResize(side: HTMLElement): void {
    if (side.style.width || side.style.flex) {
        side.style.removeProperty('width');
        side.style.removeProperty('flex');
        try { console.debug('[KH side-resizer] Cleared inline width/flex to avoid empty gap'); } catch {}
    }
}

function setHandleInteractive(side: HTMLElement, enabled: boolean): void {
    const handle = side.querySelector<HTMLElement>(`.${RESIZER_CLASS}`);
    if (!handle) return;
    handle.style.display = enabled ? 'block' : 'none';
    handle.style.pointerEvents = enabled ? 'auto' : 'none';
    try { console.debug('[KH side-resizer] Handle state', { enabled }); } catch {}
}

function reconcilePanelState(container: HTMLElement, side: HTMLElement): void {
    const visible = isElementVisible(side);
    const collapsed = !visible || isCollapsed(side);
    try { console.debug('[KH side-resizer] reconcile', { visible, collapsed, inlineW: side.style.width, inlineFlex: side.style.flex }); } catch {}
    if (collapsed) {
        setHandleInteractive(side, false);
        clearInlineResize(side);
        return;
    }
    setHandleInteractive(side, true);
    if (!side.style.width) {
        const saved = loadSavedWidth();
        if (saved) {
            const containerRect = container.getBoundingClientRect();
            const clamped = clampWidth(saved, containerRect.width);
            side.style.width = `${clamped}px`;
            side.style.flex = '0 0 auto';
            try { console.debug('[KH side-resizer] Re-applied saved width on visible panel', { saved, clamped }); } catch {}
        }
    }
}

function onMouseMove(e: MouseEvent, side: HTMLElement, container: HTMLElement): void {
    if (!dragState.isDragging) return;
    const dx = dragState.startX - e.clientX; // dragging left increases width (side panel is on right)
    const containerRect = container.getBoundingClientRect();
    const newWidth = clampWidth(dragState.startWidth + dx, containerRect.width);
    side.style.width = `${newWidth}px`;
    side.style.flex = '0 0 auto';
    try { console.debug('[KH side-resizer] mousemove', { clientX: e.clientX, dx, newWidth }); } catch {}
}

function endDrag(side: HTMLElement): void {
    if (!dragState.isDragging) return;
    dragState.isDragging = false;
    document.body.style.cursor = '';
    document.removeEventListener('mousemove', docMove, true);
    document.removeEventListener('mouseup', docUp, true);
    try {
        const px = parseFloat(side.style.width || '0');
        if (px > 0) {
            saveWidth(px);
            console.debug('[KH side-resizer] Drag end. Saved width px:', px);
        }
    } catch {}
}

function docMove(ev: MouseEvent): void {
    const container = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.layoutContainer);
    const side = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.sidePanel);
    if (!container || !side) return;
    onMouseMove(ev, side, container);
}

function docUp(): void {
    const side = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.sidePanel);
    if (!side) return;
    endDrag(side);
}

function beginDrag(e: MouseEvent, side: HTMLElement, container: HTMLElement): void {
    dragState.isDragging = true;
    dragState.startX = e.clientX;
    dragState.startWidth = side.getBoundingClientRect().width;
    dragState.containerRect = container.getBoundingClientRect();
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', docMove, true);
    document.addEventListener('mouseup', docUp, true);
    try { console.debug('[KH side-resizer] Drag start', { startX: dragState.startX, startWidth: dragState.startWidth }); } catch {}
}

function ensureResizer(side: HTMLElement, container: HTMLElement): void {
    if (side.querySelector(`.${RESIZER_CLASS}`)) return;
    const computed = getComputedStyle(side);
    if (computed.position === 'static' && !side.style.position) {
        side.style.position = 'relative';
        try { console.debug('[KH side-resizer] Applied relative positioning to side panel'); } catch {}
    }
    const handle = createResizerHandle();
    const start = (ev: MouseEvent) => beginDrag(ev, side, container);
    handle.addEventListener('mousedown', start);
    handle.addEventListener('pointerdown', (pe: PointerEvent) => {
        try { console.debug('[KH side-resizer] pointerdown'); } catch {}
        if (pe.pointerType === 'mouse') return; // avoid duplicate with mousedown
        beginDrag(pe as unknown as MouseEvent, side, container);
    });
    side.prepend(handle);
    try { console.debug('[KH side-resizer] Resizer handle injected (invisible)'); } catch {}
}

function applySavedWidth(side: HTMLElement, container: HTMLElement): void {
    const saved = loadSavedWidth();
    if (!saved) {
        try { console.debug('[KH side-resizer] No saved width to apply'); } catch {}
        return;
    }
    const containerRect = container.getBoundingClientRect();
    const clamped = clampWidth(saved, containerRect.width);
    side.style.width = `${clamped}px`;
    side.style.flex = '0 0 auto';
    try { console.debug('[KH side-resizer] Applied saved width', { saved, clamped, containerWidth: containerRect.width }); } catch {}
}

function tryInitOnce(): void {
    const container = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.layoutContainer);
    const side = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.sidePanel);
    try { console.debug('[KH side-resizer] tryInitOnce', { containerFound: !!container, sideFound: !!side }); } catch {}
    if (!container || !side) return;
    try {
        const cRect = container.getBoundingClientRect();
        const sRect = side.getBoundingClientRect();
        console.debug('[KH side-resizer] Initial elements located', { containerW: cRect.width, sideW: sRect.width });
    } catch {}
    if (isElementVisible(side) && !isCollapsed(side)) {
        applySavedWidth(side, container);
    } else {
        clearInlineResize(side);
    }
    ensureResizer(side, container);
    reconcilePanelState(container, side);
}

let globalObserver: MutationObserver | null = null;

export function initSidePanelResizer(): void {
    try {
        setupStylesOnce();
        tryInitOnce();
        if (globalObserver) globalObserver.disconnect();
        globalObserver = new MutationObserver(muts => {
            let changed = false;
            muts.forEach(m => {
                if (m.type === 'childList' && m.addedNodes.length > 0) changed = true;
                if (m.type === 'attributes') changed = true;
            });
            if (!changed) return;
            const container = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.layoutContainer);
            const side = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.sidePanel);
            if (!container || !side) return;
            if (!side.querySelector(`.${RESIZER_CLASS}`)) {
                try { console.debug('[KH side-resizer] Elements appeared; injecting handle (invisible)'); } catch {}
                ensureResizer(side, container);
            }
            reconcilePanelState(container, side);
        });
        globalObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
        try { console.debug('[KH side-resizer] Initialized observer'); } catch {}
    } catch (e) {
        try { console.warn('[KH side-resizer] Failed to initialize', e); } catch {}
    }
}
