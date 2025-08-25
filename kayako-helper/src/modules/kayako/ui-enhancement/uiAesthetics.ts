/* OmniHelper – uiAesthetics.ts
   Dark-mode compatibility for OmniHelper buttons.

   What it does:
   - Injects a CSS rule that styles only elements having `.dark-mode`.
   - Adds/removes `.dark-mode` on target selectors when the setting is toggled.
   - Writes the CSS custom properties directly on each target element so your
     chosen colors take effect even against heavy page/extension CSS.
   - Reacts live to storage changes and to DOM mutations.
*/

import { EXTENSION_SELECTORS, KAYAKO_SELECTORS } from '@/generated/selectors.ts';

/** Storage keys */
const KEY_COMPAT = 'uiDarkCompat';
const KEY_TEXT   = 'uiDarkTextColor';
const KEY_BG     = 'uiDarkBgColor';

/** Defaults */
const DEFAULT_TEXT = '#EAEAEA';
const DEFAULT_BG   = '#1E1E1E';

/** Style tag id */
const STYLE_ID = 'oh-dark-mode-style';
const HIDE_MESSENGER_STYLE_ID = 'kh-hide-messenger-style';
const KEY_HIDE_MESSENGER = 'hideMessenger';

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
    const tipRoot = (KAYAKO_SELECTORS as any).tooltipRoot || '[class*=ko-tooltip__tooltip_]';
    const tipBox = KAYAKO_SELECTORS.tooltipContainer || '[class*=ko-tooltip__tooltip_] [class*=tooltipster-box]';
    const tipContent = KAYAKO_SELECTORS.tooltipContent || '[class*=ko-tooltip__tooltip_] .tooltipster-content';
    style.textContent = `
${joined} {
  color: var(--dark-mode-text-color) !important;
  background: var(--dark-mode-background-color) !important;
}

/* Keep Kayako tooltips on one line and allow full width */
${tipRoot} {
  width: auto !important;
  max-width: none !important;
  height: auto !important;
}
${tipBox} {
  max-width: none !important;
}
${tipContent} {
  white-space: nowrap !important;
  max-width: none !important;
  max-height: none !important;
  overflow: visible !important;
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
    initHideMessenger();
    initTimestampTooltips();
    initSideConversationTimestamps();
    initHoverTimeTooltips();
    initDaySeparatorTooltips();
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

    if (!/^\d{10,13}$/.test(trimmed)) {
        return null;
    }
    
    const num = Number(trimmed);
    if (!Number.isFinite(num)) {
        return null;
    }
    
    const ms = trimmed.length === 13 ? num : num * 1000;
    const d = new Date(ms);
    if (isNaN(d.getTime())) {
        return null;
    }
    
    // return human-readable date
    return d.toLocaleString();
}

function convertTimestampsInContainer(container: HTMLElement): void {

    const boldElements = container.querySelectorAll<HTMLElement>('b, strong');

    boldElements.forEach(el => {
        const txt = el.textContent ?? '';

        const human = parseEpochToDateString(txt);
        if (human) {
            const originalEpoch = txt.trim();
            const num = Number(originalEpoch);
            const ms = originalEpoch.length === 13 ? num : num * 1000;
            const d = new Date(ms);
            const rel = formatRelativeTimeFromDate(d);
            // Visible: human date; Tooltip: "Time passed - Machine readable time"
            el.title = `${rel} - ${originalEpoch}`;
            el.textContent = human;
            (el as HTMLElement).dataset['ohTsDone'] = '1';
            return;
        }

        // If already processed in an older format (title had human, text had epoch), migrate
        const titleText = el.getAttribute('title')?.trim() ?? '';
        if (/^\d{10,13}$/.test(txt.trim()) && titleText && !/^\d{10,13}$/.test(titleText)) {
            const human2 = parseEpochToDateString(txt);
            if (human2) {
                const epoch = txt.trim();
                const num = Number(epoch);
                const ms = epoch.length === 13 ? num : num * 1000;
                const d = new Date(ms);
                const rel = formatRelativeTimeFromDate(d);
                el.title = `${rel} - ${epoch}`;
                el.textContent = human2;
                (el as HTMLElement).dataset['ohTsDone'] = '1';
            }
            return;
        }

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

/* ============================================================================
 * Additional time tooltip enhancers
 * ----------------------------------------------------------------------------
 * 1) Side-conversation timestamps: create tooltip showing relative time
 * 2) Timeline time/tooltips (tooltipstered): replace tooltip content with
 *    "Full Date - How Much Time Has Passed"
 * ---------------------------------------------------------------------------- */

function formatRelativeTimeFromDate(date: Date): string {
    try {
        const now = Date.now();
        const then = date.getTime();
        const diffMs = then - now;
        const absMs = Math.abs(diffMs);

        const dayMs = 24 * 60 * 60 * 1000;
        const hourMs = 60 * 60 * 1000;
        const minuteMs = 60 * 1000;

        let days = Math.floor(absMs / dayMs);
        let remainder = absMs % dayMs;
        let hours = Math.floor(remainder / hourMs);
        remainder = remainder % hourMs;
        let minutes = Math.floor(remainder / minuteMs);

        // Clamp tiny values
        if (days === 0 && hours === 0 && minutes === 0) minutes = 1;

        const parts: string[] = [];
        if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`);
        if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
        if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);

        const content = parts.length === 1
            ? parts[0]
            : parts.length === 2
                ? `${parts[0]} and ${parts[1]}`
                : `${parts[0]}, ${parts[1]} and ${parts[2]}`;

        return diffMs > 0 ? `in ${content}` : `${content} ago`;
    } catch {
        return '';
    }
}

