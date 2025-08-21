// src/modules/atlasHighlighter.ts

import {
    KAYAKO_SELECTORS,
    EXTENSION_SELECTORS,
} from '@/generated/selectors.ts';
import { currentConvId } from '@/utils/location.ts';

/* ------------------------------------------------------------------ */
/*  Module-scope state                                                */
/* ------------------------------------------------------------------ */
let currentConv: string | null      = null;   // numeric ID as string, or null
let visitor: string | null          = null;   // “Jane Doe” once discovered
let postObs: MutationObserver | null = null;  // for lazily-loaded posts
let urlPoller: number | null        = null;   // setInterval handle

/* ------------------------------------------------------------------ */
/*  Local helpers/config                                              */
/* ------------------------------------------------------------------ */

// Treat both messages AND notes as “posts”
const POST_SELECTOR =
    `${KAYAKO_SELECTORS.messageOrNote}, .qa-feed_item--note`;

// Robust greeting (legacy discovery path, e.g. “Hi Ellison Welsh ! 👋”)
const GREETING_RE: RegExp =
    // @ts-ignore (generated types may not include this)
    (KAYAKO_SELECTORS.greetingRegex as RegExp | undefined) ??
    /\bHi[, ]+(.+?)[!,.]/i;

// Transcript intro used to identify the correct ATLAS internal note
const TRANSCRIPT_INTRO_RE =
    /Here is a transcript of the customer's recent interaction with ATLAS chat:/i;

// Utility: strip leading "." from a CSS class selector to use as a className
const cls = (sel: string) => sel.replace(/^\./, '');

// Utility: normalize a header label like "Chat Support:" → "chat support"
const norm = (s: string | null | undefined) =>
    (s ?? '').replace(/:\s*$/, '').trim().toLowerCase();

/* ------------------------------------------------------------------ */
/*  PUBLIC entry point                                                */
/* ------------------------------------------------------------------ */
export function bootAtlasHighlighter(): void {
    if (urlPoller === null) {
        urlPoller = window.setInterval(checkUrl, 300);
    }
    checkUrl();
}

/* ------------------------------------------------------------------ */
/*  Detect SPA route changes                                          */
/* ------------------------------------------------------------------ */
function checkUrl(): void {
    const conv = currentConvId(); // string|null
    if (conv === currentConv) return;

    // Reset state for a new conversation (or when leaving one)
    currentConv = conv;
    visitor     = null;
    disconnectPostObserver();

    if (conv) waitForFirstPost();
}

/* ------------------------------------------------------------------ */
/*  Wait until at least ONE post/note element exists                  */
/* ------------------------------------------------------------------ */
function waitForFirstPost(): void {
    const first = document.querySelector<HTMLElement>(POST_SELECTOR);
    if (first) {
        initPostObserver();
        // Process any already-rendered posts immediately
        document.querySelectorAll<HTMLElement>(POST_SELECTOR).forEach(processPost);
        return;
    }
    setTimeout(waitForFirstPost, 300);
}

/* ------------------------------------------------------------------ */
/*  MutationObserver: lazily loaded posts and in-post transcript      */
/* ------------------------------------------------------------------ */
function initPostObserver(): void {
    postObs = new MutationObserver((mutations: MutationRecord[]) => {
        mutations.forEach(record => {
            record.addedNodes.forEach(node => {
                if (node.nodeType !== Node.ELEMENT_NODE) return;
                const el = node as Element;

                // If the node *is* a post/note, process it
                if (el.matches?.(POST_SELECTOR)) {
                    processPost(el);
                    return;
                }

                // If inserted *inside* a post/note, bubble up and process
                const container = el.closest?.(POST_SELECTOR);
                if (container) processPost(container);
            });
        });
    });

    postObs.observe(document.body, { childList: true, subtree: true });
}

function disconnectPostObserver(): void {
    postObs?.disconnect();
    postObs = null;
}

/* ------------------------------------------------------------------ */
/*  Per-post processing                                               */
/* ------------------------------------------------------------------ */
function processPost(el: Element): void {
    if (!visitor) {
        tryDiscoverVisitor(el);
    }
    // Paint even if visitor is still unknown, as long as this is a transcript note
    paintLines(el);
}

