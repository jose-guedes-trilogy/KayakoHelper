/*  Kayako Helper – assetsInspector.ts (rev-v14)
    • 🛠  Fixes “fetch more” not loading older posts
        – Summary now shows a real “Fetch next N posts” button
        – Buttons correctly enable/disable as you page through
    • 🐞  Total-post count now taken from total_count (fallbacks still apply)
    • ↗  loadAssets() enlarges the limit progressively; assets accumulate
    • No other behavioural changes
--------------------------------------------------------------------------- */

import {
    EXTENSION_SELECTORS,
    KAYAKO_SELECTORS,
} from '@/generated/selectors.ts';

import type { Post } from '@/modules/kayako/buttons/copy-chat/cleanConversation.ts';
import { fetchCasePostsWithAssets, PAGE_SIZE } from '@/utils/api.ts';

/* ───────────── Types ───────────── */

interface Attachment {
    url?: string;
    url_download?: string;
    type?: string;
}
interface PostWithAssets extends Post {
    id: number;
    contents: string;
    attachments?: Attachment[];
    download_all?: string;
}

/* ───────────── Selector shortcuts ───────────── */

const BTN_ID          = EXTENSION_SELECTORS.assetsButton.replace('#', '');
const BTN_LABEL_SEL   = EXTENSION_SELECTORS.assetsButtonLabel;
const MODAL_SEL       = EXTENSION_SELECTORS.assetsModal;
const NAV_ITEM_SEL    = EXTENSION_SELECTORS.assetsNavItem;
const NAV_SEL         = EXTENSION_SELECTORS.assetsNav;
const PANE_SEL        = EXTENSION_SELECTORS.assetsPane;
const SUMMARY_SEL     = EXTENSION_SELECTORS.assetsSummary;
const FETCH_NEXT_SEL  = EXTENSION_SELECTORS.assetsFetchNextBtn;
const FETCH_ALL_SEL   = EXTENSION_SELECTORS.assetsFetchAllBtn;
const RESULTS_SEL     = EXTENSION_SELECTORS.assetsResults;
const GRID_SEL        = EXTENSION_SELECTORS.assetsGrid;
const HEADER_SEL      = EXTENSION_SELECTORS.assetsHeader;
const JUMP_BTN_SEL    = EXTENSION_SELECTORS.assetsJumpButton;
const LIST_SEL        = EXTENSION_SELECTORS.assetsList;

const BTN_AREA_SEL    = KAYAKO_SELECTORS.conversationWindowHeaderRightButtonArea;
const TIMELINE_SEL    = KAYAKO_SELECTORS.timeline;

/* ───────────── Helpers ───────────── */

const IMG_EXT_RE      = /\.(png|jpe?g|gif|webp|svg)$/i;
const KAYAKO_MEDIA_RE = /\/media\/url\//i;


/* Add Salesforce & NetSuite detection BEFORE the others */
const classify = (u: string):
    | 'salesforce'
    | 'netsuite'
    | 'kayako'
    | 'jira'
    | 'github'
    | 'other' =>
    /(?:\.|^)force\.com/i.test(u)        /* *.lightning.force.com, *.visual.force.com … */
    || /salesforce\.com/i.test(u)
        ? 'salesforce'
        : /netsuite\.com/i.test(u)
            ? 'netsuite'
            : u.includes('.kayako.com')
                ? 'kayako'
                : u.includes('github.com/')
                    ? 'github'
                    : u.includes('.atlassian.net')
                        ? 'jira'
                        : 'other';


const CATEGORY_LABELS = {
    salesforce : 'Salesforce Links',
    netsuite   : 'NetSuite Links',
    kayako     : 'Kayako Instances',
    github     : 'GitHub Links',
    jira       : 'Jira Links',
    other      : 'Other Links',
} as const;

