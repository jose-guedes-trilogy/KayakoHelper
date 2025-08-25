/*  Assets-inspector – modal UI builders (pure DOM, no global state)  */

import {
    EXTENSION_SELECTORS,
} from '@/generated/selectors.ts';

import { getState, PAGE_LIMIT } from './assetsInspectorData.ts';
import JSZip from 'jszip';

const {
    assetsModal          : MODAL_SEL,
    assetsNav            : NAV_SEL,
    assetsNavItem        : NAV_ITEM_SEL,
    assetsPane           : PANE_SEL,
    assetsSummary        : SUMMARY_SEL,
    assetsResults        : RESULTS_SEL,
    assetsGrid           : GRID_SEL,
    assetsHeader         : HEADER_SEL,
    assetsJumpButton     : JUMP_BTN_SEL,
    assetsList           : LIST_SEL,
    assetsFetchNextBtn   : FETCH_NEXT_SEL,
    assetsFetchAllBtn    : FETCH_ALL_SEL,
} = EXTENSION_SELECTORS;

/* Local selectors for the new elaborate UI (also added to selectors.jsonc) */
const POST_GROUP_SEL = '.kh-assets-post-group';
const GROUP_HEADER_SEL = '.kh-assets-group-header';
const FILENAME_SEL = '.kh-assets-filename';
const FILE_ROW_SEL = '.kh-assets-file-row';
const COPY_URL_BTN_SEL = '.kh-assets-copy-url';
const DL_ALL_ATTACH_BTN_SEL = '.kh-assets-dl-all-attach';
const DL_IMG_POST_ZIP_BTN_SEL = '.kh-assets-dl-post-zip';
const DL_IMG_POST_INDIV_BTN_SEL = '.kh-assets-dl-post-indiv';
const DL_IMG_ALL_ZIP_BTN_SEL = '.kh-assets-dl-all-zip';
const DL_IMG_ALL_INDIV_BTN_SEL = '.kh-assets-dl-all-indiv';
const DL_ATTACH_ALL_TICKET_ZIP_SEL = '.kh-assets-dl-attach-all-zip';
const SEARCHBAR_SEL = '.kh-assets-searchbar';
const SEARCH_INPUT_SEL = '.kh-assets-search-input';
// removed extension search input
// const SEARCH_EXT_SEL = '.kh-assets-ext-input';

/* Jump-to-post helper (unchanged logic) */
import { KAYAKO_SELECTORS } from '@/generated/selectors.ts';
const TIMELINE_SEL = KAYAKO_SELECTORS.timeline;
const jumpToPost = (id: number) => {
    const timeline  = document.querySelector<HTMLElement>(TIMELINE_SEL);
    const container: HTMLElement | Window = timeline ?? window;
    let tries = 0, max = 80;
    const seek = () => {
        const el = document.querySelector<HTMLElement>(`[data-id="${id}"]`);
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
        if (++tries >= max) return;
        (container as any).scrollTo?.({ top: 0 });
        setTimeout(seek, 400);
    };
    seek();
};

/* Utilities */
const log = (...args: unknown[]) => console.log('[AssetsInspector]', ...args);

const cssEscape = (s: string) => (window as any).CSS?.escape?.(s) ?? s.replace(/"/g, '\\"');

const fileNameFromUrl = (url: string) => {
    try {
        const href = (typeof location !== 'undefined' && location && location.href) ? location.href : undefined as unknown as string;
        const u = href ? new URL(url, href) : new URL(url);
        const last = u.pathname.split('/').filter(Boolean).pop() || '';
        const clean = last.replace(/\.download$/i, '');
        return decodeURIComponent(clean || 'file');
    } catch {
        const raw = (url ?? '').toString();
        const b = raw.split('?')[0] || '';
        const last = b ? (b.includes('/') ? b.substring(b.lastIndexOf('/') + 1) : b) : '';
        return decodeURIComponent(last || 'file');
    }
};

const fileNameFromQueryParams = (u: string): string | null => {
    try {
        const base = (typeof location !== 'undefined' && location && location.href) ? location.href : undefined as unknown as string;
        const parsed = base ? new URL(u, base) : new URL(u);
        const params = parsed.searchParams;
        const candidates = ['filename', 'file', 'name', 'download'];
        for (const key of candidates) {
            const v = params.get(key);
            if (v && /\.[a-z0-9]{2,5}$/i.test(v)) return v;
        }
        return null;
    } catch {
        return null;
    }
};

const findAttachmentFilenameInDom = (url: string, postId: number): string | null => {
    try {
        const postEl = document.querySelector<HTMLElement>(`[data-id="${postId}"]`);
        if (!postEl) return null;
        const a = postEl.querySelector<HTMLAnchorElement>(`a[href="${cssEscape(url)}"]`);
        if (!a) return null;
        const container = a.closest<HTMLElement>('[class*="list_item_attachment__attachment_"]')
            || a.closest<HTMLElement>('[class*="list_item_attachment__attachment-container_"]');
        if (!container) return null;
        const nameEl = container.querySelector<HTMLElement>('[class*="__name-element_"]');
        const txt = nameEl?.textContent?.trim();
        return txt || null;
    } catch {
        return null;
    }
};

const createCopyIconSvg = () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.innerHTML = '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" stroke="#5b6570" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1" stroke="#5b6570" fill="none" stroke-width="2"></rect>';
    return svg;
};

