// modules/lightboxEnhancer.ts

import { KAYAKO_SELECTORS } from '@/selectors';

const BTN_CLASS = 'ktx-lightbox-btn';

/**
 * Public entry point: starts observing for light-box modals.
 */
export function bootLightboxEnhancer(): void {
    const bodyObs = new MutationObserver((recs: MutationRecord[]) => {
        recs.forEach(r =>
            r.addedNodes.forEach(node => {
                if (
                    node.nodeType === Node.ELEMENT_NODE &&
                    (node as Element).matches?.(KAYAKO_SELECTORS.lightboxModal)
                ) {
                    addButtonsWhenReady(node as Element);
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
            injectButtons(modalEl, url);
        }
    }, 100);
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
    const wrap = document.createElement('div');
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

    wrap.append(copyImgBtn, openBtn);
    document.body.appendChild(wrap);

    // remove when no more light-boxes
    const closePoll = window.setInterval(() => {
        if (!document.querySelector(KAYAKO_SELECTORS.lightboxModal)) {
            wrap.remove();
            clearInterval(closePoll);
        }
    }, 300);
}
