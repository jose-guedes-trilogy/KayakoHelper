/* Light‑box enhancer  – v5
   • Copy image first tries local <img> → canvas.toBlob() (fast)
   • Shows ⏳ Copying… while the blob is prepared / written
   • Keeps labels, flashes ✅/❌, removes overlay when light‑box closes */

import { SEL } from '../selectors.js';

const BTN_CLASS = 'ktx-lightbox-btn';

export function bootLightboxEnhancer() {
    const bodyObs = new MutationObserver(recs => {
        recs.forEach(r => {
            r.addedNodes.forEach(node => {
                if (node.nodeType === 1 && node.matches?.(SEL.lightboxModal)) {
                    addButtonsWhenReady(node);
                }
            });
        });
    });

    bodyObs.observe(document.body, { childList: true, subtree: true });
}

/* -- wait until image URL is available -------------------------------- */
function addButtonsWhenReady(modalEl) {
    if (modalEl.querySelector(`.${BTN_CLASS}`)) return;

    const poll = setInterval(() => {
        const url = extractImageUrl(modalEl);
        if (url) {
            clearInterval(poll);
            injectButtons(modalEl, url);
        }
    }, 100);
}

/* -- helpers ---------------------------------------------------------- */
function extractImageUrl(modalEl) {
    const img = modalEl.querySelector(SEL.hiddenImg);
    if (img?.src) return img.src;

    const div = modalEl.querySelector(SEL.lightboxImage);
    if (div) {
        const bg = getComputedStyle(div).backgroundImage;
        const m  = bg.match(/url\(["']?(.+?)["']?\)/);
        if (m) return m[1];
    }
    return null;
}

/* Convert loaded <img> to Blob without refetching */
function blobFromImg(imgEl) {
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
            ctx.drawImage(imgEl, 0, 0);
            canvas.toBlob(blob => (blob ? resolve(blob) : reject()), 'image/png');
        } catch (e) {
            reject(e);
        }
    });
}

/* Flash helpers */
const flash = (btn, emoji, keepMs = 1200) => {
    const base = btn.dataset.label;
    btn.textContent = `${emoji} ${base}`;
    setTimeout(() => (btn.textContent = base), keepMs);
};
const setWorking = btn => (btn.textContent = `⏳ Copying…`);

/* -- inject UI -------------------------------------------------------- */
function injectButtons(modalEl, url) {
    const wrap = document.createElement('div');
    wrap.style.cssText =
        'position:fixed;top:16px;right:16px;z-index:9999;' +
        'display:flex;gap:6px;pointer-events:none;';

    /* generic factory */
    const mkBtn = (label, onClick) => {
        const b = document.createElement('button');
        b.className   = BTN_CLASS;
        b.dataset.label = label;
        b.textContent = label;
        b.style.cssText =
            'padding:4px 8px;font-size:12px;background:#fff;border:1px solid #ccc;' +
            'border-radius:4px;cursor:pointer;pointer-events:auto;';
        b.addEventListener('click', e => {
            e.stopPropagation();
            onClick(b);
        });
        return b;
    };

    /* Copy image (left) */
    const imgEl = modalEl.querySelector(SEL.hiddenImg);
    const copyImgBtn = mkBtn('Copy image', async btn => {
        try {
            setWorking(btn);

            const blob =
                imgEl ? await blobFromImg(imgEl) : await fetch(url).then(r => r.blob());

            await navigator.clipboard.write([
                new ClipboardItem({ [blob.type]: blob })
            ]);

            flash(btn, '✅');
        } catch {
            flash(btn, '❌');
        }
    });

    /* Open in new tab (right) */
    const openBtn = mkBtn('Open in new tab', () => window.open(url, '_blank'));

    wrap.append(copyImgBtn, openBtn);
    document.body.appendChild(wrap);

    /* Remove overlay when no light‑boxes remain */
    const closePoll = setInterval(() => {
        if (!document.querySelector(SEL.lightboxModal)) {
            wrap.remove();
            clearInterval(closePoll);
        }
    }, 300);
}
