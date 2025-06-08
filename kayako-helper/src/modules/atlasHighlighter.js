/* ATLAS visitor highlighter
   – Works even while the UI is still white-screen loading
   – Detects SPA tab changes by polling location.pathname
   – Extracts the visitor name from the automated greeting
   – Highlights every paragraph / following <div> that belongs to that
     visitor so agents can scan chats faster.                           */

import { SEL }               from '../selectors.js';        // <- path changed
import { currentConvId }     from '../utils/location.js';   // <- new util

/* ------------------------------------------------------------------ */
/*  Module-scope state                                                */
/* ------------------------------------------------------------------ */
let currentConv = null;    // numeric id from /conversations/{id}
let visitor     = null;    // “Jane Doe” extracted from “Hi, Jane Doe! 👋”
let postObs     = null;    // MutationObserver for lazy-loaded posts
let urlPoller   = null;    // setInterval id

/* ------------------------------------------------------------------ */
/*  PUBLIC entry point                                                */
/* ------------------------------------------------------------------ */
export function bootAtlasHighlighter() {
    if (!urlPoller) urlPoller = setInterval(checkUrl, 300);  // poll SPA route
    checkUrl();                                              // run immediately
}

/* ------------------------------------------------------------------ */
/*  Detect SPA route changes                                          */
/* ------------------------------------------------------------------ */
function checkUrl() {
    const conv = currentConvId();           // <- util handles regex once

    if (conv === currentConv) return;       // same tab — nothing to do

    /* ------- reset state for the new / unknown tab ---------------- */
    currentConv = conv;
    visitor     = null;
    disconnectPostObserver();
    if (conv) waitForFirstPost();           // new tab => start over
}

/* ------------------------------------------------------------------ */
/*  Wait until at least ONE .message-or-note element exists           */
/* ------------------------------------------------------------------ */
function waitForFirstPost() {
    const first = document.querySelector(SEL.messageOrNote);
    if (first) {
        initPostObserver();

        // Also process existing messages immediately
        document.querySelectorAll(SEL.messageOrNote).forEach(processPost);
        return;
    }
    // Still loading — try again in 300 ms
    setTimeout(waitForFirstPost, 300);
}

/* ------------------------------------------------------------------ */
/*  MutationObserver: lazily loaded posts                             */
/* ------------------------------------------------------------------ */
function initPostObserver() {
    postObs = new MutationObserver(ms => {
        ms.forEach(rec => {
            rec.addedNodes.forEach(node => {
                if (node.nodeType === 1 && node.matches?.(SEL.messageOrNote)) {
                    processPost(node);
                }
            });
        });
    });
    postObs.observe(document.body, { childList: true, subtree: true });
}

function disconnectPostObserver() {
    postObs?.disconnect();
    postObs = null;
}

/* ------------------------------------------------------------------ */
/*  Per-post processing                                               */
/* ------------------------------------------------------------------ */
function processPost(el) {
    if (!visitor) tryDiscoverVisitor(el);   // sets `visitor` once
    if (visitor)  paintLines(el);           // paints matching lines
}

/* ---------- once-per-conversation: find the visitor name ---------- */
function tryDiscoverVisitor(postEl) {
    /* The greeting note is a private note created by the backend user
       stored in SEL.atlasName (usually “ATLAS”).  It looks like:

         Hi, Jane Doe! 👋
         (… some explanation …)

       We extract “Jane Doe” (capture group 1 of SEL.greetingRegex)    */

    const creator = postEl.querySelector(SEL.creatorLabel);
    if (!creator || creator.textContent.trim() !== SEL.atlasName) return;

    const content = postEl.querySelector(SEL.contentBody);
    if (!content) return;

    const m = content.textContent.match(SEL.greetingRegex);
    if (!m) return;                         // not the greeting note

    visitor = m[1].trim();                  // 🎉 got it!

    // Repaint every post now that we know the name
    document.querySelectorAll(SEL.messageOrNote).forEach(paintLines);
}

/* ---------- highlight every paragraph from that visitor ---------- */
function paintLines(root) {
    root.querySelectorAll('p > strong').forEach(strong => {
        const name = strong.textContent.replace(':', '').trim();
        if (name !== visitor) return;

        const p   = strong.parentElement;
        const div = p.nextElementSibling;   // the <div> with the message body

        p.style.cssText =
            'background:#91e797;border-radius:4px 4px 0 0;';
        if (div && div.tagName === 'DIV') {
            div.style.cssText =
                'background:#baf7be;border-radius:0 0 4px 4px;';
        }
    });
}
