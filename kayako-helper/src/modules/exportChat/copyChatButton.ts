// modules/copyChatButton.ts
import { SEL } from '@/selectors.js';
import { fetchTranscript } from '@/api.js';
import { isConvPage, currentConvId } from '@/utils/location.js';

/* ---------------- Config ---------------- */
const BTN_CLASS = 'ktx-export-btn';
const ICON: Record<'idle' | 'work' | 'ok' | 'err', string> = {
    idle: '📄',
    work: '⏳',
    ok: '✅',
    err: '❌',
};
const RESET_MS = 2000;

/* ---------------- State ----------------- */
let currentLimit: number = 100;
let currentConv: string | null = null;
let btnEl: HTMLButtonElement | null = null;

/* ---------------- UI helpers ------------ */
const label = (icon: string): string =>
    `${icon} Copy chat${currentLimit !== 100 ? ` (${currentLimit} messages)` : ''}`;

const setIdle = (): void => {
    if (btnEl) {
        btnEl.textContent = label(ICON.idle);
    }
};

const setWork = (): void => {
    if (btnEl) {
        btnEl.textContent = `${ICON.work} Copying…`;
    }
};

const setOk = (): void => {
    if (btnEl) {
        btnEl.textContent = `${ICON.ok} Copied!`;
    }
};

const setErr = (): void => {
    if (btnEl) {
        btnEl.textContent = `${ICON.err} Failed`;
    }
};

function exportChat(): void {
    setWork();
    fetchTranscript(currentLimit)
        .then((txt: string) => navigator.clipboard.writeText(txt))
        .then(() => {
            setOk();
            setTimeout(setIdle, RESET_MS);
        })
        .catch((err: Error) => {
            console.error(err);
            setErr();
            setTimeout(setIdle, RESET_MS);
            alert(`MAKE SURE TO WAIT BEFORE ALT TABBING! Export failed: ${err.message}`);
        });
}

function createButton(): void {
    const strip = document.querySelector<HTMLElement>(SEL.tabStrip);
    if (!strip) return;

    btnEl = document.createElement('button');
    btnEl.className = BTN_CLASS;
    btnEl.style.cssText =
        'margin:0 .25rem;padding:0 .5rem;font-size:14px;cursor:pointer;';
    setIdle();

    strip.insertBefore(btnEl, strip.lastElementChild);
    btnEl.addEventListener('click', exportChat);
    btnEl.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        const v = prompt('Fetch how many posts?', String(currentLimit));
        if (v !== null) {
            const n = parseInt(v, 10);
            if (n > 0) {
                currentLimit = n;
                setIdle();
            }
        }
    });
}

function removeButton(): void {
    btnEl?.remove();
    btnEl = null;
    currentLimit = 100;
}

function handleRouteChange(): void {
    const onConv = isConvPage();

    if (onConv && !btnEl) {
        createButton();
    } else if (!onConv && btnEl) {
        removeButton();
    }

    if (onConv) {
        const id = currentConvId();
        if (id !== currentConv) {
            currentConv = id;
            currentLimit = 100;
            setIdle();
        }
    } else {
        currentConv = null;
    }
}

export function bootCopyChatButton(): void {
    const observer = new MutationObserver(handleRouteChange);
    observer.observe(document.body, { childList: true, subtree: true });
    handleRouteChange(); // initial run
}