/* ──────── Image preview helper ──────── */
const openImagePreview = async (url: string) => {
    try {
        const resp  = await fetch(url, { credentials: 'include' });  // keep cookies if needed
        if (!resp.ok) throw new Error(String(resp.status));
        const blob  = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        /* Open in a clean new tab; revoke URL when that tab closes */
        const w = window.open(blobUrl, '_blank', 'noopener');
        if (w) w.addEventListener('beforeunload', () => URL.revokeObjectURL(blobUrl));
    } catch (e) {
        /* Fallback: original behaviour */
        console.warn('[AssetsInspector] preview failed, falling back to direct open →', e);
        window.open(url, '_blank', 'noopener');
    }
};


const extractUrls = (html = ''): string[] => {
    const out = new Set<string>();
    const re  = /https?:\/\/[^\s"'\\\]]+/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) out.add(m[0]);
    return [...out];
};

const grabInlineImageSrc = (html = ''): string[] => {
    const urls: string[] = [];
    const re = /\[img[^][]*?\s+src\s*=\s*"([^"]+)"[^]]*]/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) urls.push(m[1]);
    return urls;
};

const isProbablyImage = (url: string) =>
    IMG_EXT_RE.test(url) || KAYAKO_MEDIA_RE.test(url);

/* ───────────── Jump-to-post helper ───────────── */
const jumpToPost = (id: number) => {
    const timeline  = document.querySelector<HTMLElement>(TIMELINE_SEL);
    const container: HTMLElement | Window = timeline ?? window;   // fall-back to window

    let tries = 0;
    const max  = 80;   // ≈ 32 s total (80 × 400 ms)

    const seek = () => {
        const el = document.querySelector<HTMLElement>(`[data-id="${id}"]`);

        if (el) {                                           // ✅ found it!
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.animate(
                [{ background: 'hsl(33 58% 92%)' }, { background: 'transparent' }],
                { duration: 1200 },
            );
            return;
        }
        if (++tries >= max) return;                         // give up gracefully

        /* 🚀 Jump straight to the very top so Kayako loads the next batch */
        if (container instanceof Window) {
            container.scrollTo({ top: 0 });
        } else if ('scrollTo' in container) {
            (container as any).scrollTo({ top: 0 });
        } else {
            container.scrollTop = 0;
        }

        setTimeout(seek, 400);                              // wait a bit, then re-check
    };

    seek();                                                 // kick things off
};


/* ───────────── State ───────────── */

let fetched     = 0;                // posts fetched so far
let totalPosts  = 0;                // total posts for this ticket
let cache: Record<'links'|'images'|'attachments', { url: string; post: number }[]> =
    { links: [], images: [], attachments: [] };
let isLoading   = false;

let currentTicketId: string | null = null;   // used to auto-reset cache on ticket switch

/* ───────────── UI builders ───────────── */

const btnInnerHtml =
    `<span class="${BTN_LABEL_SEL.slice(1)}">Assets <div>▼</div></span>`;

const buildButton = () => {
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.classList.add(EXTENSION_SELECTORS.defaultButtonClass.replace(/^./, ''));
    btn.innerHTML = btnInnerHtml;
    return btn;
};

const buildModal = () => {
    const wrap = document.createElement('div');
    wrap.className = MODAL_SEL.slice(1);
    wrap.innerHTML = `
        <ul class="${NAV_SEL.slice(1)}">
            <li class="${NAV_ITEM_SEL.slice(1)} active" data-tab="links"      >Links</li>
            <li class="${NAV_ITEM_SEL.slice(1)}"        data-tab="images"     >Images</li>
            <li class="${NAV_ITEM_SEL.slice(1)}"        data-tab="attachments">Attachments</li>
        </ul>
        <div class="${PANE_SEL.slice(1)}">
            <div class="${SUMMARY_SEL.slice(1)}"></div>
            <div class="${RESULTS_SEL.slice(1)}"></div>
        </div>`;
    return wrap;
};

/* ― Tab & summary rendering ― */

const setActiveTab = (modal: HTMLElement, tab: keyof typeof cache) => {
    modal.querySelectorAll<HTMLElement>(NAV_ITEM_SEL)
        .forEach(li => li.classList.toggle('active', li.dataset.tab === tab));
    renderPane(modal, tab);
};

