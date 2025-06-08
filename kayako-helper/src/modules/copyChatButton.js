/* modules/copyChatButton.js
   – Shows a “Copy chat” button only on real conversation tabs       */

import { SEL }              from '../selectors.js';
import { fetchTranscript }  from '../api.js';
import { isConvPage,
    currentConvId }    from '../utils/location.js';

/* ---------------- Config ---------------- */
const BTN_CLASS = 'ktx-export-btn';
const ICON      = { idle: '📄', work: '⏳', ok: '✅', err: '❌' };
const RESET_MS  = 2000;

/* ---------------- State ----------------- */
let currentLimit = 100;
let currentConv  = null;
let btnEl        = null;

/* ---------------- UI helpers ------------ */
const label     = icon =>
    `${icon} Copy chat${currentLimit !== 100 ? ` (${currentLimit} messages)` : ''}`;
const setIdle   = () => btnEl && (btnEl.textContent = label(ICON.idle));
const setWork   = () => btnEl && (btnEl.textContent = `${ICON.work} Copying…`);
const setOk     = () => btnEl && (btnEl.textContent = `${ICON.ok} Copied!`);
const setErr    = () => btnEl && (btnEl.textContent = `${ICON.err} Failed`);

function exportChat () {
    setWork();
    fetchTranscript(currentLimit)
        .then(txt => navigator.clipboard.writeText(txt))
        .then(()   => { setOk(); setTimeout(setIdle, RESET_MS); })
        .catch(err => {
            console.error(err);
            setErr(); setTimeout(setIdle, RESET_MS);
            alert(`MAKE SURE TO WAIT BEFORE ALT TABBING! Export failed: ${err.message}`);
        });
}

function createButton () {
    const strip = document.querySelector(SEL.tabStrip);
    if (!strip) return;

    btnEl = document.createElement('button');
    btnEl.className   = BTN_CLASS;
    btnEl.style.cssText =
        'margin:0 .25rem;padding:0 .5rem;font-size:14px;cursor:pointer;';
    setIdle();

    strip.insertBefore(btnEl, strip.lastElementChild);
    btnEl.addEventListener('click',        exportChat);
    btnEl.addEventListener('contextmenu',  e => {
        e.preventDefault();
        const v = prompt('Fetch how many posts?', currentLimit);
        const n = parseInt(v, 10);
        if (n > 0) { currentLimit = n; setIdle(); }
    });
}

function removeButton () {
    btnEl?.remove();
    btnEl        = null;
    currentLimit = 100;
}

function handleRouteChange () {
    const onConv = isConvPage();

    if (onConv && !btnEl)      createButton();
    else if (!onConv && btnEl) removeButton();

    if (onConv) {
        const id = currentConvId();
        if (id !== currentConv) { currentConv = id; currentLimit = 100; setIdle(); }
    } else currentConv = null;
}

export function bootCopyChatButton () {
    new MutationObserver(handleRouteChange)
        .observe(document.body, { childList:true, subtree:true });
    handleRouteChange();                              // first run
}
