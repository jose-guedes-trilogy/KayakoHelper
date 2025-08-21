/* --------------------------------------------------------------------
   Hover-preview of a ticket’s full thread + TEXT SEARCH
   – keep CTRL pressed while hovering any row in the list
   – tooltip stays where it first appears; scroll inside it freely
   – hide only when • CTRL is released *and* • the mouse leaves the tooltip
   – drag-handle (top strip) lets you reposition the tooltip
   – search:
        • type to highlight matches
        • Enter = next, Shift+Enter = previous, Esc = clear
        • Aa toggle = case sensitive
        • shows N / total and wraps around
   – colours:
        • internal notes
        • public replies from agents
        • public replies from customers
   -------------------------------------------------------------------- */

import type { Post } from '@/modules/kayako/buttons/copy-chat/cleanConversation.ts';

/* ────────────────────────────────────────────────────────────────── */
/* selectors & constants                                              */
/* ────────────────────────────────────────────────────────────────── */

const ROW_SELECTOR      = '[class*="ko-cases-list__row_"]';
const LINK_SELECTOR     = 'a[class*="ko-cases-list_column_conversation__text-link_"]';
const API_PAGE_SIZE     = 50;                     // #posts to fetch for preview

/* tooltip elements (created once) */
const tooltip           = document.createElement('div');
const handle            = document.createElement('div');
const searchBar         = document.createElement('div');
const searchInput       = document.createElement('input');
const countBadge        = document.createElement('span');
const prevBtn           = document.createElement('button');
const nextBtn           = document.createElement('button');
const caseBtn           = document.createElement('button');
const clearBtn          = document.createElement('button');
const content           = document.createElement('div');

/* state flags */
let ctrlDown            = false;
let tooltipHovered      = false;
let isDragging          = false;
let dragOffsetX         = 0;
let dragOffsetY         = 0;

/* search state */
let matches: HTMLElement[] = [];
let currentMatchIndex      = -1;
let caseSensitive          = false;

/* keep track of which row spawned the tooltip */
let currentRow: HTMLElement | null = null;

/* ────────────────────────────────────────────────────────────────── */
/* helpers                                                            */
/* ────────────────────────────────────────────────────────────────── */

/** Extracts the numeric ticket-ID from an <a> inside the row. */
function getTicketId(row: HTMLElement): string | null {
    const link = row.querySelector<HTMLAnchorElement>(LINK_SELECTOR);
    if (!link) return null;

    const m = link.getAttribute('href')?.match(/\/conversations\/(\d+)/);
    return m ? m[1] : null;
}

