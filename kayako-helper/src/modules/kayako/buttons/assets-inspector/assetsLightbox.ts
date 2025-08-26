/*  Assets‑inspector – lightweight lightbox/gallery (parity with Kayako enhancer)  */

/* Local, resilient selectors (also mirrored in selectors.jsonc) */
const WRAP_SEL = '.kh-assets-lightbox-wrap';
const BACKDROP_SEL = '.kh-assets-lightbox-backdrop';
const IMG_SEL = '.kh-assets-lightbox-img';
const BTN_COPY_SEL = '.kh-assets-lightbox-copy';
const BTN_OPEN_SEL = '.kh-assets-lightbox-open';
const BTN_PREV_SEL = '.kh-assets-lightbox-prev';
const BTN_NEXT_SEL = '.kh-assets-lightbox-next';
const COUNT_SEL = '.kh-assets-lightbox-count';

type GalleryCtx = { urls: string[]; index: number } | null;
let ctx: GalleryCtx = null;
let keysAttached = false;

const log = (...args: unknown[]) => console.debug('[AssetsLightbox]', ...args);

const ensureStyles = (): void => {
    if (document.querySelector('style.kh-assets-lightbox-style')) return;
    const style = document.createElement('style');
    style.className = 'kh-assets-lightbox-style';
    style.textContent = `
      ${WRAP_SEL} { position: fixed; inset: 0; z-index: 2147483646; display: none; }
      ${WRAP_SEL}.open { display: block; }
      ${BACKDROP_SEL} { position: absolute; inset: 0; background: rgba(0,0,0,.72); }
      ${IMG_SEL} { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
                   max-width: min(96vw, 1600px); max-height: 92vh; box-shadow: 0 12px 40px rgba(0,0,0,.35);
                   border-radius: 8px; background: #111; object-fit: contain; }
      ${BTN_PREV_SEL}, ${BTN_NEXT_SEL} { position: fixed; top: 50%; transform: translateY(-50%);
                   z-index: 2147483647; padding: 8px 10px; font-size: 14px; background:#fff;
                   border:1px solid #ccc; border-radius:4px; cursor:pointer; transition: background .2s, border-color .2s, transform .02s; }
      ${BTN_PREV_SEL} { left: 16px; }
      ${BTN_NEXT_SEL} { right: 16px; }
      ${BTN_PREV_SEL}:hover, ${BTN_NEXT_SEL}:hover { background:#f5f7ff; border-color:#99a; }
      ${BTN_PREV_SEL}:active, ${BTN_NEXT_SEL}:active { transform: translateY(-50%) translateX(0) scale(0.99); }
      ${COUNT_SEL} { position: fixed; top: 16px; left: 16px; z-index: 2147483647; padding:4px 8px; font-size:12px;
                     background:#fff; border:1px solid #ccc; border-radius:4px; pointer-events:none; }
      .kh-assets-lightbox-tools { position: fixed; top: 16px; right: 16px; z-index: 2147483647; display:flex; gap:6px; }
      .kh-assets-lightbox-btn { padding:4px 8px; font-size:12px; background:#fff; border:1px solid #ccc; border-radius:4px; cursor:pointer; transition: background .2s, border-color .2s, transform .02s; }
      .kh-assets-lightbox-btn:hover { background:#f5f7ff; border-color:#99a; }
      .kh-assets-lightbox-btn:active { transform: translateY(1px); }
    `;
    document.head.appendChild(style);
};

const createWrap = (): HTMLElement => {
    let wrap = document.querySelector<HTMLElement>(WRAP_SEL);
    if (wrap) return wrap;
    wrap = document.createElement('div');
    wrap.className = WRAP_SEL.slice(1);

    const backdrop = document.createElement('div');
    backdrop.className = BACKDROP_SEL.slice(1);
    backdrop.addEventListener('click', () => close());

    const img = document.createElement('img');
    img.className = IMG_SEL.slice(1);
    img.alt = '';

    const tools = document.createElement('div');
    tools.className = 'kh-assets-lightbox-tools';
    const copyBtn = Object.assign(document.createElement('button'), { className: 'kh-assets-lightbox-btn ' + BTN_COPY_SEL.slice(1), textContent: 'Copy image' });
    const openBtn = Object.assign(document.createElement('button'), { className: 'kh-assets-lightbox-btn ' + BTN_OPEN_SEL.slice(1), textContent: 'Open in new tab' });
    tools.append(copyBtn, openBtn);

    const prevBtn = Object.assign(document.createElement('button'), { className: BTN_PREV_SEL.slice(1), textContent: '← Prev' });
    const nextBtn = Object.assign(document.createElement('button'), { className: BTN_NEXT_SEL.slice(1), textContent: 'Next →' });
    const counter = Object.assign(document.createElement('div'), { className: COUNT_SEL.slice(1) });

    wrap.append(backdrop, img, tools, prevBtn, nextBtn, counter);
    document.body.appendChild(wrap);

    // Wire actions
    prevBtn.addEventListener('click', (e) => { e.stopPropagation(); navigate(-1); });
    nextBtn.addEventListener('click', (e) => { e.stopPropagation(); navigate(1); });
    copyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
            await copyCurrentImage();
            log('Copied image');
        } catch (err) {
            console.error('[AssetsLightbox] Copy failed', err);
        }
    });
    openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = currentUrl();
        if (url) window.open(url, '_blank', 'noopener');
    });

    if (!keysAttached) {
        keysAttached = true;
        window.addEventListener('keydown', (ev: KeyboardEvent) => {
            const open = !!document.querySelector(`${WRAP_SEL}.open`);
            if (!open) return;
            const isLeft = ev.key === 'ArrowLeft' || ev.code === 'ArrowLeft';
            const isRight = ev.key === 'ArrowRight' || ev.code === 'ArrowRight';
            const isEsc = ev.key === 'Escape' || ev.code === 'Escape';
            if (!isLeft && !isRight && !isEsc) return;
            ev.preventDefault(); ev.stopPropagation();
            if (isEsc) { close(); return; }
            navigate(isLeft ? -1 : 1);
        }, true);
    }

    return wrap;
};