const renderSummary = (modal: HTMLElement) => {
    const s            = modal.querySelector<HTMLElement>(SUMMARY_SEL)!;
    const atEnd        = fetched >= totalPosts;
    const nextLabel    = `Fetch next ${Math.min(PAGE_SIZE, totalPosts - fetched)} posts`;

    s.innerHTML =
        `Showing assets from <strong>${fetched}</strong> posts (total <strong>${totalPosts}</strong>)
         <button class="${FETCH_NEXT_SEL.slice(1)}" ${atEnd ? 'disabled' : ''}>${nextLabel}</button>
         <button class="${FETCH_ALL_SEL.slice(1)}" ${atEnd ? 'disabled' : ''}>Fetch all</button>`;
};

/* ——— Grid builder (Links & Attachments) ——— */

const buildGrid = (
    items: { url: string; post: number }[],
): HTMLDivElement => {

    const grid = document.createElement('div');
    grid.className = GRID_SEL.slice(1);

    /* helper to inject the column header row */
    const addColumnHeaders = () => {
        const h1 = document.createElement('div');
        h1.className = 'id-cell header-cell';
        h1.textContent = 'Post link';
        const h2 = document.createElement('div');
        h2.className = 'link-cell header-cell';
        h2.textContent = 'Content';
        grid.append(h1, h2);
    };

    for (const { url, post } of items) {
        /* Section header rows (“Kayako Instances”, …) */
        if (url.startsWith('--- ')) {
            const header = document.createElement('div');
            header.className = `${HEADER_SEL.slice(1)} header-row`;
            header.textContent = url.replace(/^---\s|\s---$/g, '');
            grid.appendChild(header);

            addColumnHeaders();   // column headers right after every section header
            continue;
        }

        /* Regular asset rows */
        const row = document.createElement('div');
        row.className = 'asset-row';

        /* Col 1 – Post jump button */
        const idCell = document.createElement('div');
        idCell.className = 'id-cell';
        const jmp = document.createElement('button');
        jmp.className  = JUMP_BTN_SEL.slice(1);
        jmp.textContent = `#${post}`;
        jmp.addEventListener('click', () => jumpToPost(post));
        idCell.appendChild(jmp);

        /* Col 2 – Link */
        const linkCell = document.createElement('div');
        linkCell.className = 'link-cell';
        const a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = url;
        linkCell.appendChild(a);

        row.append(idCell, linkCell);
        grid.appendChild(row);
    }

    return grid;
};

/* ― Pane renderer ― */

const renderPane = (modal: HTMLElement, tab: keyof typeof cache) => {
    const box = modal.querySelector<HTMLElement>(RESULTS_SEL)!;
    box.innerHTML = '';
    if (isLoading) { box.textContent = 'Loading…'; return; }

    const items = cache[tab];
    if (!items.length) { box.textContent = '— None found —'; return; }

    if (tab === 'images') {
        /* Thumbnails list */
        const ul = document.createElement('ul');
        ul.className = LIST_SEL.slice(1);

        for (const { url, post } of items) {
            const li  = document.createElement('li');

            const jmp = document.createElement('button');
            jmp.className  = JUMP_BTN_SEL.slice(1);
            jmp.textContent = `#${post}`;
            jmp.addEventListener('click', () => jumpToPost(post));

            /* Col 2 – Thumbnail link */
            const a = document.createElement('a');
            a.href = url;             // still useful for copy link / context-menu
            a.addEventListener('click', ev => {
                ev.preventDefault();  // stop the default navigation
                openImagePreview(url).then(r => {});
            });
            a.tabIndex = 0;           // keyboard focusable
            a.title = 'Open preview';

            const img = document.createElement('img');
            img.src = url;
            img.loading = 'lazy';
            img.width = 64; img.height = 64;
            img.style.objectFit = 'cover';

            a.appendChild(img);
            li.append(a, jmp);
            ul.appendChild(li);
        }
        box.appendChild(ul);
        return;
    }

    /* Links & Attachments – Grid */
    box.appendChild(buildGrid(items));
};