// Sanitized link icon for "Copy URL" (from provided SVG)
const createLinkIconSvg = () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 18 20');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', '#212121');
    path.setAttribute('d', 'M9.8,0c1.2,0,2.1,0.9,2.2,2l1.8,0c1.2,0,2.2,0.9,2.2,2.1l0,0.2v6 c0,0.4-0.3,0.8-0.8,0.8c-0.4,0-0.7-0.3-0.7-0.6l0-0.1v-6c0-0.4-0.3-0.7-0.6-0.7l-0.1,0l-2.1,0c-0.4,0.6-1.1,1-1.9,1H6.2 c-0.8,0-1.5-0.4-1.9-1l-2.1,0c-0.4,0-0.7,0.3-0.7,0.6l0,0.1v13.5c0,0.4,0.3,0.7,0.6,0.7l0.2,0c0.4,0,0.6,0.4,0.6,0.7 C3,19.7,2.7,20,2.3,20c-1.2,0-2.2-0.9-2.2-2.1l0-0.2V4.3C0,3.1,0.9,2.1,2.1,2l0.2,0L4,2c0.1-1.1,1.1-2,2.2-2H9.8z M13.3,12.5h1 c2.1,0,3.7,1.7,3.7,3.8c0,2-1.6,3.6-3.5,3.7l-0.2,0l-1,0c-0.4,0-0.8-0.3-0.8-0.7c0-0.4,0.3-0.7,0.6-0.7l0.1,0l1,0 c1.2,0,2.2-1,2.2-2.3c0-1.2-0.9-2.2-2.1-2.2l-0.2,0h-1c-0.4,0-0.8-0.3-0.8-0.8c0-0.4,0.3-0.7,0.6-0.7L13.3,12.5h1H13.3z M8.3,12.5 h1c0.4,0,0.8,0.3,0.8,0.8c0,0.4-0.3,0.7-0.6,0.7l-0.1,0h-1C7,14,6,15,6,16.3c0,1.2,0.9,2.2,2.1,2.2l0.2,0h1c0.4,0,0.8,0.3,0.8,0.8 c0,0.4-0.3,0.7-0.6,0.7l-0.1,0h-1c-2.1,0-3.8-1.7-3.8-3.8c0-2,1.6-3.6,3.6-3.7L8.3,12.5h1H8.3z M8.3,15.5h6c0.4,0,0.8,0.3,0.8,0.8 c0,0.4-0.3,0.7-0.6,0.7l-0.1,0h-6c-0.4,0-0.8-0.3-0.8-0.8c0-0.4,0.3-0.7,0.6-0.7L8.3,15.5h6H8.3z M9.8,1.5H6.2 c-0.4,0-0.7,0.3-0.7,0.7S5.8,3,6.2,3h3.5c0.4,0,0.7-0.3,0.7-0.7S10.2,1.5,9.8,1.5z');
    svg.appendChild(path);
    return svg;
};

const copyToClipboard = async (text: string) => {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        log('Copied to clipboard', text);
    } catch (err) {
        console.error('[AssetsInspector] Copy failed', err);
    }
};