/** Light-weight Kayako fetch limited to the preview use-case. */
async function fetchPosts(ticketId: string, limit = API_PAGE_SIZE): Promise<Post[]> {
    const url =
        `https://${window.location.hostname}/api/v1/cases/${ticketId}` +
        `/posts?include=attachment,post,note&filters=all&limit=${limit}`;

    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Kayako API error ${res.status}`);

    const json = (await res.json()) as { data: Post[] };
    return json.data;
}

/** Generates the inner HTML for the content area (excluding the drag handle). */
function renderPosts(posts: Post[]): string {
    return posts
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map((p) => {
            const ts   = new Date(p.created_at).toLocaleString();
            const who  = p.creator?.full_name ?? 'Unknown';
            const body = (p.contents ?? '')
                .replace(/\r?\n/g, ' ')
                .replace(/\s+/g,  ' ')
                .trim();

            const isNote     = p.original?.resource_type === 'note';
            const isCustomer = p.is_requester === true;
            const roleClass  = isNote
                ? 'kh-ticket-preview-note'
                : isCustomer
                    ? 'kh-ticket-preview-customer-reply'
                    : 'kh-ticket-preview-reply';

            return `
                <div class="kh-ticket-preview-post ${roleClass}">
                    <span class="kh-ticket-preview-meta">${ts} — ${who}</span>
                    <div  class="kh-ticket-preview-body">${body}</div>
                </div>`;
        })
        .join('');
}

/** Hides + resets the tooltip (including search). */
function hideTooltip() {
    tooltip.style.display = 'none';
    content.innerHTML     = '';
    currentRow            = null;
    resetSearchUI();
}

/** Determines whether the tooltip should hide based on state flags. */
function maybeHide() {
    if (!ctrlDown && !tooltipHovered && !isDragging) {
        hideTooltip();
    }
}

/* ────────────────────────────────────────────────────────────────── */
/* search logic                                                       */
/* ────────────────────────────────────────────────────────────────── */

function ensureStyleOnce() {
    if (document.getElementById('kh-ticket-preview-style')) return;
    const style = document.createElement('style');
    style.id = 'kh-ticket-preview-style';
    style.textContent = `
.kh-ticket-preview-tooltip{box-shadow:0 6px 24px rgba(0,0,0,.18);background:#fff;border:1px solid rgba(0,0,0,.15);border-radius:10px;padding:.75rem 1rem}
.kh-ticket-preview-handle{background:linear-gradient(to bottom,rgba(0,0,0,.06),rgba(0,0,0,.03));border-radius:8px 8px 0 0}
.kh-ticket-preview-scroll{padding:.25rem 0 .5rem}
.kh-ticket-preview-search{display:flex;gap:.5rem;align-items:center;padding:.5rem 0;position:sticky;top:0;background:#fff}
.kh-ticket-preview-search input{flex:1 1 auto;padding:.35rem .5rem;border:1px solid rgba(0,0,0,.2);border-radius:6px;font:inherit}
.kh-ticket-preview-search button{padding:.3rem .55rem;border:1px solid rgba(0,0,0,.2);border-radius:6px;background:#f7f7f7;cursor:pointer}
.kh-ticket-preview-search button[disabled]{opacity:.5;cursor:not-allowed}
.kh-ticket-preview-count{font-variant-numeric:tabular-nums;opacity:.8}
.kh-ticket-preview-hit{background:#ffec6c;border-radius:3px;padding:0 2px}
.kh-ticket-preview-hit--current{outline:1px solid rgba(0,0,0,.6);background:#ffe04a}
`;
    document.head.appendChild(style);
}

function escapeRegExp(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clearSearchHighlights() {
    const spans = content.querySelectorAll('.kh-ticket-preview-hit');
    spans.forEach((span) => {
        const parent = span.parentNode as Node | null;
        if (!parent) return;
        const text = document.createTextNode(span.textContent ?? '');
        parent.replaceChild(text, span);
        parent.normalize?.();
    });
}

function highlightInNode(root: Node, regex: RegExp) {
    // Walk text nodes and wrap matches with span
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node: Node) {
            const t = node.textContent ?? '';
            return regex.test(t) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
    } as unknown as NodeFilter);
    const toProcess: Text[] = [];
    let n = walker.nextNode();
    while (n) {
        toProcess.push(n as Text);
        n = walker.nextNode();
    }
    toProcess.forEach((textNode) => {
        const frag = document.createDocumentFragment();
        let text = textNode.textContent ?? '';
        let lastIndex = 0;
        text.replace(regex, (match, offset) => {
            const idx = Number(offset);
            if (idx > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, idx)));
            const mark = document.createElement('span');
            mark.className = 'kh-ticket-preview-hit';
            mark.textContent = text.slice(idx, idx + match.length);
            frag.appendChild(mark);
            lastIndex = idx + match.length;
            return match;
        });
        if (lastIndex < text.length) {
            frag.appendChild(document.createTextNode(text.slice(lastIndex)));
        }
        textNode.replaceWith(frag);
    });
}

function collectMatches() {
    matches = Array.from(content.querySelectorAll<HTMLElement>('.kh-ticket-preview-hit'));
}

function setCurrentMatch(i: number) {
    matches.forEach((el) => el.classList.remove('kh-ticket-preview-hit--current'));
    if (i < 0 || i >= matches.length) {
        currentMatchIndex = -1;
        updateCountBadge();
        updateSearchButtons();
        return;
    }
    currentMatchIndex = i;
    const el = matches[i];
    el.classList.add('kh-ticket-preview-hit--current');
    scrollMatchIntoView(el);
    updateCountBadge();
    updateSearchButtons();
}

function scrollMatchIntoView(el: HTMLElement) {
    const pr = content.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    // If outside view, adjust content scrollTop to bring into view with small margin
    if (er.top < pr.top || er.bottom > pr.bottom) {
        const offset = el.offsetTop - content.clientTop - 16; // 16px margin
        content.scrollTop = offset;
    }
}

function updateCountBadge() {
    countBadge.textContent =
        matches.length > 0
            ? `${currentMatchIndex + 1} / ${matches.length}`
            : '0 / 0';
}

function updateSearchButtons() {
    const enabled = matches.length > 0;
    prevBtn.disabled = !enabled;
    nextBtn.disabled = !enabled;
    clearBtn.disabled = searchInput.value.length === 0 && matches.length === 0;
}

function updateSearch(query: string) {
    clearSearchHighlights();
    matches = [];
    currentMatchIndex = -1;

    const q = query.trim();
    if (q.length === 0) {
        updateCountBadge();
        updateSearchButtons();
        return;
    }

    const flags = caseSensitive ? 'g' : 'gi';
    const regex  = new RegExp(escapeRegExp(q), flags);

    // Only search within the posts area, not the toolbar
    highlightInNode(content, regex);
    collectMatches();
    setCurrentMatch(matches.length > 0 ? 0 : -1);
}

function nextMatch() {
    if (matches.length === 0) return;
    const next = (currentMatchIndex + 1) % matches.length;
    setCurrentMatch(next);
}

function prevMatchFn() {
    if (matches.length === 0) return;
    const prev = (currentMatchIndex - 1 + matches.length) % matches.length;
    setCurrentMatch(prev);
}

function resetSearchUI() {
    searchInput.value = '';
    matches = [];
    currentMatchIndex = -1;
    updateCountBadge();
    updateSearchButtons();
}

/* ────────────────────────────────────────────────────────────────── */
/* drag logic                                                         */
/* ────────────────────────────────────────────────────────────────── */

function startDrag(e: MouseEvent) {
    isDragging   = true;
    dragOffsetX  = e.clientX - tooltip.offsetLeft;
    dragOffsetY  = e.clientY - tooltip.offsetTop;

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup',   endDrag);

    handle.style.cursor = 'grabbing';
    e.preventDefault();
}

function onDragMove(e: MouseEvent) {
    tooltip.style.left = `${e.clientX - dragOffsetX}px`;
    tooltip.style.top  = `${e.clientY - dragOffsetY}px`;
}

function endDrag() {
    isDragging        = false;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup',   endDrag);

    handle.style.cursor = 'grab';
    maybeHide();
}

/* ────────────────────────────────────────────────────────────────── */
/* bootstrap                                                          */
/* ────────────────────────────────────────────────────────────────── */

export function bootHoverTicketPreview(): void {
    ensureStyleOnce();

    /* one-time tooltip DOM skeleton */
    tooltip.className = 'kh-ticket-preview-tooltip';
    tooltip.style.position      = 'fixed';
    tooltip.style.maxWidth      = '520px';
    tooltip.style.maxHeight     = '60vh';
    tooltip.style.pointerEvents = 'auto';          // allow scroll + drag
    tooltip.style.zIndex        = '9999';
    tooltip.style.display       = 'none';

    /* drag handle */
    handle.className            = 'kh-ticket-preview-handle';
    handle.style.cursor         = 'grab';
    handle.style.userSelect     = 'none';
    handle.style.height         = '20px';
    handle.style.margin         = '-0.75rem -1rem 0 -1rem';  // stretch to tooltip edge
    handle.addEventListener('mousedown', startDrag);

    /* search UI */
    searchBar.className         = 'kh-ticket-preview-search';

    searchInput.type            = 'search';
    searchInput.placeholder     = 'Search…';
    searchInput.inputMode       = 'search';
    searchInput.autocomplete    = 'off';
    searchInput.spellcheck      = false;

    countBadge.className        = 'kh-ticket-preview-count';
    countBadge.textContent      = '0 / 0';

    prevBtn.type                = 'button';
    nextBtn.type                = 'button';
    clearBtn.type               = 'button';
    caseBtn.type                = 'button';

    prevBtn.textContent         = '↑';
    nextBtn.textContent         = '↓';
    clearBtn.textContent        = '×';
    caseBtn.textContent         = 'Aa';
    prevBtn.title               = 'Previous match (Shift+Enter)';
    nextBtn.title               = 'Next match (Enter)';
    clearBtn.title              = 'Clear search (Esc)';
    caseBtn.title               = 'Match case';

    prevBtn.addEventListener('click', () => prevMatchFn());
    nextBtn.addEventListener('click', () => nextMatch());
    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        updateSearch('');
        searchInput.focus();
    });
    caseBtn.addEventListener('click', () => {
        caseSensitive = !caseSensitive;
        caseBtn.setAttribute('aria-pressed', String(caseSensitive));
        updateSearch(searchInput.value);
    });

    searchInput.addEventListener('input', () => updateSearch(searchInput.value));
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) prevMatchFn(); else nextMatch();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            clearBtn.click();
        }
    });

    searchBar.append(searchInput, countBadge, prevBtn, nextBtn, caseBtn, clearBtn);

    /* inner scrollable area */
    content.className           = 'kh-ticket-preview-scroll';
    content.style.overflowY     = 'auto';

    tooltip.appendChild(handle);
    tooltip.appendChild(searchBar);
    tooltip.appendChild(content);
    document.body.appendChild(tooltip);

    /* track CTRL key */
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Control') ctrlDown = true;
    });

    window.addEventListener('keyup', (e) => {
        if (e.key === 'Control') {
            ctrlDown = false;
            maybeHide();
        }
    });

    /* track mouse entering/leaving tooltip */
    tooltip.addEventListener('mouseenter', () => {
        tooltipHovered = true;
    });
    tooltip.addEventListener('mouseleave', () => {
        tooltipHovered = false;
        maybeHide();
    });

    /* delegate mouseover events to the table */
    document.addEventListener('mouseover', async (evt) => {
        const row = (evt.target as HTMLElement).closest<HTMLElement>(ROW_SELECTOR);
        if (!row || !ctrlDown) return;

        /* if hovering a new row, fetch & show */
        if (row !== currentRow) {
            currentRow = row;
            const id   = getTicketId(row);
            if (!id)   return;

            /* lock tooltip position at first hover point */
            tooltip.style.left    = `${evt.clientX + 12}px`;
            tooltip.style.top     = `${evt.clientY + 12}px`;
            tooltip.style.display = 'block';

            content.innerHTML     = 'Loading…';
            resetSearchUI();

            try {
                const posts   = await fetchPosts(id);
                content.innerHTML = renderPosts(posts);
                // Re-run search if user had already typed something
                if (searchInput.value.trim().length > 0) {
                    updateSearch(searchInput.value);
                } else {
                    updateSearchButtons();
                }
            } catch (err) {
                content.innerHTML = (err as Error).message;
                updateSearchButtons();
            }
        }
    });

    /* hide when pointer leaves the *row* that spawned the tooltip
       (mouse will enter tooltip next, so wait until maybeHide()) */
    document.addEventListener('mouseout', (evt) => {
        if (
            currentRow &&
            !currentRow.contains(evt.relatedTarget as Node) &&
            !tooltip.contains(evt.relatedTarget as Node)
        ) {
            /* do not hide immediately – maybeHide() checks CTRL + tooltip presence */
            currentRow = null;
            maybeHide();
        }
    });
}

/* Call bootHoverTicketPreview() from contentScript.ts alongside your other modules. */