function parseDateFromTextLoose(text: string): Date | null {
    const t = (text || '').trim();
    if (!t) return null;
    // Try to normalize common patterns like ": at 04:17" inside the date
    const normalized = t
        .replace(/\bat\s+/i, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const d = new Date(normalized);
    if (!isNaN(d.getTime())) return d;
    return null;
}

function enhanceSideConversationTimestamp(el: HTMLElement): void {
    try {
        if ((el as HTMLElement).dataset['ohTimeAug'] === '1') return;
        const text = el.textContent || '';
        const d = parseDateFromTextLoose(text);
        if (!d) return;
        const rel = formatRelativeTimeFromDate(d);
        if (!rel) return;
        el.setAttribute('title', rel);
        (el as HTMLElement).dataset['ohTimeAug'] = '1';
        // Logging per user request
        try { console.debug('[OH time-tooltips] SC timestamp enhanced:', { text, rel }); } catch {}
    } catch {}
}

function initSideConversationTimestamps(): void {
    try {
        const SC_TS = KAYAKO_SELECTORS.sc_timestamp || "[class*='side-conversations-panel_message-timeline__message-timestamp_']";
        const SC_CONTENT = KAYAKO_SELECTORS.sc_detail_content || "[class*='side-conversations-panel_individual-conversation__content']";
        const SC_LIST_TIME = (KAYAKO_SELECTORS as any).sc_list_time || "[class*='side-conversations-panel_conversations-list__conversation-time_']";

        document.querySelectorAll<HTMLElement>(SC_TS).forEach(enhanceSideConversationTimestamp);
        document.querySelectorAll<HTMLElement>(SC_LIST_TIME).forEach(enhanceSideConversationTimestamp);

        const obs = new MutationObserver(muts => {
            muts.forEach(m => {
                m.addedNodes.forEach(n => {
                    if (!(n instanceof HTMLElement)) return;
                    if (n.matches(SC_TS)) {
                        enhanceSideConversationTimestamp(n);
                    } else if (n.matches(SC_LIST_TIME)) {
                        enhanceSideConversationTimestamp(n);
                    } else {
                        n.querySelectorAll?.<HTMLElement>(SC_TS).forEach(enhanceSideConversationTimestamp);
                        n.querySelectorAll?.<HTMLElement>(SC_LIST_TIME).forEach(enhanceSideConversationTimestamp);
                    }
                });
            });
        });
        const container = document.querySelector(SC_CONTENT) || document.body;
        obs.observe(container!, { childList: true, subtree: true });
    } catch {}
}

function initHoverTimeTooltips(): void {
    try {
        // New sanitized selectors (fallback to string to avoid type churn until regenerated)
        const TOOLTIP_CONTENT_SEL_PRIMARY = KAYAKO_SELECTORS.tooltipContent || "[class*=ko-tooltip__tooltip_] .tooltipster-content";
        const TOOLTIP_CONTENT_SEL_FALLBACK = "[class*=tooltipster-content]";

        // Observe tooltip creation and rewrite content
        const tipObs = new MutationObserver(muts => {
            for (const m of muts) {
                m.addedNodes.forEach(node => {
                    if (!(node instanceof HTMLElement)) return;
                    const candidates = [
                        ...(node.matches(TOOLTIP_CONTENT_SEL_PRIMARY) ? [node] : Array.from(node.querySelectorAll(TOOLTIP_CONTENT_SEL_PRIMARY))),
                        ...(node.matches(TOOLTIP_CONTENT_SEL_FALLBACK) ? [node] : Array.from(node.querySelectorAll(TOOLTIP_CONTENT_SEL_FALLBACK)))
                    ] as HTMLElement[];
                    candidates.forEach(content => {
                        if ((content as HTMLElement).dataset['ohTimeAug'] === '1') return;
                        const full = content.textContent?.trim() || '';
                        if (!full) return;
                        const d = parseDateFromTextLoose(full);
                        if (!d) return;
                        const rel = formatRelativeTimeFromDate(d);
                        if (!rel) return;
                        content.textContent = `${full} - ${rel}`;
                        (content as HTMLElement).dataset['ohTimeAug'] = '1';
                        try { console.debug('[OH time-tooltips] Tooltip enhanced:', { full, rel }); } catch {}
                    });
                });
            }
        });
        tipObs.observe(document.body, { childList: true, subtree: true });
    } catch {}
}

function initDaySeparatorTooltips(): void {
    try {
        const DAY_SEP_SEL = KAYAKO_SELECTORS.daySeparatorText || "[class*=ko-timeline-2_list_days__day-separator__text_]";
        const DATE_WITHIN_SEL = (KAYAKO_SELECTORS as any).daySeparatorDate || "[class*=ko-timeline-2_list_days__day-separator__date_]";

        const enhance = (el: HTMLElement): void => {
            try {
                if ((el as HTMLElement).dataset['ohTimeAug'] === '1') return;
                const dateEl = el.querySelector<HTMLElement>(DATE_WITHIN_SEL) || el;
                const txt = dateEl.textContent || '';
                const d = parseDateFromTextLoose(txt);
                if (!d) return;
                const rel = formatRelativeTimeFromDate(d);
                if (!rel) return;
                el.setAttribute('title', rel);
                (el as HTMLElement).dataset['ohTimeAug'] = '1';
                try { console.debug('[OH time-tooltips] Day separator enhanced:', { txt, rel }); } catch {}
            } catch {}
        };

        document.querySelectorAll<HTMLElement>(DAY_SEP_SEL).forEach(enhance);

        const obs = new MutationObserver(muts => {
            muts.forEach(m => {
                m.addedNodes.forEach(n => {
                    if (!(n instanceof HTMLElement)) return;
                    if (n.matches(DAY_SEP_SEL)) {
                        enhance(n);
                    } else {
                        n.querySelectorAll?.<HTMLElement>(DAY_SEP_SEL).forEach(enhance);
                    }
                });
            });
        });
        obs.observe(document.body, { childList: true, subtree: true });
    } catch {}
}

/* ============================================================================
 * Hide Kayako Messenger (user setting)
 * ----------------------------------------------------------------------------
 */

function ensureHideMessengerStyle(): HTMLStyleElement {
    let style = document.getElementById(HIDE_MESSENGER_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement('style');
        style.id = HIDE_MESSENGER_STYLE_ID;
        (document.head || document.documentElement).appendChild(style);
    }
    return style;
}

function applyHideMessenger(hide: boolean): void {
    try {
        const style = ensureHideMessengerStyle();
        const messengerSel = (KAYAKO_SELECTORS as any).messenger || "#kayako-messenger, [id='kayako-messenger'], [class*='kayako-messenger']";
        style.textContent = hide ? `${messengerSel}{ display:none !important; }` : '';
        // Also proactively toggle display on existing nodes to react immediately
        document.querySelectorAll<HTMLElement>(messengerSel).forEach(el => {
            el.style.setProperty('display', hide ? 'none' : '');
        });
        try { console.debug('[KH] Hide messenger applied:', { hide }); } catch {}
    } catch (e) {
        try { console.warn('[KH] Failed to apply hideMessenger:', e); } catch {}
    }
}

function initHideMessenger(): void {
    try {
        // Initial load
        chrome.storage.sync.get([KEY_HIDE_MESSENGER] as const, res => {
            const hide = !!res[KEY_HIDE_MESSENGER];
            applyHideMessenger(hide);
        });

        // React to changes
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'sync') return;
            if (!(KEY_HIDE_MESSENGER in changes)) return;
            const hide = !!changes[KEY_HIDE_MESSENGER]!.newValue;
            applyHideMessenger(hide);
        });

        // Observe DOM for messenger node appearances
        const obs = new MutationObserver(muts => {
            let needApply = false;
            muts.forEach(m => {
                if (m.type !== 'childList') return;
                const nodes = Array.from(m.addedNodes);
                if (nodes.some(n => n instanceof HTMLElement)) needApply = true;
            });
            if (!needApply) return;
            chrome.storage.sync.get([KEY_HIDE_MESSENGER] as const, res => {
                const hide = !!res[KEY_HIDE_MESSENGER];
                if (hide) applyHideMessenger(true);
            });
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch {}
}