/* ― Data pipeline ― */

const normalizeResponse = (raw: unknown): { posts: PostWithAssets[]; total: number } => {
    if (Array.isArray(raw)) return { posts: raw as PostWithAssets[], total: raw.length };

    const obj   = raw as Record<string, unknown>;
    const posts = (obj['posts'] ?? obj['data'] ?? []) as PostWithAssets[];
    /* prefer total_count; fall back to total; finally posts.length */
    const total = Number(obj['total_count'] ?? obj['total'] ?? posts.length);
    return { posts, total };
};

const loadAssets = async (limit: number) => {
    if (isLoading) return;
    isLoading = true;
    updateButtonLabel('Loading…');

    try {
        const rawResp          = await fetchCasePostsWithAssets(limit) as unknown;
        const { posts, total } = normalizeResponse(rawResp);
        if (!posts.length) { console.warn('[AssetsInspector] No posts returned', rawResp); return; }

        totalPosts = total;
        fetched    = posts.length;           // grows with the new, larger limit

        /*  Re-initialise cache then repopulate from *all* fetched posts   */
        cache = { links: [], images: [], attachments: [] };

        for (const p of posts) {
            /* 1️⃣ INLINE images */
            const inlineImgs = new Set(grabInlineImageSrc(p.contents));
            inlineImgs.forEach(u => cache.images.push({ url: u, post: p.id }));

            /* 2️⃣ TEXT URLs */
            extractUrls(p.contents).forEach(u => {
                if (inlineImgs.has(u)) return;
                cache.links.push({ url: u, post: p.id });
                if (isProbablyImage(u)) cache.images.push({ url: u, post: p.id });
            });

            /* 3️⃣ ATTACHMENTS */
            for (const att of p.attachments ?? []) {
                const dl = att.url_download ?? att.url;
                if (!dl) continue;
                cache.attachments.push({ url: dl, post: p.id });
                if (att.type?.startsWith('image/'))
                    cache.images.push({ url: dl, post: p.id });
            }
            if (p.download_all)
                cache.attachments.push({ url: p.download_all, post: p.id });
        }

        /* Deduplicate by URL */
        const dedup = <T extends { url: string }>(arr: T[]) =>
            Array.from(new Map(arr.map(o => [o.url, o])).values());
        cache.links       = dedup(cache.links);
        cache.images      = dedup(cache.images);
        cache.attachments = dedup(cache.attachments);

        /* Group links by domain (adds header rows) */
        /* Group links by domain (adds header rows) */
        if (cache.links.length) {
            const grouped: Record<
                keyof typeof CATEGORY_LABELS,
                typeof cache.links
            > = {
                salesforce: [], netsuite: [], kayako: [],
                github: [], jira: [], other: [],
            };

            cache.links.forEach(l => grouped[classify(l.url)].push(l));

            /* order: show the new categories first */
            const order: (keyof typeof grouped)[] =
                ['salesforce', 'netsuite', 'kayako', 'github', 'jira', 'other'];

            cache.links = ([] as typeof cache.links).concat(
                ...order.flatMap(k =>
                    grouped[k].length
                        ? [{ url: `--- ${CATEGORY_LABELS[k]} ---`, post: 0 }, ...grouped[k]]
                        : []),
            );
        }

    } catch (e) {
        console.error('[AssetsInspector]', e);
    } finally {
        isLoading = false;
        updateButtonLabel(btnInnerHtml);
    }
};

/* ───────────── Mount / Observer helpers ───────────── */

const updateButtonLabel = (html: string) => {
    const lbl = document.querySelector<HTMLElement>(BTN_LABEL_SEL);
    if (lbl) lbl.innerHTML = html;
};

