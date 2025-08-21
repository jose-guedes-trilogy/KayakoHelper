/* OmniHelper – uiAesthetics.ts
   Dark-mode compatibility for OmniHelper buttons.

   What it does:
   - Injects a CSS rule that styles only elements having `.dark-mode`.
   - Adds/removes `.dark-mode` on target selectors when the setting is toggled.
   - Writes the CSS custom properties directly on each target element so your
     chosen colors take effect even against heavy page/extension CSS.
   - Reacts live to storage changes and to DOM mutations.
*/

import { EXTENSION_SELECTORS } from '@/generated/selectors.ts';

/** Storage keys */
const KEY_COMPAT = 'uiDarkCompat';
const KEY_TEXT   = 'uiDarkTextColor';
const KEY_BG     = 'uiDarkBgColor';

/** Defaults */
const DEFAULT_TEXT = '#EAEAEA';
const DEFAULT_BG   = '#1E1E1E';

/** Style tag id */
const STYLE_ID = 'oh-dark-mode-style';

/** Build the combined selector list from the single-source-of-truth selectors */
const sel = EXTENSION_SELECTORS;

const TARGET_SELECTORS: string[] = [
    sel.newLinesButton,
    sel.copyChatButton,
    sel.createFolderButton,
    sel.copyPostButton,
    sel.scrollTopButton,
    sel.exportChatButton,
    sel.exportChatButtonRight,
    sel.twoPartBtnLeftHalf,
    sel.twoPartBtnRightHalf,
    sel.sendToQcButton,
    sel.ephorButton || '#kh-ephor-btn',
    sel.assetsButton
].filter(Boolean) as string[];

/** Cached observer so we can disconnect/reconnect as settings change */
let observer: MutationObserver | null = null;
/** Current enable state + colors */
let compatEnabled = false;
let currentText = DEFAULT_TEXT;
let currentBg   = DEFAULT_BG;

/** Ensure our style element exists with the correct CSS */
function ensureStyleTag(): HTMLStyleElement {
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        (document.head || document.documentElement).appendChild(style);
    }
    // Compose the CSS exactly as requested (SASS-like snippet translated to CSS)
    const joined = TARGET_SELECTORS.map(s => `${s}.dark-mode`).join(',\n');
    style.textContent = `
${joined} {
  color: var(--dark-mode-text-color) !important;
  background: var(--dark-mode-background-color) !important;
}
  `.trim();
    return style;
}

/** Apply/remove the .dark-mode class AND write CSS vars inline on each element */
function tagTargets(apply: boolean, textColor: string, bgColor: string): void {
    TARGET_SELECTORS.forEach(selector => {
        document.querySelectorAll<HTMLElement>(selector).forEach(el => {
            el.classList.toggle('dark-mode', apply);
            if (apply) {
                el.style.setProperty('--dark-mode-text-color', textColor || DEFAULT_TEXT);
                el.style.setProperty('--dark-mode-background-color', bgColor || DEFAULT_BG);
            } else {
                el.style.removeProperty('--dark-mode-text-color');
                el.style.removeProperty('--dark-mode-background-color');
            }
        });
    });
}

/** Lightweight check if a node or its descendants match any target selector */
function nodeMightContainTarget(node: Node): boolean {
    if (!(node instanceof Element)) return false;
    return TARGET_SELECTORS.some(s => (node.matches?.(s) ?? false) || !!node.querySelector(s));
}

/** Start observing DOM changes to tag new buttons as they appear */
function startObserver(): void {
    if (observer) observer.disconnect();
    observer = new MutationObserver(muts => {
        if (!compatEnabled) return;
        for (const m of muts) {
            if (m.type === 'childList') {
                m.addedNodes.forEach(n => {
                    if (nodeMightContainTarget(n)) tagTargets(true, currentText, currentBg);
                });
            } else if (m.type === 'attributes') {
                const target = m.target as Element;
                if (TARGET_SELECTORS.some(s => target.matches(s))) {
                    const el = target as HTMLElement;
                    el.classList.toggle('dark-mode', true);
                    el.style.setProperty('--dark-mode-text-color', currentText);
                    el.style.setProperty('--dark-mode-background-color', currentBg);
                }
            }
        }
    });
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });
}

/** Stop observing DOM changes */
function stopObserver(): void {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
}

/** Push CSS variable values to :root (kept for completeness) */
function setRootCssVariables(textColor: string, bgColor: string): void {
    const root = document.documentElement;
    root.style.setProperty('--dark-mode-text-color', textColor || DEFAULT_TEXT);
    root.style.setProperty('--dark-mode-background-color', bgColor || DEFAULT_BG);
}

/** Apply the entire dark mode compatibility state at once */
function applyState({
                        enabled,
                        textColor,
                        bgColor,
                    }: {
    enabled: boolean;
    textColor: string;
    bgColor: string;
}): void {
    compatEnabled = enabled;
    currentText = textColor || DEFAULT_TEXT;
    currentBg   = bgColor   || DEFAULT_BG;

    ensureStyleTag();
    setRootCssVariables(currentText, currentBg);

    if (enabled) {
        tagTargets(true, currentText, currentBg);
        startObserver();
    } else {
        stopObserver();
        tagTargets(false, currentText, currentBg);
    }
}

