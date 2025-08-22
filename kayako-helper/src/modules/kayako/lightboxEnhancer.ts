// src/modules/lightboxEnhancer.ts

import {
    KAYAKO_SELECTORS,
} from '@/generated/selectors.ts';

const BTN_CLASS = 'ktx-lightbox-btn';
const NAV_BTN_CLASS = 'ktx-lightbox-nav-btn';
const WRAP_ID = 'ktx-lightbox-wrap';
const PREV_ID = 'ktx-lightbox-prev';
const NEXT_ID = 'ktx-lightbox-next';
const COUNT_ID = 'ktx-lightbox-count';

/* Fallback selectors (also mirrored in selectors.jsonc). Using locals here so
   we don't depend on a regenerated types file for new keys. */
const ATTACH_PREVIEW_SEL = '[class*=ko-timeline-2_list_item_attachment__preview_]';
const ATTACH_SMALL_IMG_SEL = 'img[class*=ko-timeline-2_list_item_attachment__small_]';
const ATTACH_LIST_SEL = '[class*=ko-attachments__attachments_]';

type AttachmentCtx = {
    openers: HTMLElement[];
    urls: string[];
    index: number;
};
let lastAttachmentCtx: AttachmentCtx | null = null;
let lastPointerTarget: EventTarget | null = null;
let keysAttached = false;

/* ───────── modal helpers ───────── */
function getAllModals(): HTMLElement[] {
    const raw = Array.from(document.querySelectorAll<HTMLElement>(KAYAKO_SELECTORS.lightboxModal));
    const roots = raw.map(getModalRootElement);
    const seen = new Set<HTMLElement>();
    const uniq: HTMLElement[] = [];
    for (const r of roots) {
        if (!seen.has(r)) { seen.add(r); uniq.push(r); }
    }
    return uniq;
}
function getTopModal(): HTMLElement | null {
    const mods = getAllModals();
    if (mods.length === 0) return null;
    let best: HTMLElement = mods[0];
    let bestZ = Number.parseInt(getComputedStyle(best).zIndex || '0') || 0;
    for (const m of mods) {
        const z = Number.parseInt(getComputedStyle(m).zIndex || '0') || 0;
        if (z >= bestZ) { best = m; bestZ = z; }
    }
    return best;
}
function pruneOtherModals(keep: HTMLElement): number {
    let pruned = 0;
    const keepRoot = getModalRootElement(keep);
    for (const m of getAllModals()) {
        if (m !== keepRoot) { m.remove(); pruned++; }
    }
    if (pruned) console.debug('[KH][Lightbox] Pruned extra modals', { pruned });
    return pruned;
}

/**
 * Given any element within a lightbox, find the overlay root element.
 * Heuristics: prefer ancestors with role=dialog/aria-modal, then highest
 * position:fixed container (ideally covering most of the viewport).
 */
function getModalRootElement(el: Element): HTMLElement {
    let current: HTMLElement | null = el as HTMLElement;
    let candidate: HTMLElement | null = null;
    while (current && current !== document.body) {
        const role = (current.getAttribute('role') || '').toLowerCase();
        const ariaModal = (current.getAttribute('aria-modal') || '').toLowerCase();
        if (role === 'dialog' || ariaModal === 'true') {
            candidate = current;
        }
        const style = getComputedStyle(current);
        if (style.position === 'fixed') {
            candidate = current;
            const coversViewport = current.offsetWidth >= window.innerWidth * 0.95
                && current.offsetHeight >= window.innerHeight * 0.95;
            if (coversViewport) break;
        }
        current = current.parentElement;
    }
    const root = candidate ?? (el as HTMLElement);
    return root;
}

function attachAttachmentPreviewTracker(): void {
    // Track which attachment in a post was clicked to open the lightbox
    const handler = (ev: Event): void => {
        try {
            const t = ev.target as Element | null;
            if (!t) return;
            lastPointerTarget = t;
            const preview = t.closest?.(ATTACH_PREVIEW_SEL) as HTMLElement | null
                ?? t.closest?.(ATTACH_SMALL_IMG_SEL) as HTMLElement | null;
            if (!preview) {
                // If the user clicked elsewhere in the attachment row (thumbnail container etc.)
                const rowMaybe = t.closest?.(KAYAKO_SELECTORS.timelineItemAttachment) as HTMLElement | null;
                if (!rowMaybe) return;
                buildCtxFromRow(rowMaybe);
                return;
            }

            const row = preview.closest(KAYAKO_SELECTORS.timelineItemAttachment) as HTMLElement | null;
            if (!row) return;
            buildCtxFromRow(row);
        } catch (e) { /* noop */ }
    };
    // capture at earliest stages
    document.addEventListener('pointerdown', handler, true);
    document.addEventListener('mousedown', handler, true);
    document.addEventListener('click', handler, true);
}

