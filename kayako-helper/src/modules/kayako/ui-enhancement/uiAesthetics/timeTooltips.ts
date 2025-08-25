import { KAYAKO_SELECTORS } from '@/generated/selectors.ts';

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

export function parseEpochToDateString(epochText: string): string | null {
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

    return d.toLocaleString();
}

export function formatRelativeTimeFromDate(date: Date): string {
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

export function parseDateFromTextLoose(text: string): Date | null {
    const t = (text || '').trim();
    if (!t) return null;
    const normalized = t
        .replace(/\bat\s+/i, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const d = new Date(normalized);
    if (!isNaN(d.getTime())) return d;
    return null;
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
            el.title = `${rel} - ${originalEpoch}`;
            el.textContent = human;
            (el as HTMLElement).dataset['ohTsDone'] = '1';
            return;
        }

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

export function initTimestampTooltips(): void {
    try {
        document.querySelectorAll<HTMLElement>(POST_SEL).forEach(handlePostForTimestamps);

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
    } catch {}
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
        try { console.debug('[OH time-tooltips] SC timestamp enhanced:', { text, rel }); } catch {}
    } catch {}
}

export function initSideConversationTimestamps(): void {
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

export function initHoverTimeTooltips(): void {
    try {
        const TOOLTIP_CONTENT_SEL_PRIMARY = KAYAKO_SELECTORS.tooltipContent || "[class*=ko-tooltip__tooltip_] .tooltipster-content";
        const TOOLTIP_CONTENT_SEL_FALLBACK = "[class*=tooltipster-content]";

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

export function initDaySeparatorTooltips(): void {
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
