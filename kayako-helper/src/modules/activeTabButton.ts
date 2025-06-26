/* ===========================================================================
 * activeTabButton.ts – v1.1
 * Single helper that boots the “Make Active” button once per page.
 * Uses dynamic import() so Rollup keeps the bundle classic-script-safe.
 * ---------------------------------------------------------------------------
 */

type SelectorModule = typeof import('@/generated/selectors');

let EXTENSION_SELECTORS: SelectorModule['EXTENSION_SELECTORS'] | null = null;

/** Loads selectors the first time we need them. */
async function getSelectors() {
    if (!EXTENSION_SELECTORS) {
        // Rollup leaves this call intact → Chrome fetches dist/selectors.js at runtime
        ({ EXTENSION_SELECTORS } = await import(
            /* @vite-ignore */ chrome.runtime.getURL('dist/selectors.js')
            ));
    }
    return EXTENSION_SELECTORS!;
}

/**
 * Injects the “Make Active” button when the supplied predicate returns `true`.
 * Call this from any content-script that needs the button.
 */
export async function initMakeTabActiveButton(
    shouldInit: () => boolean = () => true,
): Promise<void> {
    if (!shouldInit()) return;

    const selectors = await getSelectors();
    const BTN_ID = selectors.makeTabActiveButton.replace(/^#/, '');

    if (document.getElementById(BTN_ID)) return; // already added

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.textContent = 'Make Active';

    // styling lives in CSS; class is only a DevTools hook
    btn.classList.add('kayako-helper__make-active-btn');

    btn.addEventListener('click', () => {
        chrome.runtime.sendMessage(
            { action: 'exportChat.setActiveTab' },
            () => (btn.textContent = 'Active ✔'),
        );
    });

    document.body.appendChild(btn);
}
