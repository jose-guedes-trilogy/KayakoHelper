/* src/modules/replyResizer.ts */

import {
    KAYAKO_SELECTORS,
} from '@/generated/selectors.ts';

import { currentConvId } from '@/utils/location.ts';

/* Config / State */
const BAR_H = 14;
const DEFAULT_MAX = 350;
const MIN_HEIGHT = 44;
const BAR_CLASS = 'ktx-resize-bar';
let stored: Record<string, number> = {};
let currentConv: string | null = null;

/* Public bootstrap */
export function bootReplyResizer(): void {
    ensureChrome();
    watchConversation();
    attachCollapseOnSend();
}

/* Main patch */
function ensureChrome(): void {
    const chromeEl = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.textEditorContainerRoot);
    const wrap = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.editorWrapper);
    if (!chromeEl || !wrap) {
        requestAnimationFrame(ensureChrome);
        return;
    }

    if (
        chromeEl.dataset.resizerSetup === 'true' ||
        chromeEl.querySelector(`.${BAR_CLASS}`)
    ) return;

    chromeEl.dataset.resizerSetup = 'true';
    injectBar(chromeEl);
    applyInitialSize();
}

function injectBar(chromeEl: HTMLElement): void {
    chromeEl.style.position = 'relative';
    const bar = document.createElement('div');
    bar.className = BAR_CLASS;
    bar.style.cssText =
        `position:absolute;left:0;top:-${BAR_H}px;width:100%;height:${BAR_H}px;` +
        'cursor:ns-resize;z-index:10;';
    chromeEl.prepend(bar);
    attachDrag(bar);
}

function attachDrag(bar: HTMLElement): void {
    bar.addEventListener('mousedown', e => {
        e.preventDefault();
        const wrap = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.editorWrapper);
        if (!wrap) return;
        const startY = e.clientY;
        const startH = wrap.getBoundingClientRect().height;
        const onMove = (ev: MouseEvent) => {
            const newH = Math.max(MIN_HEIGHT, startH - (ev.clientY - startY));
            applySize(newH);
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            stored[currentConvId() ?? 'global'] = getCurrentHeight();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

/* Height helpers */
export function applySize(px: number): void {
    const wrap = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.editorWrapper);
    const inner = wrap?.querySelector<HTMLElement>(KAYAKO_SELECTORS.replyInner);
    if (!wrap) return;
    wrap.style.maxHeight = `${px}px`;
    wrap.style.minHeight = `${px}px`;
    if (inner) {
        inner.style.maxHeight = `${px}px`;
        inner.style.minHeight = `${px}px`;
    }
}

function getCurrentHeight(): number {
    const wrap = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.editorWrapper);
    return wrap
        ? parseInt(getComputedStyle(wrap).maxHeight, 10)
        : DEFAULT_MAX;
}

function applyInitialSize(): void {
    const key = currentConvId() ?? 'global';
    applySize(stored[key] ?? DEFAULT_MAX);
}

function watchConversation(): void {
    const id = currentConvId() ?? 'global';
    if (id !== currentConv) {
        currentConv = id;
        setTimeout(ensureChrome, 100);
    }
    requestAnimationFrame(watchConversation);
}

/* Collapse after send */
function attachCollapseOnSend(): void {
    document.addEventListener('click', e => {
        const btn = (e.target as Element).closest(KAYAKO_SELECTORS.sendButtonReply) as Element | null;
        if (!btn) return;
        setTimeout(() => applySize(MIN_HEIGHT), 50);
    }, true);
}