const mountButtonIfNeeded = () => {
    const area = document.querySelector<HTMLElement>(BTN_AREA_SEL);
    if (!area) return;

    /* Already there? */
    if (area.querySelector(`#${BTN_ID}`)) return;

    const btn   = buildButton();
    const modal = buildModal();
    btn.appendChild(modal);
    area.prepend(btn);

    /* open / close helpers */
    let closeTimer: number | null = null;
    const openModal     = () => modal.classList.add('open');
    const scheduleClose = () => {
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = window.setTimeout(() => modal.classList.remove('open'), 100);
    };
    const cancelClose   = () => { if (closeTimer) clearTimeout(closeTimer); closeTimer = null; };

    /* click-to-toggle */
    btn.addEventListener('click', async e => {
        e.stopPropagation();

        /* ⬇️ NEW: don't toggle if the modal is already open
           and the click happened *inside* the modal itself */
        if (modal.classList.contains('open') &&
            (e.target as HTMLElement).closest(MODAL_SEL)) {
            return;                     // keep the modal open
        }

        /* existing logic ---------------------------------------------------- */
        if (modal.classList.contains('open')) {
            modal.classList.remove('open');
            return;
        }

        openModal();
        cancelClose();

        if (!fetched) await loadAssets(PAGE_SIZE);
        renderSummary(modal);
        setActiveTab(modal, 'links');   // default tab
    });


    /* hover persistence */
    btn  .addEventListener('mouseenter', cancelClose);
    modal.addEventListener('mouseenter', cancelClose);
    btn  .addEventListener('mouseleave', scheduleClose);
    modal.addEventListener('mouseleave', scheduleClose);

    /* nav hover → switch panes */
    modal.addEventListener('mouseover', evt => {
        const li = (evt.target as HTMLElement).closest<HTMLElement>(NAV_ITEM_SEL);
        if (li) {
            const tab = li.dataset.tab as keyof typeof cache | undefined;
            if (tab) setActiveTab(modal, tab);
        }
    });

    /* fetch-more buttons */
    modal.addEventListener('click', async evt => {
        const t = evt.target as HTMLElement;
        if (t.matches(FETCH_NEXT_SEL)) {
            await loadAssets(Math.min(fetched + PAGE_SIZE, totalPosts));
            renderSummary(modal);
            setActiveTab(modal, 'links');
        } else if (t.matches(FETCH_ALL_SEL)) {
            await loadAssets(totalPosts);
            renderSummary(modal);
            setActiveTab(modal, 'links');
        }
    });
};

const observeHeaderArea = () => {
    /* 1️⃣ Initial quick check (covers most cases) */
    mountButtonIfNeeded();

    /* 2️⃣ Observe DOM mutations so we catch late header mounts & V-DOM swaps */
    const observer = new MutationObserver(() => mountButtonIfNeeded());
    observer.observe(document.body, { childList: true, subtree: true });
};

/* ───────────── URL / ticket change watcher ───────────── */

const ticketIdFromUrl = (url: string) => {
    const m = url.match(/\/agent\/conversations\/(\d+)/);
    return m ? m[1] : null;
};

const handleUrlChange = () => {
    const newId = ticketIdFromUrl(location.href);
    if (newId === currentTicketId) return;

    currentTicketId = newId;
    fetched         = totalPosts = 0;
    cache           = { links: [], images: [], attachments: [] };

    const modal = document.querySelector<HTMLElement>(MODAL_SEL);
    if (modal && modal.classList.contains('open') && newId) {
        loadAssets(PAGE_SIZE).then(() => {
            renderSummary(modal);
            setActiveTab(modal, 'links');
        });
    }
};

const installUrlWatcher = () => {
    (['pushState', 'replaceState'] as const).forEach(k => {
        const orig = history[k];
        history[k] = function (...args: Parameters<typeof orig>) {
            const r = orig.apply(this, args as any);
            handleUrlChange();
            return r;
        } as typeof orig;
    });

    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);

    setInterval(handleUrlChange, 400);      // polling fallback
};

/* ───────────── Bootstrap ───────────── */

export function bootAssetsInspector(): void {
    if ((window as any).__assetsInspectorBooted) return;
    (window as any).__assetsInspectorBooted = true;

    observeHeaderArea();
    installUrlWatcher();
    handleUrlChange();           // set currentTicketId
}