const ensureUi = (): { wrap: HTMLElement; img: HTMLImageElement; counter: HTMLElement } => {
    ensureStyles();
    const wrap = createWrap();
    const img = wrap.querySelector<HTMLImageElement>(IMG_SEL)!;
    const counter = wrap.querySelector<HTMLElement>(COUNT_SEL)!;
    return { wrap, img, counter };
};

const updateCounter = (): void => {
    const { counter } = ensureUi();
    if (!ctx || !counter) return;
    const cur = Math.max(0, Math.min(ctx.index, ctx.urls.length - 1));
    counter.textContent = `${cur + 1}/${ctx.urls.length}`;
};

const showIndex = (index: number): void => {
    if (!ctx) return;
    ctx.index = (index + ctx.urls.length) % ctx.urls.length;
    const { wrap, img } = ensureUi();
    const url = ctx.urls[ctx.index] || '';
    img.src = url;
    (wrap as any).classList.add('open');
    updateCounter();
};

const navigate = (delta: number): void => {
    if (!ctx) return;
    showIndex(ctx.index + delta);
};

const currentUrl = (): string | null => (!ctx ? null : ctx.urls[ctx.index] || null);

const copyCurrentImage = async (): Promise<void> => {
    const url = currentUrl();
    if (!url) { log('Copy aborted: no current URL'); return; }
    log('Copy image start', { url });
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();

    const canWrite = !!((navigator as any).clipboard?.write);
    const hasClipboardItem = typeof (window as any).ClipboardItem === 'function';
    if (!canWrite || !hasClipboardItem) {
        console.warn('[AssetsLightbox] Clipboard API unavailable, opening image for manual copy');
        window.open(url, '_blank', 'noopener');
        return;
    }

    const ensurePng = async (b: Blob): Promise<Blob> => {
        if (b.type && /^image\//i.test(b.type) && b.type.toLowerCase() !== 'image/svg+xml' && b.type.toLowerCase() !== 'image/webp') return b;
        // Convert non-standard or missing types to PNG for compatibility
        const img = document.createElement('img');
        await new Promise((res, rej) => { img.onload = () => res(null); img.onerror = rej; img.src = URL.createObjectURL(b); });
        try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width; canvas.height = img.naturalHeight || img.height;
            const ctx2d = canvas.getContext('2d');
            if (!ctx2d) throw new Error('2D context unavailable');
            ctx2d.drawImage(img, 0, 0);
            return await new Promise<Blob>((resolve, reject) => canvas.toBlob(x => x ? resolve(x) : reject(new Error('toBlob failed')), 'image/png'));
        } finally {
            try { URL.revokeObjectURL(img.src); } catch {}
        }
    };

    try {
        const safeBlob = await ensurePng(blob);
        const item = new (window as any).ClipboardItem({ [safeBlob.type || 'image/png']: safeBlob });
        await (navigator as any).clipboard.write([item]);
        log('Copy image success');
    } catch (err) {
        console.error('[AssetsLightbox] Clipboard write failed, fallback open', err);
        window.open(url, '_blank', 'noopener');
    }
};

export const openAssetsLightbox = (urls: string[], startIndex = 0): void => {
    try {
        if (!Array.isArray(urls) || urls.length === 0) return;
        ctx = { urls, index: Math.max(0, Math.min(startIndex, urls.length - 1)) };
        log('Open', { total: urls.length, index: ctx.index });
        showIndex(ctx.index);
    } catch (e) {
        console.error('[AssetsLightbox] Open failed', e);
    }
};

export const close = (): void => {
    const wrap = document.querySelector<HTMLElement>(WRAP_SEL);
    if (wrap) (wrap as any).classList.remove('open');
};