/* ------------------------------------------------------------------ */
/*  Visitor discovery                                                 */
/*  1) Preferred: detect the transcript note by its intro line and    */
/*     infer visitor as the first header that is NOT "Chat Support".  */
/*  2) Fallback: legacy greeting "Hi <Name> !" in ATLAS-authored post */
/* ------------------------------------------------------------------ */
function tryDiscoverVisitor(postEl: Element): void {
    const content = postEl.querySelector<HTMLElement>(KAYAKO_SELECTORS.contentBody);
    if (!content) return;

    // --- Path A: Transcript note detection by intro line ---
    if (TRANSCRIPT_INTRO_RE.test(content.textContent ?? '')) {
        const headers = content.querySelectorAll<HTMLParagraphElement>('p > strong');
        for (const strong of Array.from(headers)) {
            const name = norm(strong.textContent ?? '');
            if (!name) continue;
            if (name === 'chat support') continue; // skip the bot speaker
            visitor = strong.textContent?.replace(/:\s*$/, '').trim() ?? null;
            break;
        }
        if (visitor) {
            // Repaint all posts now that we know the visitor
            document.querySelectorAll<HTMLElement>(POST_SELECTOR).forEach(paintLines);
        }
        return;
    }

    // --- Path B: Legacy greeting from ATLAS post (existing behavior) ---
    const creator = postEl.querySelector<HTMLElement>(KAYAKO_SELECTORS.creatorLabel);
    if (!creator || creator.textContent?.trim() !== KAYAKO_SELECTORS.AIName) {
        return;
    }

    const m = content.textContent?.match(GREETING_RE);
    if (!m) return;

    visitor = m[1].trim();

    // Repaint all posts once discovered
    document.querySelectorAll<HTMLElement>(POST_SELECTOR).forEach(paintLines);
}

/* ------------------------------------------------------------------ */
/*  Highlight visitor lines (and their following blocks)              */
/* ------------------------------------------------------------------ */
function paintLines(root: Element): void {
    const isTranscript = TRANSCRIPT_INTRO_RE.test(root.textContent ?? '');

    // Identify a speaker header like: <p><strong>NAME:</strong></p>
    const isHeaderP = (el: Element | null): el is HTMLParagraphElement =>
        !!el && el.tagName === 'P' && !!el.querySelector('strong');

    // Collect all consecutive <div> siblings after `start` until next speaker header.
    // Skip Kayako’s line-break shim divs (br-wrapper).
    const nextContentDivsUntilNextHeader = (start: Element | null): HTMLElement[] => {
        const out: HTMLElement[] = [];
        let cur = start?.nextElementSibling;
        while (cur) {
            if (isHeaderP(cur)) break; // next speaker -> stop
            if (cur.tagName === 'DIV') {
                const div = cur as HTMLElement;
                if (!div.classList.contains('br-wrapper')) {
                    out.push(div);
                }
            }
            cur = cur.nextElementSibling;
        }
        return out;
    };

    root.querySelectorAll<HTMLParagraphElement>('p > strong').forEach(strong => {
        const raw  = strong.textContent ?? '';
        const name = raw.replace(/:\s*$/, '').trim();
        const nameNorm = norm(name);

        // Should we highlight this header?
        // - In transcript notes:
        //     * If we already discovered a visitor, only highlight that visitor
        //     * If not, highlight all headers that aren't "Chat Support"
        // - Outside transcript notes:
        //     * Only highlight discovered visitor (legacy mode)
        let shouldHighlight = false;
        if (isTranscript) {
            if (visitor) {
                shouldHighlight = name === visitor;
            } else {
                shouldHighlight = nameNorm !== 'chat support' && name.length > 0;
            }
        } else if (visitor) {
            shouldHighlight = name === visitor;
        }

        if (!shouldHighlight) return;

        const headerP = strong.parentElement as HTMLParagraphElement | null;
        if (!headerP) return;

        // Gather this speaker’s content blocks (can be multiple <div>s)
        const blocks = nextContentDivsUntilNextHeader(headerP);

        // Special case: file-upload completion message (apply to all blocks)
        const firstText = blocks[0]?.textContent?.trim();
        if (firstText === "✅ I'm done uploading") {
            headerP.classList.add(cls(EXTENSION_SELECTORS.atlasHighlightHeaderFileUploaded));
            blocks.forEach(div =>
                div.classList.add(cls(EXTENSION_SELECTORS.atlasHighlightBodyFileUploaded))
            );
            return;
        }

        // Normal visitor message(s)
        headerP.classList.add(cls(EXTENSION_SELECTORS.atlasHighlightHeader));
        blocks.forEach(div =>
            div.classList.add(cls(EXTENSION_SELECTORS.atlasHighlightBody))
        );
    });
}
