/*  Assets-inspector – modal UI builders (pure DOM, no global state)  */

import {
    EXTENSION_SELECTORS,
} from '@/generated/selectors.ts';

import { getState, CATEGORY_LABELS, classify, PAGE_LIMIT } from './assetsInspectorData.ts';

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
        ('scrollTo' in container ? (container as any).scrollTo({ top: 0 }) : container.scrollTo?.({ top: 0 }));
        setTimeout(seek, 400);
    };
    seek();
};

/* Modal shell */
export const buildModal = (): HTMLElement => {
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

/* UI helpers */
const setActiveTab = (modal: HTMLElement, tab: keyof ReturnType<typeof getState>['cache']) => {
    modal.querySelectorAll<HTMLElement>(NAV_ITEM_SEL)
        .forEach(li => li.classList.toggle('active', li.dataset.tab === tab));
    renderPane(modal, tab);
};

const renderSummary = (modal: HTMLElement) => {
    const { fetched, totalPosts } = getState();
    const s         = modal.querySelector<HTMLElement>(SUMMARY_SEL)!;
    const atEnd     = fetched >= totalPosts;
    const nextLabel = `Fetch next ${Math.min(PAGE_LIMIT, totalPosts - fetched)} posts`;

    s.innerHTML =
        `Showing assets from <strong>${fetched}</strong> posts (total <strong>${totalPosts}</strong>)
         <button class="${FETCH_NEXT_SEL.slice(1)}" ${atEnd ? 'disabled' : ''}>${nextLabel}</button>
         <button class="${FETCH_ALL_SEL.slice(1)}" ${atEnd ? 'disabled' : ''}>Fetch all</button>`;
};

/* Grid for links / attachments */
const buildGrid = (items: { url:string; post:number }[]) => {
    const grid = document.createElement('div');
    grid.className = GRID_SEL.slice(1);

    const addHeaders = () => {
        const h1 = Object.assign(document.createElement('div'), { className: 'id-cell header-cell', textContent: 'Post' });
        const h2 = Object.assign(document.createElement('div'), { className: 'link-cell header-cell', textContent: 'Content' });
        grid.append(h1, h2);
    };

    for (const { url, post } of items) {
        if (url.startsWith('--- ')) {
            const head = Object.assign(document.createElement('div'), {
                className: `${HEADER_SEL.slice(1)} header-row`,
                textContent: url.replace(/^---\s|\s---$/g, ''),
            });
            grid.appendChild(head);
            addHeaders();
            continue;
        }

        const row     = Object.assign(document.createElement('div'), { className: 'asset-row' });
        const idCell  = Object.assign(document.createElement('div'), { className: 'id-cell' });
        const jumpBtn = Object.assign(document.createElement('button'), {
            className  : JUMP_BTN_SEL.slice(1),
            textContent: `#${post}`,
        });
        jumpBtn.addEventListener('click', () => jumpToPost(post));
        idCell.appendChild(jumpBtn);

        const linkCell = Object.assign(document.createElement('div'), { className: 'link-cell' });
        const a = Object.assign(document.createElement('a'), { href: url, target: '_blank', rel: 'noopener', textContent: url });
        linkCell.appendChild(a);

        row.append(idCell, linkCell);
        grid.appendChild(row);
    }
    return grid;
};

/* Full pane renderer */
export const renderPane = (modal: HTMLElement, tab: keyof ReturnType<typeof getState>['cache']) => {
    const box   = modal.querySelector<HTMLElement>(RESULTS_SEL)!;
    const state = getState();
    box.innerHTML = '';

    if (state.isLoading) { box.textContent = 'Loading…'; return; }
    const items = state.cache[tab];
    if (!items.length) { box.textContent = '— None found —'; return; }

    if (tab === 'images') {
        const ul = Object.assign(document.createElement('ul'), { className: LIST_SEL.slice(1) });
        for (const { url, post } of items) {
            const li  = document.createElement('li');
            const jmp = Object.assign(document.createElement('button'), {
                className: JUMP_BTN_SEL.slice(1), textContent: `#${post}`,
            });
            jmp.addEventListener('click', () => jumpToPost(post));

            const a = Object.assign(document.createElement('a'), { href: url, tabIndex: 0, title: 'Open preview' });
            a.addEventListener('click', ev => { ev.preventDefault(); window.open(url, '_blank', 'noopener'); });

            const img = Object.assign(document.createElement('img'), {
                src: url, loading: 'lazy', width: 64, height: 64,
                style: 'object-fit:cover;',
            });
            a.appendChild(img);
            li.append(a, jmp);
            ul.appendChild(li);
        }
        box.appendChild(ul);
        return;
    }
    box.appendChild(buildGrid(items));
};

/* Public helpers for index.ts */
export const wireModal = (modal: HTMLElement, fetchNext: () => void, fetchAll: () => void) => {
    modal.addEventListener('mouseover', ev => {
        const li = (ev.target as HTMLElement).closest<HTMLElement>(NAV_ITEM_SEL);
        if (li) setActiveTab(modal, li.dataset.tab as any);
    });
    modal.addEventListener('click', ev => {
        const t = ev.target as HTMLElement;
        if (t.matches(FETCH_NEXT_SEL)) fetchNext();
        if (t.matches(FETCH_ALL_SEL))  fetchAll();
    });
    setActiveTab(modal, 'links');   // default
};
