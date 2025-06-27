/*─────────────────────────────────────────────────────────────────────────*\

 .src/modules/download-manager/kayakoAttachments.ts

  Kayako ⇄ Gemini – Send→Gemini helper
  • Works on initial load *and* lazy-loaded blocks as you scroll.
  • Preserves the original “Download all” text.
  • Updates only the helper link’s text.

\*─────────────────────────────────────────────────────────────────────────*/

const DOWNLOAD_SELECTOR = 'a[class*="ko-attachments__download-all_"]';
const EXT_BTN_CLASS     = 'kayako-send-to-gemini';

/** Boot once on script load */
export function bootKayakoAttachments(): void {
    if (!/\.kayako\.com$/.test(location.hostname)) return;
    if (!/\/agent\/conversations\/\d+/.test(location.pathname)) return;

    // Decorate what's already there…
    enhanceAll();

    // …and watch for new blocks (lazy-load via scroll)
    const observer = new MutationObserver(throttle(enhanceAll, 300));
    observer.observe(document.body, { childList: true, subtree: true });
}

/** Scan the DOM and insert a helper link next to each “Download all” */
function enhanceAll(): void {
    document
        .querySelectorAll<HTMLAnchorElement>(DOWNLOAD_SELECTOR)
        .forEach((downloadAnchor) => {
            if (
                downloadAnchor.parentElement &&
                !downloadAnchor.parentElement.querySelector(`.${EXT_BTN_CLASS}`)
            ) {
                insertHelper(downloadAnchor);
            }
        });
}

/** Create & insert the “Send → Gemini” helper link */
function insertHelper(downloadAnchor: HTMLAnchorElement): void {
    const helper = document.createElement('a');
    helper.textContent = 'Send → Gemini';
    helper.href        = '#';
    helper.className   = EXT_BTN_CLASS;
    helper.style.marginLeft = '0.5rem';

    helper.addEventListener('click', (ev) => {
        ev.preventDefault();
        handleClick(helper, downloadAnchor.href);
    });

    downloadAnchor.parentElement!.appendChild(helper);
}

/** When clicked, only update the helper’s text—not the Download all link */
async function handleClick(
    helper: HTMLAnchorElement,
    zipUrl: string,
): Promise<void> {
    const ticketId = location.pathname.match(/conversations\/(\d+)/)?.[1];
    if (!ticketId) {
        alert('Could not determine ticket ID from URL.');
        return;
    }

    helper.textContent = 'Working…';
    try {
        const resp = await chrome.runtime.sendMessage({
            action:   'attachments.fetchZip',
            url:      zipUrl,
            ticketId,
        });
        if (resp.ok) {
            helper.textContent = `Sent ✔ (${resp.fileCount})`;
        } else {
            throw new Error(resp.error);
        }
    } catch (err) {
        console.error(err);
        alert('Failed – check console.');
        helper.textContent = 'Send → Gemini';
    }
}

/** Throttle calls so we don’t spam `enhanceAll()` on every single DOM mutation */
function throttle<T extends (...args: any[]) => void>(
    fn: T,
    ms: number,
): T {
    let last = 0;
    return ((...args: any[]) => {
        const now = Date.now();
        if (now - last > ms) {
            last = now;
            fn(...args);
        }
    }) as T;
}