/** Load initial state and subscribe to changes */
function init(): void {
    try {
        chrome.storage.sync.get([KEY_COMPAT, KEY_TEXT, KEY_BG] as const, res => {
            const enabled   = !!res[KEY_COMPAT];
            const textColor = (res[KEY_TEXT] as string) ?? DEFAULT_TEXT;
            const bgColor   = (res[KEY_BG] as string)   ?? DEFAULT_BG;
            applyState({ enabled, textColor, bgColor });
        });

        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'sync') return;
            const hasCompat = KEY_COMPAT in changes;
            const hasText   = KEY_TEXT   in changes;
            const hasBg     = KEY_BG     in changes;
            if (!(hasCompat || hasText || hasBg)) return;

            const enabled   = (hasCompat ? !!changes[KEY_COMPAT]!.newValue : compatEnabled);
            const textColor = (hasText   ? (changes[KEY_TEXT]!.newValue as string) : currentText);
            const bgColor   = (hasBg     ? (changes[KEY_BG]!.newValue as string)   : currentBg);

            applyState({ enabled, textColor, bgColor });

            // If only color changed while enabled, refresh variables on current elements:
            if (enabled && (hasText || hasBg)) tagTargets(true, textColor, bgColor);
        });
    } catch {
        // no-op if storage isn't available yet
    }
}

/** Exported boot function (call this from contentScript.ts) */
export function bootUiAesthetics(): void {
    if (!TARGET_SELECTORS.length) return;
    init();
    initTimestampTooltips();
}

/* ============================================================================
 * Timestamp → tooltip enhancer (follows tagCleaner.ts DOM-watching style)
 * --------------------------------------------------------------------------
 * Finds UNIX timestamps in timeline activity text (e.g., <b>1755757936</b>) and
 * adds a human-readable date as a native title tooltip.
 * ---------------------------------------------------------------------------- */

const POST_SEL = '[class*="ko-timeline-2_list_post__post_"]';

const ACTIVITY_TEXT_SELS = [
    '[class*="ko-timeline-2_list_activity_standard__activity-text_"]',
    '[class*="ko-timeline-2_list_activity_system__activity-text_"]',
    '[class*="ko-timeline-2_list_activity__activity-text_"]',
    '[class*="activity-text_"]',
] as const;

function findActivityBox(root: ParentNode): HTMLElement | null {
    for (const s of ACTIVITY_TEXT_SELS) {
        const el = root.querySelector<HTMLElement>(s);
        if (el) return el;
    }
    return null;
}

function parseEpochToDateString(epochText: string): string | null {
    const trimmed = epochText.trim();
    console.log('[OH-Timestamps] Checking text:', JSON.stringify(trimmed));
    
    if (!/^\d{10,13}$/.test(trimmed)) {
        console.log('[OH-Timestamps] Not a valid timestamp format (10-13 digits)');
        return null;
    }
    
    const num = Number(trimmed);
    if (!Number.isFinite(num)) {
        console.log('[OH-Timestamps] Not a finite number');
        return null;
    }
    
    const ms = trimmed.length === 13 ? num : num * 1000;
    const d = new Date(ms);
    if (isNaN(d.getTime())) {
        console.log('[OH-Timestamps] Invalid date');
        return null;
    }
    
    const humanDate = d.toLocaleString();
    console.log('[OH-Timestamps] Converted', trimmed, 'to', humanDate);
    return humanDate;
}

function convertTimestampsInContainer(container: HTMLElement): void {
    console.log('[OH-Timestamps] Processing container:', container);

    const boldElements = container.querySelectorAll<HTMLElement>('b, strong');
    console.log('[OH-Timestamps] Found', boldElements.length, 'bold/strong elements');

    boldElements.forEach(el => {
        const txt = el.textContent ?? '';
        console.log('[OH-Timestamps] Processing element with text:', JSON.stringify(txt));

        const human = parseEpochToDateString(txt);
        if (human) {
            const originalEpoch = txt.trim();
            // Make human-readable visible; keep machine-readable in title
            el.title = originalEpoch;
            el.textContent = human;
            (el as HTMLElement).dataset['ohTsDone'] = '1';
            console.log('[OH-Timestamps] Updated element → title(epoch):', originalEpoch, ' visible(human):', human);
            return;
        }

        // If already processed in an older format (title had human, text had epoch), migrate
        const titleText = el.getAttribute('title')?.trim() ?? '';
        if (/^\d{10,13}$/.test(txt.trim()) && titleText && !/^\d{10,13}$/.test(titleText)) {
            const human2 = parseEpochToDateString(txt);
            if (human2) {
                el.title = txt.trim();
                el.textContent = human2;
                (el as HTMLElement).dataset['ohTsDone'] = '1';
                console.log('[OH-Timestamps] Migrated old mapping → title(epoch):', txt.trim(), ' visible(human):', human2);
            }
            return;
        }

        console.log('[OH-Timestamps] No valid timestamp found in element');
    });
}

function handlePostForTimestamps(post: HTMLElement): void {
    const box = findActivityBox(post);
    if (!box) return;
    convertTimestampsInContainer(box);
}

let tsObserver: MutationObserver | null = null;

function initTimestampTooltips(): void {
    try {
        // Process existing posts
        document.querySelectorAll<HTMLElement>(POST_SEL).forEach(handlePostForTimestamps);

        // Observe future additions
        if (tsObserver) tsObserver.disconnect();
        tsObserver = new MutationObserver(muts => {
            muts.forEach(m => {
                m.addedNodes.forEach(n => {
                    if (!(n instanceof HTMLElement)) return;
                    if (n.matches(POST_SEL)) {
                        handlePostForTimestamps(n);
                    } else {
                        n.querySelectorAll?.<HTMLElement>(POST_SEL).forEach(handlePostForTimestamps);
                    }
                });
            });
        });
        tsObserver.observe(document.body, { childList: true, subtree: true });
    } catch {
        /* no-op */
    }
}

/* Optional: auto-boot if this file is included standalone. */
bootUiAesthetics();