function buildCtxFromRow(row: HTMLElement): void {
    const listRoot = row.closest(ATTACH_LIST_SEL) as HTMLElement | null;
    if (!listRoot) { return; }
    const rows = Array.from(listRoot.querySelectorAll<HTMLElement>(KAYAKO_SELECTORS.timelineItemAttachment));
    const openers = rows.map(r =>
        (r.querySelector(ATTACH_PREVIEW_SEL) as HTMLElement | null)
        ?? (r.querySelector(ATTACH_SMALL_IMG_SEL)?.closest('div') as HTMLElement | null)
        ?? r
    ).filter(Boolean) as HTMLElement[];
    const urls = rows.map(r => {
        const a = r.querySelector<HTMLAnchorElement>(KAYAKO_SELECTORS.timelineItemAttachmentDownload);
        if (a?.href) return a.href;
        const img = r.querySelector<HTMLImageElement>(ATTACH_SMALL_IMG_SEL);
        return img?.src ?? '';
    });
    const index = Math.max(0, rows.indexOf(row));
    lastAttachmentCtx = { openers, urls, index };
    console.debug('[KH][Lightbox] Context built', { total: openers.length, index });
}

function buildCtxFromUrl(url: string): void {
    try {
        const m = url.match(/attachments\/(\d+)\//);
        if (!m) { return; }
        const id = m[1];
        const candidates = Array.from(document.querySelectorAll<HTMLElement>(
            `${ATTACH_LIST_SEL} a[href*='attachments/${id}/'], ${ATTACH_LIST_SEL} img[src*='attachments/${id}/']`
        ));
        const target = candidates[0];
        if (!target) { return; }
        const row = target.closest(KAYAKO_SELECTORS.timelineItemAttachment) as HTMLElement | null;
        if (!row) { return; }
        buildCtxFromRow(row);
    } catch (e) { /* noop */ }
}

/* Navigate without closing the overlay: wait for the newly created modal
   to appear, then remove previous modals only. */
function navigateBy(delta: number): void {
    if (!lastAttachmentCtx || lastAttachmentCtx.openers.length <= 1) return;
    const ctx = lastAttachmentCtx;
    ctx.index = (ctx.index + delta + ctx.openers.length) % ctx.openers.length;
    console.debug('[KH][Lightbox] Navigate', { index: ctx.index, total: ctx.openers.length, delta });

    const modal = getTopModal();
    const nextUrl = ctx.urls[ctx.index] ?? '';
    if (modal && nextUrl) {
        console.debug('[KH][Lightbox] Updating top modal image', { nextUrl });
        setModalImage(modal, nextUrl);
        updateCounterLabel();
        pruneOtherModals(modal);
        return;
    }
    // Fallback: simulate click if we didn't find modal or URL; when new modal appears, drop others.
    const before = new Set(getAllModals());
    ctx.openers[ctx.index].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const started = Date.now();
    const poll = window.setInterval(() => {
        const mods = getAllModals();
        const newTop = mods.find(m => !before.has(m)) || getTopModal();
        const timeout = Date.now() - started > 2000;
        if (newTop || timeout) {
            if (newTop) { updateCounterLabel(); pruneOtherModals(newTop); }
            clearInterval(poll);
        }
    }, 40);
}

function setModalImage(modalEl: Element, url: string): void {
    // Prefer hidden <img>
    const img = modalEl.querySelector<HTMLImageElement>(KAYAKO_SELECTORS.hiddenImg);
    if (img) img.src = url;
    // Also update background-image target
    const light = modalEl.querySelector<HTMLElement>(KAYAKO_SELECTORS.lightboxImage);
    if (light) light.style.backgroundImage = `url("${url}")`;
}

function updateCounterLabel(): void {
    const el = document.getElementById(COUNT_ID);
    if (!el || !lastAttachmentCtx) return;
    const cur = Math.max(0, Math.min(lastAttachmentCtx.index, lastAttachmentCtx.openers.length - 1));
    el.textContent = `${cur + 1}/${lastAttachmentCtx.openers.length}`;
}

/**
 * Public entry point: starts observing for light-box modals.
 */
export function bootLightboxEnhancer(): void {
    try { attachAttachmentPreviewTracker(); } catch (e) { /* noop */ }
    if (!keysAttached) {
        keysAttached = true;
        const keyHandler = (ev: KeyboardEvent): void => {
            if (!document.querySelector(KAYAKO_SELECTORS.lightboxModal)) return;
            const isLeft  = ev.key === 'ArrowLeft' || ev.code === 'ArrowLeft' || ev.key === 'Left'  || (ev as any).keyCode === 37 || (ev as any).which === 37;
            const isRight = ev.key === 'ArrowRight'|| ev.code === 'ArrowRight'|| ev.key === 'Right' || (ev as any).keyCode === 39 || (ev as any).which === 39;
            if (!isLeft && !isRight) return;
            ev.preventDefault(); ev.stopPropagation();
            navigateBy(isLeft ? -1 : 1);
        };
        window.addEventListener('keydown', keyHandler, true);
    }
    const bodyObs = new MutationObserver((recs: MutationRecord[]) => {
        recs.forEach(r =>
            r.addedNodes.forEach(node => {
                if (
                    node.nodeType === Node.ELEMENT_NODE &&
                    (node as Element).matches?.(KAYAKO_SELECTORS.lightboxModal)
                ) {
                    const root = getModalRootElement(node as Element);
                    console.debug('[KH][Lightbox] Modal detected', { total: getAllModals().length, root });
                    addButtonsWhenReady(root as Element);
                }
            })
        );
    });
    bodyObs.observe(document.body, { childList: true, subtree: true });
}

/**
 * Poll until the copy buttons haven’t already been injected
 * and the image URL is available.
 */
function addButtonsWhenReady(modalEl: Element): void {
    if (modalEl.querySelector(`.${BTN_CLASS}`)) return;

    const poll = window.setInterval(() => {
        const url = extractImageUrl(modalEl);
        if (url) {
            clearInterval(poll);
            const root = getModalRootElement(modalEl);
            injectButtons(root, url);
            pruneOtherModals(root as HTMLElement);
        }
    }, 100);
    // Give up after 5s to avoid polling forever
    window.setTimeout(() => clearInterval(poll), 5000);
}

/**
 * Try to get a direct <img> src or
 * fall back to CSS background-image URL.
 */
function extractImageUrl(modalEl: Element): string | null {
    const img = modalEl.querySelector<HTMLImageElement>(KAYAKO_SELECTORS.hiddenImg);
    if (img?.src) return img.src;

    const div = modalEl.querySelector<HTMLElement>(KAYAKO_SELECTORS.lightboxImage);
    if (div) {
        const bg = getComputedStyle(div).backgroundImage;
        const m = bg.match(/url\(["']?(.+?)["']?\)/);
        if (m) return m[1];
    }
    return null;
}

/**
 * Draws an <img> into a canvas and returns a PNG Blob.
 */
function blobFromImg(imgEl: HTMLImageElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        if (!imgEl.complete) {
            imgEl.onload  = () => blobFromImg(imgEl).then(resolve, reject);
            imgEl.onerror = reject;
            return;
        }
        try {
            const canvas = document.createElement('canvas');
            canvas.width  = imgEl.naturalWidth;
            canvas.height = imgEl.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('2D context unavailable'));
            ctx.drawImage(imgEl, 0, 0);
            canvas.toBlob(
                blob => blob ? resolve(blob) : reject(new Error('toBlob failed')),
                'image/png'
            );
        } catch (e) {
            reject(e);
        }
    });
}

/** Flash a ✅/❌ over the original label */
const flash = (
    btn: HTMLButtonElement,
    emoji: string,
    keepMs = 1200
): void => {
    const base = btn.dataset.label ?? '';
    btn.textContent = `${emoji} ${base}`;
    setTimeout(() => {
        btn.textContent = base;
    }, keepMs);
};

/** Show busy indicator while copying */
const setWorking = (btn: HTMLButtonElement): void => {
    btn.textContent = `⏳ Copying…`;
};

/**
 * Injects “Copy image” and “Open in new tab” buttons into the modal.
 */
function injectButtons(modalEl: Element, url: string): void {
    // Ensure we don't accumulate wrappers across fast nav
    document.getElementById(WRAP_ID)?.remove();
    document.getElementById(PREV_ID)?.remove();
    document.getElementById(NEXT_ID)?.remove();
    document.getElementById(COUNT_ID)?.remove();
    const wrap = document.createElement('div');
    wrap.id = WRAP_ID;
    wrap.style.cssText =
        'position:fixed;top:16px;right:16px;z-index:9999;' +
        'display:flex;gap:6px;pointer-events:none;';

    // factory for consistent button styling & behavior
    const mkBtn = (
        label: string,
        onClick: (btn: HTMLButtonElement) => void
    ): HTMLButtonElement => {
        const b = document.createElement('button');
        b.className       = BTN_CLASS;
        b.dataset.label   = label;
        b.textContent     = label;
        b.style.cssText   =
            'padding:4px 8px;font-size:12px;background:#fff;border:1px solid #ccc;' +
            'border-radius:4px;cursor:pointer;pointer-events:auto;';
        b.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            onClick(b);
        });
        return b;
    };

    const imgEl = modalEl.querySelector<HTMLImageElement>(KAYAKO_SELECTORS.hiddenImg);

    const copyImgBtn = mkBtn('Copy image', async btn => {
        try {
            setWorking(btn);
            const blob = imgEl
                ? await blobFromImg(imgEl)
                : await fetch(url).then(res => res.blob());
            await navigator.clipboard.write([
                new ClipboardItem({ [blob.type]: blob })
            ]);
            flash(btn, '✅');
        } catch {
            flash(btn, '❌');
        }
    });

    const openBtn = mkBtn('Open in new tab', () => {
        void window.open(url, '_blank');
    });

    const sideNavBtn = (
        label: string,
        id: string,
        side: 'left' | 'right',
        onClick: () => void,
    ): HTMLButtonElement => {
        const b = document.createElement('button');
        b.id = id;
        b.className     = NAV_BTN_CLASS;
        b.dataset.label = label;
        b.textContent   = label;
        b.style.cssText = [
            'position:fixed',
            'top:50%','transform:translateY(-50%)',
            side === 'left' ? 'left:16px' : 'right:16px',
            'z-index:10000',
            'padding:8px 10px','font-size:14px','background:#fff','border:1px solid #ccc',
            'border-radius:4px','cursor:pointer','pointer-events:auto',
        ].join(';');
        b.addEventListener('click', (e: MouseEvent) => { e.stopPropagation(); onClick(); });
        return b;
    };

    const buttons: HTMLButtonElement[] = [copyImgBtn, openBtn];

    // Attempt to reconstruct navigation context if missing or trivial
    if (!lastAttachmentCtx || lastAttachmentCtx.openers.length <= 1) {
        // 1) Try last pointer area
        const t = lastPointerTarget as Element | null;
        const fromPointerRow = t?.closest?.(KAYAKO_SELECTORS.timelineItemAttachment) as HTMLElement | null;
        if (fromPointerRow) buildCtxFromRow(fromPointerRow);
        // 2) Try URL-based matching
        if (!lastAttachmentCtx || lastAttachmentCtx.openers.length <= 1) buildCtxFromUrl(url);
    }

    if (lastAttachmentCtx && lastAttachmentCtx.openers.length > 1) {
        const prevBtn = sideNavBtn('← Prev', PREV_ID, 'left', () => navigateBy(-1));
        const nextBtn = sideNavBtn('Next →', NEXT_ID, 'right', () => navigateBy(1));
        document.body.appendChild(prevBtn);
        document.body.appendChild(nextBtn);
        // Counter label (top-left)
        const count = document.createElement('div');
        count.id = COUNT_ID;
        count.style.cssText = [
            'position:fixed','top:16px','left:16px','z-index:10000',
            'padding:4px 8px','font-size:12px','background:#fff','border:1px solid #ccc',
            'border-radius:4px','pointer-events:none',
        ].join(';');
        document.body.appendChild(count);
        updateCounterLabel();
    } else {
        // no nav
    }

    wrap.append(...buttons);
    document.body.appendChild(wrap);

    // remove when no more light-boxes
    const closePoll = window.setInterval(() => {
        if (!document.querySelector(KAYAKO_SELECTORS.lightboxModal)) {
            wrap.remove();
            document.getElementById(PREV_ID)?.remove();
            document.getElementById(NEXT_ID)?.remove();
            document.getElementById(COUNT_ID)?.remove();
            clearInterval(closePoll);
        }
    }, 300);
}
