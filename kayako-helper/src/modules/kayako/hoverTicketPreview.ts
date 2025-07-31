/* --------------------------------------------------------------------
   Hover-preview of a ticket’s full thread
   – keep CTRL pressed while hovering any row in the list
   – tooltip stays where it first appears; scroll inside it freely
   – hide only when • CTRL is released *and* • the mouse leaves the tooltip
   – drag-handle (top strip) lets you reposition the tooltip
   – colours:
        • internal notes
        • public replies from agents
        • public replies from customers
   -------------------------------------------------------------------- */

import type { Post } from '@/modules/kayako/buttons/copy-chat/cleanConversation.ts';

/* ────────────────────────────────────────────────────────────────── */
/* selectors & constants                                              */
/* ────────────────────────────────────────────────────────────────── */

const ROW_SELECTOR      = '[class*="ko-table_row__container_"]';
const LINK_SELECTOR     = 'a[class*="ko-cases-list_column_conversation__text-link_"]';
const API_PAGE_SIZE     = 50;                     // #posts to fetch for preview

/* tooltip elements (created once) */
const tooltip           = document.createElement('div');
const handle            = document.createElement('div');
const content           = document.createElement('div');

/* state flags */
let ctrlDown            = false;
let tooltipHovered      = false;
let isDragging          = false;
let dragOffsetX         = 0;
let dragOffsetY         = 0;

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

/** Hides + resets the tooltip. */
function hideTooltip() {
    tooltip.style.display = 'none';
    content.innerHTML     = '';
    currentRow            = null;
}

/** Determines whether the tooltip should hide based on state flags. */
function maybeHide() {
    if (!ctrlDown && !tooltipHovered && !isDragging) {
        hideTooltip();
    }
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
    /* one-time tooltip DOM skeleton */
    tooltip.className = 'kh-ticket-preview-tooltip';
    tooltip.style.position      = 'fixed';
    tooltip.style.maxWidth      = '480px';
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

    /* inner scrollable area */
    content.className           = 'kh-ticket-preview-scroll';
    content.style.overflowY     = 'auto';

    tooltip.appendChild(handle);
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

            try {
                const posts   = await fetchPosts(id);
                content.innerHTML = renderPosts(posts);
            } catch (err) {
                content.innerHTML = (err as Error).message;
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
            /* do not hide immediately – maybeHover() checks CTRL + tooltip presence */
            currentRow = null;
            maybeHide();
        }
    });
}

/* Call bootHoverTicketPreview() from contentScript.ts alongside your other modules. */