// Decode any image Blob into a PNG Blob via Canvas to ensure clipboard compatibility
const convertImageBlobToPng = async (blob: Blob): Promise<Blob> => {
    try {
        // Prefer createImageBitmap for speed and reliability
        if (typeof (window as any).createImageBitmap === 'function') {
            const bitmap = await (window as any).createImageBitmap(blob);
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Canvas 2D context unavailable');
            ctx.drawImage(bitmap, 0, 0);
            const pngBlob: Blob = await new Promise((resolve, reject) =>
                canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas toBlob failed')), 'image/png'));
            return pngBlob;
        }
        // Fallback path using HTMLImageElement
        const url = URL.createObjectURL(blob);
        try {
            const img = new Image();
            const loaded: HTMLImageElement = await new Promise((resolve, reject) => {
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('Image load failed'));
                img.src = url;
            });
            const canvas = document.createElement('canvas');
            canvas.width = loaded.naturalWidth || loaded.width;
            canvas.height = loaded.naturalHeight || loaded.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Canvas 2D context unavailable');
            ctx.drawImage(loaded, 0, 0);
            const pngBlob: Blob = await new Promise((resolve, reject) =>
                canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas toBlob failed')), 'image/png'));
            return pngBlob;
        } finally {
            URL.revokeObjectURL(url);
        }
    } catch (err) {
        console.error('[AssetsInspector] convertImageBlobToPng failed', err);
        throw err;
    }
};

const fetchBlob = async (url: string): Promise<Blob> => {
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
    return await resp.blob();
};

const downloadBlob = (blob: Blob, filename: string) => {
    const a = document.createElement('a');
    const href = URL.createObjectURL(blob);
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
};

const injectStyles = (modal: HTMLElement) => {
    if (modal.querySelector('style.kh-assets-style')) return;
    const style = document.createElement('style');
    style.className = 'kh-assets-style';
    /* 14px base, Ephor-like container, cards, refined lists, buttons */
    style.textContent = `
      ${MODAL_SEL} { font-size: 14px; background:#fff; border:1px solid hsl(213deg 15% 88.07%); border-radius: 8px; padding: 10px 12px; box-shadow:0 6px 24px rgba(17,24,39,.12); display:none; flex-direction:column; max-width: 900px; max-height: min(80vh, 720px); overflow: hidden; position: fixed; top: 64px; left: 64px; z-index: 2147483647; }
      ${MODAL_SEL}.open { display:flex; }
      ${MODAL_SEL} .kh-assets-headerbar { position: relative; display:flex; align-items:center; gap:12px; margin-bottom:8px; cursor: move; -webkit-user-select: none; user-select: none; }
      ${MODAL_SEL} .kh-assets-headerbar h2 { flex:1 1 auto; text-align:center; margin:0; font-size:16px; color:#1f2937; }
      ${MODAL_SEL} .kh-assets-close { position:absolute; right:8px; top:50%; transform:translateY(-50%); margin:0; }
      ${MODAL_SEL} .kh-btn{ padding:4px 12px; border:1px solid #ccc; border-radius:4px; background:#fff; cursor:pointer; font:inherit; display:inline-flex; align-items:center; gap:4px; }
      ${MODAL_SEL} .kh-btn:hover{ background:#f5f7ff; border-color:#99a; }
      ${MODAL_SEL} .kh-btn:active{ transform:translateY(1px); }
      ${MODAL_SEL} .kh-assets-close:active{ transform:translateY(-50%); }
      ${MODAL_SEL} ${NAV_SEL} { display:flex; gap: 8px; list-style:none; padding: 4px 0; margin: 0 0 6px 0; }
      ${MODAL_SEL} ${PANE_SEL} { display:flex; flex-direction:column; flex:1 1 auto; min-height:0; }
      ${MODAL_SEL} ${SUMMARY_SEL} { flex: 0 0 auto; }
      ${MODAL_SEL} ${RESULTS_SEL} { padding: 8px 0; overflow: auto; flex:1 1 auto; min-height:0; }
      ${MODAL_SEL} ${GRID_SEL} { display:block; }
      ${MODAL_SEL} ${POST_GROUP_SEL} { background: #fff; border: 1px solid #e7eaee; border-radius: 10px; box-shadow: 0 2px 8px rgba(17,24,39,.06); margin: 12px 0; overflow: hidden; }
      ${MODAL_SEL} ${GROUP_HEADER_SEL} { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: linear-gradient(180deg, #f8fafc, #f3f5f7); border-bottom: 1px solid #edf0f3; gap: 10px; }
      ${MODAL_SEL} ${GROUP_HEADER_SEL} .title { display:flex; align-items:center; gap:8px; font-weight: 600; color: #374151; }
      ${MODAL_SEL} ${GROUP_HEADER_SEL} .actions { display: flex; align-items: center; gap: 8px; }
      ${MODAL_SEL} ${JUMP_BTN_SEL} { padding: 2px 8px; border: 1px solid #d3d9df; background: #ffffff; border-radius: 6px; cursor: pointer; color: #4b5563; }
      ${MODAL_SEL} .kh-pill-btn { padding: 6px 10px; border: 1px solid #d3d9df; background: #f9fafb; color: #374151; border-radius: 999px; cursor: pointer; transition: background .2s, box-shadow .2s; display: inline-flex; align-items: center; gap: 6px; }
      ${MODAL_SEL} .kh-pill-btn:hover { background: #f3f4f6; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
      ${MODAL_SEL} ${LIST_SEL} { list-style: none; padding: 10px; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
      ${MODAL_SEL} ${FILE_ROW_SEL} { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #f1f3f5; }
      ${MODAL_SEL} ${FILENAME_SEL} { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #1f2937; flex: 1 1 auto; min-width: 0; }
      ${MODAL_SEL} ${FILE_ROW_SEL} > div:first-child { flex: 1 1 auto; min-width: 0; }
      ${MODAL_SEL} ${COPY_URL_BTN_SEL} { border: none; background: transparent; cursor: pointer; padding: 4px; border-radius: 6px; }
      ${MODAL_SEL} ${COPY_URL_BTN_SEL}:hover { background: #eef2f7; }
      ${MODAL_SEL} .kh-assets-copy-img { border: none; background: transparent; cursor: pointer; padding: 4px; border-radius: 6px; }
      ${MODAL_SEL} .kh-assets-copy-img:hover { background: #eef2f7; }
      ${MODAL_SEL} .kh-image-grid { padding: 10px; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; }
      ${MODAL_SEL} .kh-image-item { display: flex; flex-direction: column; gap: 6px; }
      ${MODAL_SEL} .kh-thumb { width: 100%; height: 96px; border: 1px solid #e6ebf0; border-radius: 8px; object-fit: cover; background: #f8fafc; }
      ${MODAL_SEL} .kh-toolbar { display: flex; gap: 8px; padding: 6px 12px; }
      ${MODAL_SEL} .kh-links-intro { color:#374151; padding: 6px 12px; }
      ${MODAL_SEL} .kh-links-table { display:grid; grid-template-columns: 96px 1fr; gap:0; }
      ${MODAL_SEL} .kh-links-table .header-cell { font-weight:600; color:#4b5563; padding:8px 12px; border-bottom:1px solid #edf0f3; background:#f9fafb; }
      ${MODAL_SEL} .kh-links-table .row { display:contents; }
      ${MODAL_SEL} .kh-links-table .cell { padding:8px 12px; border-bottom:1px solid #f1f3f5; }
      ${MODAL_SEL} ${SEARCHBAR_SEL} { display:flex; gap:8px; padding: 6px 12px; align-items:center; }
      ${MODAL_SEL} ${SEARCHBAR_SEL} input { min-width: 0; padding: 6px 10px; border:1px solid #d3d9df; border-radius:6px; font:inherit; }
      ${MODAL_SEL} ${SEARCHBAR_SEL} ${SEARCH_INPUT_SEL} { flex: 0 0 220px; margin-left: auto; }
      ${MODAL_SEL} .kh-assets-copy-img { cursor: pointer; }
      ${MODAL_SEL} ${JUMP_BTN_SEL}:hover { background: #f5f7ff; border-color:#99a; }
    `;
    modal.appendChild(style);
};

/* Modal shell */
export const buildModal = (): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = MODAL_SEL.slice(1);
    wrap.innerHTML = `
        <div class="kh-assets-headerbar">
            <h2>Ticket assets</h2>
            <button class="kh-btn kh-assets-close" title="Close">✕</button>
        </div>
        <ul class="${NAV_SEL.slice(1)}">
            <li class="${NAV_ITEM_SEL.slice(1)} active" data-tab="links"      >Links</li>
            <li class="${NAV_ITEM_SEL.slice(1)}"        data-tab="images"     >Images</li>
            <li class="${NAV_ITEM_SEL.slice(1)}"        data-tab="attachments">Attachments</li>
        </ul>
        <div class="${PANE_SEL.slice(1)}">
            <div class="${SUMMARY_SEL.slice(1)}"></div>
            <div class="${RESULTS_SEL.slice(1)}"></div>
        </div>`;
    injectStyles(wrap);
    return wrap;
};

