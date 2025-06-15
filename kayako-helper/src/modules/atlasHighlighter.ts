// modules/atlasHighlighter.ts

import {
    KAYAKO_SELECTORS,
} from '@/generated/selectors';
import { currentConvId }     from '@/utils/location';   // <- new util

/* ------------------------------------------------------------------ */
/*  Module-scope state                                                */
/* ------------------------------------------------------------------ */
let currentConv: string | null  = null;    // numeric ID as string, or null
let visitor: string | null      = null;    // “Jane Doe” once discovered
let postObs: MutationObserver | null = null;    // for lazy-loaded posts
let urlPoller: number | null    = null;    // setInterval handle

/* ------------------------------------------------------------------ */
/*  PUBLIC entry point                                                */
/* ------------------------------------------------------------------ */
export function bootAtlasHighlighter(): void {
    // Start polling for SPA route changes
    if (urlPoller === null) {
        urlPoller = window.setInterval(checkUrl, 300);
    }
    checkUrl();
}

/* ------------------------------------------------------------------ */
/*  Detect SPA route changes                                          */
/* ------------------------------------------------------------------ */
function checkUrl(): void {
    const conv = currentConvId();           // util returns current conversation ID (string|null)

    if (conv === currentConv) return;       // no change

    // Reset state for a new conversation (or leaving one)
    currentConv = conv;
    visitor     = null;
    disconnectPostObserver();
    if (conv) {
        waitForFirstPost();
    }
}

/* ------------------------------------------------------------------ */
/*  Wait until at least ONE .message-or-note element exists           */
/* ------------------------------------------------------------------ */
function waitForFirstPost(): void {
    const first = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.messageOrNote);
    if (first) {
        initPostObserver();
        // Process any already-rendered posts immediately
        document.querySelectorAll<HTMLElement>(KAYAKO_SELECTORS.messageOrNote).forEach(processPost);
        return;
    }
    // Still loading — try again shortly
    setTimeout(waitForFirstPost, 300);
}

/* ------------------------------------------------------------------ */
/*  MutationObserver: lazily loaded posts                             */
/* ------------------------------------------------------------------ */
function initPostObserver(): void {
    postObs = new MutationObserver((mutations: MutationRecord[]) => {
        mutations.forEach(record =>
            record.addedNodes.forEach(node => {
                if (
                    node.nodeType === Node.ELEMENT_NODE &&
                    (node as Element).matches?.(KAYAKO_SELECTORS.messageOrNote)
                ) {
                    processPost(node as Element);
                }
            })
        );
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
    if (visitor) {
        paintLines(el);
    }
}

/* ---------- once-per-conversation: find the visitor name ---------- */
function tryDiscoverVisitor(postEl: Element): void {
    const creator = postEl.querySelector<HTMLElement>(KAYAKO_SELECTORS.creatorLabel);
    if (!creator || creator.textContent?.trim() !== KAYAKO_SELECTORS.AIName) {
        return;
    }

    const content = postEl.querySelector<HTMLElement>(KAYAKO_SELECTORS.contentBody);
    if (!content) return;

    const m = content.textContent?.match(KAYAKO_SELECTORS.greetingRegex);
    if (!m) return;

    visitor = m[1].trim();

    // Now that we know the visitor name, repaint all existing posts
    document.querySelectorAll<HTMLElement>(KAYAKO_SELECTORS.messageOrNote).forEach(paintLines);
}

/* ---------- highlight every paragraph from that visitor ---------- */
function paintLines(root: Element): void {
    root.querySelectorAll<HTMLParagraphElement>('p > strong').forEach(strong => {
        const name = strong.textContent?.replace(':', '').trim();
        if (name !== visitor) return;

        const p   = strong.parentElement;
        const div = p?.nextElementSibling;

        if (p) {
            p.classList.add('kh-atlas-highlight-header');
        }
        if (div && div.tagName === 'DIV') {
            (div as HTMLElement).classList.add('kh-atlas-highlight-body');
        }
    });
}