/* UI helpers */
const setActiveTab = (modal: HTMLElement, tab: keyof ReturnType<typeof getState>['cache']) => {
    modal.querySelectorAll<HTMLElement>(NAV_ITEM_SEL)
        .forEach(li => li.classList.toggle('active', (li.dataset as any)['tab'] === tab));
    // Extension search removed; nothing to toggle
    renderPane(modal, tab);
};

const renderSummary = (modal: HTMLElement) => {
    const s = modal.querySelector<HTMLElement>(SUMMARY_SEL);
    if (!s) return;

    const prevSearch = (s.querySelector(SEARCH_INPUT_SEL) as HTMLInputElement | null)?.value ?? '';
    const prevExt = '';

    s.innerHTML =
        `<div class="${SEARCHBAR_SEL.slice(1)}">
           <input class="${SEARCH_INPUT_SEL.slice(1)}" type="text" placeholder="Search name or URL" aria-label="Search" />
         </div>`;

    const si = s.querySelector<HTMLInputElement>(SEARCH_INPUT_SEL);
    // no ext input
    if (si) si.value = prevSearch;
};

/* Links tab – categorized table with descriptive header */
const buildGrid = (items: { url:string; post:number }[]) => {
    const grid = document.createElement('div');
    grid.className = GRID_SEL.slice(1);

    // const intro = Object.assign(document.createElement('div'), { className: 'kh-links-intro' });
    // intro.textContent = 'Links are grouped by category (Kayako, Jira, GitHub, etc). Click a post number to jump.';
    // grid.appendChild(intro);

    // Build categories in encounter order from header tokens: --- Label ---
    const categories: Array<{ label: string; rows: { url: string; post: number }[] }> = [];
    let current: { label: string; rows: { url: string; post: number }[] } | null = null;
    for (const it of items) {
        if (it.url.startsWith('--- ')) {
            const label = it.url.replace(/^---\s*|\s*---$/g, '');
            current = { label, rows: [] };
            categories.push(current);
            continue;
        }
        if (!current) {
            current = { label: 'Links', rows: [] };
            categories.push(current);
        }
        current.rows.push(it);
    }

    for (const cat of categories) {
        if (!cat.rows.length) continue;
        const card = Object.assign(document.createElement('section'), { className: POST_GROUP_SEL.slice(1) });
        const header = Object.assign(document.createElement('div'), { className: GROUP_HEADER_SEL.slice(1) });
        const title = Object.assign(document.createElement('div'), { className: 'title' });
        const titleLabel = document.createElement('span');
        titleLabel.textContent = cat.label;
        title.append(titleLabel);
        const actions = Object.assign(document.createElement('div'), { className: 'actions' });
        header.append(title, actions);

        const table = Object.assign(document.createElement('div'), { className: 'kh-links-table' });
        // Header row
        const thPost = Object.assign(document.createElement('div'), { className: 'header-cell' }); thPost.textContent = 'Post';
        const thContent = Object.assign(document.createElement('div'), { className: 'header-cell' }); thContent.textContent = 'Content';
        table.append(thPost, thContent);

        for (const { url, post } of cat.rows) {
            const rowFrag = document.createDocumentFragment();
            const postCell = Object.assign(document.createElement('div'), { className: 'cell' });
            const postBtn = Object.assign(document.createElement('button'), { className: JUMP_BTN_SEL.slice(1), textContent: `#${post}` });
            postBtn.title = 'Jump to post';
            postBtn.addEventListener('click', () => { log('Jump to post', post); jumpToPost(post); });
            postCell.appendChild(postBtn);

            const contentCell = Object.assign(document.createElement('div'), { className: 'cell' });
            const link = Object.assign(document.createElement('a'), { href: url, target: '_blank', rel: 'noopener', textContent: url });
            const tools = document.createElement('span'); tools.style.display = 'inline-flex'; tools.style.gap = '6px'; tools.style.marginLeft = '8px';
            const copyBtn = Object.assign(document.createElement('button'), { className: COPY_URL_BTN_SEL.slice(1), title: 'Copy URL to clipboard' });
            copyBtn.appendChild(createLinkIconSvg());
            copyBtn.addEventListener('click', async () => { log('Copy link URL', { post, url }); await copyToClipboard(url); });
            tools.appendChild(copyBtn);
            contentCell.append(link, tools);

            rowFrag.append(postCell, contentCell);
            table.appendChild(rowFrag);
        }

        card.append(header, table);
        grid.appendChild(card);
    }
    return grid;
};

/* Group helpers */
const groupByPost = (items: { url:string; post:number }[]) => {
    const map = new Map<number, { files: string[]; dlAll?: string }>();
    const DL_ALL_RE = /\/attachments\/download\/all(?![^#?])/i;
    for (const { url, post } of items) {
        let entry = map.get(post);
        if (!entry) { entry = { files: [] }; map.set(post, entry); }
        if (DL_ALL_RE.test(url)) entry.dlAll = url;
        else entry.files.push(url);
    }
    return map;
};

const buildAttachmentGroups = (items: { url:string; post:number }[]) => {
    const container = document.createElement('div');
    // Global toolbar for Attachments: Download all ticket attachments (ZIP)
    const toolbar = Object.assign(document.createElement('div'), { className: 'kh-toolbar' });
    const allAttachZip = Object.assign(document.createElement('button'), { className: `${'kh-pill-btn'} ${DL_ATTACH_ALL_TICKET_ZIP_SEL.slice(1)}`, textContent: 'Download all ticket attachments (ZIP)' });
    allAttachZip.title = 'Download every attachment in this ticket as a single ZIP file';
    toolbar.append(allAttachZip);
    container.appendChild(toolbar);
    const groups = groupByPost(items);
    for (const [post, { files, dlAll }] of groups) {
        const group = Object.assign(document.createElement('section'), { className: POST_GROUP_SEL.slice(1) });
        const header = Object.assign(document.createElement('div'), { className: GROUP_HEADER_SEL.slice(1) });
        const title = Object.assign(document.createElement('div'), { className: 'title' });
        const titleLabel = document.createElement('span');
        titleLabel.textContent = 'Attachments • Post';
        const jumpBtn = Object.assign(document.createElement('button'), { className: JUMP_BTN_SEL.slice(1), textContent: `#${post}` });
        jumpBtn.title = 'Jump to post';
        jumpBtn.addEventListener('click', () => { log('Jump to post', post); jumpToPost(post); });
        title.append(titleLabel, jumpBtn);
        const actions = Object.assign(document.createElement('div'), { className: 'actions' });

        if (files.length > 1 && dlAll) {
            const dlBtn = Object.assign(document.createElement('button'), { className: `${'kh-pill-btn'} ${DL_ALL_ATTACH_BTN_SEL.slice(1)}` });
            dlBtn.textContent = 'Download all';
            dlBtn.title = 'Download all attachments in this post';
            dlBtn.addEventListener('click', () => {
                log('Download all attachments link', { post, url: dlAll });
                const a = document.createElement('a'); a.href = dlAll; a.target = '_blank'; a.rel = 'noopener'; a.click();
            });
            actions.appendChild(dlBtn);
        }
        header.append(title, actions);

        const list = document.createElement('div');
        for (const url of files) {
            const row = Object.assign(document.createElement('div'), { className: FILE_ROW_SEL.slice(1) });
            const left = document.createElement('div');
            const domName = findAttachmentFilenameInDom(url, post);
            const pretty = domName || fileNameFromUrl(url);
            const nameEl = Object.assign(document.createElement('span'), { className: FILENAME_SEL.slice(1), textContent: pretty });
            left.appendChild(nameEl);

            const right = document.createElement('div');
            const copyBtn = Object.assign(document.createElement('button'), { className: COPY_URL_BTN_SEL.slice(1), title: 'Copy URL to clipboard' });
            copyBtn.appendChild(createLinkIconSvg());
            copyBtn.addEventListener('click', async () => { log('Copy attachment URL', { post, url }); await copyToClipboard(url); });

            right.appendChild(copyBtn);
            row.append(left, right);
            list.appendChild(row);
        }

        group.append(header, list);
        container.appendChild(group);
    }
    // Wire global download-all ZIP for attachments (fetch and zip)
    allAttachZip.addEventListener('click', async () => {
        try {
            // Flatten only file URLs (exclude any per-post download-all URLs)
            const flat = Array.from(groups.values()).flatMap(g => g.files);
            log('Download ALL attachments ZIP', { count: flat.length });
            const zip = new JSZip();
            let idx = 1;
            for (const url of flat) {
                const blob = await fetchBlob(url);
                const name = fileNameFromUrl(url) || `file_${idx++}`;
                zip.file(name, blob);
            }
            const out = await zip.generateAsync({ type: 'blob' });
            downloadBlob(out, 'all_attachments.zip');
        } catch (err) { console.error('[AssetsInspector] Attachments ZIP (all) failed', err); }
    });
    return container;
};

const buildImagesGroups = (items: { url:string; post:number }[]) => {
    const container = document.createElement('div');

    // Global toolbar
    const toolbar = Object.assign(document.createElement('div'), { className: 'kh-toolbar' });
    const allZip = Object.assign(document.createElement('button'), { className: `${'kh-pill-btn'} ${DL_IMG_ALL_ZIP_BTN_SEL.slice(1)}`, textContent: 'Download all images (ZIP)' });
    const allInd = Object.assign(document.createElement('button'), { className: `${'kh-pill-btn'} ${DL_IMG_ALL_INDIV_BTN_SEL.slice(1)}`, textContent: 'Download all images (individual)' });
    allZip.title = 'Download every image in this ticket as a single ZIP file';
    allInd.title = 'Download every image as individual files';
    toolbar.append(allZip, allInd);
    container.appendChild(toolbar);

    const groups = groupByPost(items);
    for (const [post, { files }] of groups) {
        const group = Object.assign(document.createElement('section'), { className: POST_GROUP_SEL.slice(1) });
        const header = Object.assign(document.createElement('div'), { className: GROUP_HEADER_SEL.slice(1) });
        const title = Object.assign(document.createElement('div'), { className: 'title' });
        const titleLabel = document.createElement('span');
        titleLabel.textContent = 'Images • Post';
        const jumpBtn = Object.assign(document.createElement('button'), { className: JUMP_BTN_SEL.slice(1), textContent: `#${post}` });
        jumpBtn.title = 'Jump to post';
        jumpBtn.addEventListener('click', () => { log('Jump to post', post); jumpToPost(post); });
        title.append(titleLabel, jumpBtn);
        const actions = Object.assign(document.createElement('div'), { className: 'actions' });

        const dlZip = Object.assign(document.createElement('button'), { className: `${'kh-pill-btn'} ${DL_IMG_POST_ZIP_BTN_SEL.slice(1)}`, textContent: 'Download all (ZIP)' });
        dlZip.title = 'Download all screenshots from this post as a ZIP file';
        dlZip.addEventListener('click', async () => {
            try {
                log('Download images ZIP (post)', { post, count: files.length });
                const zip = new JSZip();
                let idx = 1;
                for (const url of files) {
                    const blob = await fetchBlob(url);
                    const name = fileNameFromUrl(url) || `image_${idx++}.png`;
                    zip.file(name, blob);
                }
                const out = await zip.generateAsync({ type: 'blob' });
                downloadBlob(out, `post_${post}_screenshots.zip`);
            } catch (err) { console.error('[AssetsInspector] ZIP (post) failed', err); }
        });

        const dlInd = Object.assign(document.createElement('button'), { className: `${'kh-pill-btn'} ${DL_IMG_POST_INDIV_BTN_SEL.slice(1)}`, textContent: 'Download all post images individually' });
        dlInd.title = 'Download all screenshots from this post as individual files';
        dlInd.addEventListener('click', async () => {
            log('Download images individually (post)', { post, count: files.length });
            for (const url of files) {
                const a = document.createElement('a'); a.href = url; a.download = fileNameFromUrl(url); a.target = '_blank'; a.rel = 'noopener'; a.click();
            }
        });

        actions.append(dlZip, dlInd);
        header.append(title, actions);

        const grid = Object.assign(document.createElement('div'), { className: 'kh-image-grid' });
        for (const url of files) {
            const item = Object.assign(document.createElement('div'), { className: 'kh-image-item' });
            const a = Object.assign(document.createElement('a'), { href: url, target: '_blank', rel: 'noopener', title: 'Open full-size image' });
            const img = Object.assign(document.createElement('img'), { src: url, className: 'kh-thumb', loading: 'lazy' });
            a.appendChild(img);
            const meta = document.createElement('div');
            // Prefer DOM-derived filename (from timeline anchor) when available, then query params
            const domDerivedName = findAttachmentFilenameInDom(url, post);
            const prettyName = domDerivedName || fileNameFromQueryParams(url) || fileNameFromUrl(url);
            const name = Object.assign(document.createElement('div'), { className: FILENAME_SEL.slice(1), textContent: prettyName });
            // Buttons row: [Copy URL] [Copy Image]
            const actions = document.createElement('div');
            actions.style.display = 'inline-flex';
            actions.style.gap = '4px';
            const copyUrlBtn = Object.assign(document.createElement('button'), { className: COPY_URL_BTN_SEL.slice(1), title: 'Copy URL to clipboard' });
            copyUrlBtn.appendChild(createLinkIconSvg());
            copyUrlBtn.addEventListener('click', async () => { log('Copy image URL', { post, url }); await copyToClipboard(url); });

            const copyImgBtn = Object.assign(document.createElement('button'), { className: 'kh-assets-copy-img', title: 'Copy image to clipboard' });
            // Use the old copy icon for image copy
            copyImgBtn.appendChild(createCopyIconSvg());
            copyImgBtn.addEventListener('click', async () => {
                try {
                    log('Copy image to clipboard attempt', { post, url });
                    const srcBlob = await fetchBlob(url);
                    const pngBlob = await convertImageBlobToPng(srcBlob);
                    if ((navigator as any).clipboard?.write) {
                        const item = new (window as any).ClipboardItem({ 'image/png': pngBlob });
                        await (navigator as any).clipboard.write([item]);
                        log('Copied image to clipboard as PNG', { post, url });
                    } else {
                        // Fallback: open image so user can copy manually
                        window.open(url, '_blank', 'noopener');
                    }
                } catch (err) {
                    console.error('[AssetsInspector] Copy image failed', err);
                    // Last-resort fallback: copy URL
                    try { await copyToClipboard(url); } catch {}
                }
            });

            actions.append(copyUrlBtn, copyImgBtn);
            meta.style.display = 'flex'; meta.style.alignItems = 'center'; meta.style.justifyContent = 'space-between'; meta.style.gap = '6px';
            meta.append(name, actions);
            item.append(a, meta);
            grid.appendChild(item);
        }

        group.append(header, grid);
        container.appendChild(group);
    }

    // Wire global toolbar now that groups exist
    allZip.addEventListener('click', async () => {
        try {
            const all = items.map(i => i.url);
            log('Download ALL images ZIP', { count: all.length });
            const zip = new JSZip();
            let idx = 1;
            for (const url of all) {
                const blob = await fetchBlob(url);
                const name = fileNameFromUrl(url) || `image_${idx++}.png`;
                zip.file(name, blob);
            }
            const out = await zip.generateAsync({ type: 'blob' });
            downloadBlob(out, 'all_screenshots.zip');
        } catch (err) { console.error('[AssetsInspector] ZIP (all) failed', err); }
    });
    allInd.addEventListener('click', () => {
        const all = items.map(i => i.url);
        log('Download ALL images individually', { count: all.length });
        for (const url of all) {
            const a = document.createElement('a'); a.href = url; a.download = fileNameFromUrl(url); a.target = '_blank'; a.rel = 'noopener'; a.click();
        }
    });

    return container;
};

/* Full pane renderer */
export const renderPane = (
    modal: HTMLElement,
    tab: keyof ReturnType<typeof getState>['cache'],
    options?: { skipSummary?: boolean },
) => {
    const box   = modal.querySelector<HTMLElement>(RESULTS_SEL)!;
    const state = getState();
    if (!options?.skipSummary) renderSummary(modal);
    box.innerHTML = '';

    if (state.isLoading) { box.textContent = 'Loading…'; return; }
    const items = state.cache[tab];

    // Read search inputs
    const searchInput = modal.querySelector<HTMLInputElement>(SEARCH_INPUT_SEL);
    // no ext input
    const q = (searchInput?.value ?? '').trim().toLowerCase();
    const exts: string[] = [];

    const matchesText = (s: string) => q ? s.toLowerCase().includes(q) : true;
    const extractExt = (nameOrUrl: string) => {
        try {
            const safe = (nameOrUrl ?? '').toString();
            const base = safe.split('?')[0] ?? '';
            const hashless = base.split('#')[0] ?? base;
            const last = (hashless.split('/').pop() ?? '') as string;
            const idx = last.lastIndexOf('.');
            return idx >= 0 ? last.slice(idx + 1).toLowerCase() : '';
        } catch { return ''; }
    };
    const fileMatches = (url: string, post: number) => {
        const displayName = findAttachmentFilenameInDom(url, post) || fileNameFromQueryParams(url) || fileNameFromUrl(url);
        const okText = matchesText(displayName) || matchesText(url);
        return okText;
    };
    const filtered = (() => {
        if (tab === 'links') {
            // Keep header rows, filter non-headers
            return items.filter(it => it.url.startsWith('--- ') || matchesText(it.url));
        }
        return items.filter(it => fileMatches(it.url, it.post));
    })();

    log('Search filter', { tab, query: q, exts, before: items.length, after: filtered.length });

    if (!filtered.length) { box.textContent = '— None found —'; return; }

    if (tab === 'images') { box.appendChild(buildImagesGroups(filtered)); return; }
    if (tab === 'attachments') { box.appendChild(buildAttachmentGroups(filtered)); return; }
    box.appendChild(buildGrid(filtered));
};

/* Public helpers for index.ts */
export const wireModal = (modal: HTMLElement, fetchNext: () => void, fetchAll: () => void) => {
    modal.addEventListener('mouseover', ev => {
        const li = (ev.target as HTMLElement).closest<HTMLElement>(NAV_ITEM_SEL);
        if (li) setActiveTab(modal, (li.dataset as any)['tab'] as any);
    });
    modal.addEventListener('click', ev => {
        const t = ev.target as HTMLElement;
        if (t.matches(FETCH_NEXT_SEL)) fetchNext();
        if (t.matches(FETCH_ALL_SEL))  fetchAll();
        if (t.closest('.kh-assets-close')) {
            (modal as any).classList.remove('open');
        }
    });
    // Live search re-render
    modal.addEventListener('input', ev => {
        const target = ev.target as HTMLElement;
        if (target.closest(SEARCHBAR_SEL)) {
            const active = modal.querySelector<HTMLElement>(`${NAV_ITEM_SEL}.active`);
            const tab = (active?.dataset as any)?.tab || 'links';
            // Prevent summary re-render so inputs do not lose focus/selection
            renderPane(modal, tab as any, { skipSummary: true });
        }
    });
    // Dragging by header
    const header = modal.querySelector<HTMLElement>('.kh-assets-headerbar');
    if (header) {
        let dragging = false;
        let startX = 0, startY = 0;
        let boxLeft = 0, boxTop = 0;
        const onDown = (e: MouseEvent) => {
            if ((e.target as HTMLElement).closest('.kh-assets-close')) return;
            dragging = true;
            const rect = (modal as HTMLElement).getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            boxLeft = rect.left;
            boxTop = rect.top;
            // Ensure left/top control and allow horizontal dragging
            (modal as HTMLElement).style.right = 'auto';
            (modal as HTMLElement).style.bottom = 'auto';
            // Lock width to avoid reflow affecting pointer math
            (modal as HTMLElement).style.width = `${Math.round(rect.width)}px`;
            (modal as HTMLElement).style.left = `${Math.round(rect.left)}px`;
            (modal as HTMLElement).style.top = `${Math.round(rect.top)}px`;
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp, { once: true });
            e.preventDefault();
        };
        const onMove = (e: MouseEvent) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            let nextLeft = boxLeft + dx;
            let nextTop = boxTop + dy;
            // Constrain within viewport
            const vw = window.innerWidth, vh = window.innerHeight;
            const rect = (modal as HTMLElement).getBoundingClientRect();
            const width = rect.width, height = rect.height;
            nextLeft = Math.max(0, Math.min(vw - width, nextLeft));
            nextTop = Math.max(0, Math.min(vh - 40, nextTop));
            (modal as HTMLElement).style.left = `${Math.round(nextLeft)}px`;
            (modal as HTMLElement).style.top = `${Math.round(nextTop)}px`;
        };
        const onUp = () => {
            dragging = false;
            // Keep width auto after drag ends
            (modal as HTMLElement).style.width = '';
            document.removeEventListener('mousemove', onMove);
        };
        header.addEventListener('mousedown', onDown);
    }
    setActiveTab(modal, 'links');   // default
};
