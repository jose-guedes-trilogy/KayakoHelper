import { KAYAKO_SELECTORS } from '@/generated/selectors.ts';
import {
    fetchSideConversations,
    SideConversationItem,
    SideConversationsResponse,
} from '@/utils/api.ts';
import { currentConvId } from '@/utils/location.ts';

/* ------------------------------------------------------------------ */
/*  Local aliases to SC selectors (from generated KAYAKO_SELECTORS)    */
/* ------------------------------------------------------------------ */
const SEL = {
    listHeader: KAYAKO_SELECTORS.sc_list_header,
    listTitle: KAYAKO_SELECTORS.sc_list_title,
    listAddBtn: KAYAKO_SELECTORS.sc_list_addBtn,
    detailContent: KAYAKO_SELECTORS.sc_detail_content,
    hidden: KAYAKO_SELECTORS.sc_hidden,
    detailHeader: KAYAKO_SELECTORS.sc_detail_header,
    detailTitle: KAYAKO_SELECTORS.sc_detail_title,
    recipientsRow: KAYAKO_SELECTORS.sc_recipients_row,
    recipient: KAYAKO_SELECTORS.sc_recipient,
    senderEmail: KAYAKO_SELECTORS.sc_senderEmail,
    timestamp: KAYAKO_SELECTORS.sc_timestamp,
};

const EMAIL_RX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const q = (s: string, root: ParentNode = document) => root.querySelector(s);
const qa = (s: string, root: ParentNode = document) => Array.from(root.querySelectorAll(s));

function extractEmailsFromText(s = ''): string[] {
    return (s.match(EMAIL_RX) || []).map((e) => e.toLowerCase());
}

function uniq<T>(arr: T[]): T[] {
    return [...new Set(arr.filter(Boolean))];
}

function normSubject(s = ''): string {
    return s
        .replace(/^\s*((re|fwd)\s*:\s*)+/gi, '')
        .replace(/\[(sc-\d+)\]/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function isSideConversationOpen(doc: Document = document): boolean {
    const hdr = q(SEL.detailHeader, doc);
    const open = !!(hdr && !(hdr as HTMLElement).closest(SEL.hidden));
    return open;
}

function getOpenSideConversationFingerprint(doc: Document = document) {
    if (!isSideConversationOpen(doc)) {
        return null;
    }
    const titleEl = q(`${SEL.detailHeader} ${SEL.detailTitle}`, doc) as
        | HTMLElement
        | null;
    const subjectRaw = (
        titleEl?.childNodes?.[0]?.textContent || titleEl?.textContent || ''
    )
        .trim();
    const recipNodes = qa(`${SEL.recipientsRow} ${SEL.recipient}`, doc);
    const toEmails = recipNodes
        .map((el) => extractEmailsFromText(el.textContent || ''))
        .flat();
    const lastSenderEmail =
        Array.from(doc.querySelectorAll(SEL.senderEmail))
            .at(-1)
            ?.textContent?.trim()
            ?.toLowerCase() || null;
    const lastTsText =
        Array.from(doc.querySelectorAll(SEL.timestamp))
            .at(-1)
            ?.textContent?.trim() || null;
    const fp = {
        subjectRaw,
        subjectN: normSubject(subjectRaw),
        toEmails: uniq(toEmails),
        lastSenderEmail,
        lastTsText,
    };
    return fp;
}

function extractEmailsPermissive(anyVal: unknown): string[] {
    const out = new Set<string>();
    const walk = (v: unknown) => {
        if (!v) return;
        if (typeof v === 'string') {
            extractEmailsFromText(v).forEach((e) => out.add(e));
        } else if (Array.isArray(v)) {
            v.forEach(walk);
        } else if (typeof v === 'object') {
            const o = v as Record<string, unknown>;
            if (o['email']) walk(String(o['email']));
            if (o['fullname']) walk(String(o['fullname']));
            for (const [k, val] of Object.entries(o)) {
                if (k === 'email' || k === 'fullname') continue;
                if (typeof val === 'string') walk(val);
                else if (Array.isArray(val)) val.forEach(walk);
                else if (val && typeof val === 'object') {
                    for (const vv of Object.values(
                        val as Record<string, unknown>,
                    )) {
                        if (typeof vv === 'string') walk(vv);
                    }
                }
            }
        }
    };
    walk(anyVal);
    return [...out];
}

type NormalizedSC = {
    id: string | number | null;
    uuid: string | null;
    subject: string;
    subjectN: string;
    emails: string[];
    created_at?: string | null;
    updated_at?: string | null;
    _raw: SideConversationItem;
};

function normalizeApiSideConversations(
    apiJson: SideConversationsResponse,
): NormalizedSC[] {
    const items = Array.isArray(apiJson?.data) ? apiJson.data : [];
    return items.map((it) => {
        const subject = it?.subject || it?.first_message?.subject || '';
        const fm = it?.first_message || {};
        const sender = (fm as any).email
            ? String((fm as any).email).toLowerCase()
            : '';
        const recips = extractEmailsPermissive((fm as any).recipients ?? []);
        return {
            id: it.id ?? null,
            uuid: it.uuid ?? null,
            subject,
            subjectN: normSubject(subject),
            emails: uniq([sender, ...recips]),
            created_at: it.created_at || (fm as any).created_at || null,
            updated_at: it.updated_at || (fm as any).updated_at || null,
            _raw: it,
        };
    });
}

function scoreCandidate(
    apiItem: NormalizedSC,
    fp: ReturnType<typeof getOpenSideConversationFingerprint>,
): number {
    if (!fp) return 0;
    let s = 0;
    if (apiItem.subjectN === fp.subjectN) s += 5;
    else if (
        apiItem.subjectN &&
        fp.subjectN &&
        (apiItem.subjectN.includes(fp.subjectN) ||
            fp.subjectN.includes(apiItem.subjectN))
    )
        s += 3;
    const overlap = fp.toEmails.filter((e) => apiItem.emails.includes(e))
        .length;
    s += Math.min(overlap, 3);
    if (fp.lastSenderEmail && apiItem.emails.includes(fp.lastSenderEmail)) s += 1;
    return s;
}

function getCurrentlyOpenSideConversationIdFromApi(
    apiJson: SideConversationsResponse,
    doc: Document = document,
) {
    const fp = getOpenSideConversationFingerprint(doc);
    if (!fp) return null;
    const apiItems = normalizeApiSideConversations(apiJson);
    if (apiItems.length === 0) {
        return null;
    }
    let candidates = apiItems.filter((it) => it.subjectN === fp.subjectN);
    const ranked = (candidates.length ? candidates : apiItems)
        .map((it) => ({ it, score: scoreCandidate(it, fp) }))
        .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (!best || best.score <= 0) {
        return null;
    }
    return { id: best.it.id, uuid: best.it.uuid };
}

/* ------------------------------------------------------------------ */
/*  Buttons & mounting                                                 */
/* ------------------------------------------------------------------ */
const IDS = {
    copyAll: 'kh-copy-all-sc',
    copyOne: 'kh-copy-this-sc',
};

function ensureRelative(el: HTMLElement): void {
    const cs = getComputedStyle(el);
    if (cs.position === 'static') el.style.position = 'relative';
}

function createButton(
    id: string,
    label: string,
    onClick: () => void,
    styles?: Partial<CSSStyleDeclaration>,
): HTMLButtonElement {
    let btn = document.getElementById(id) as HTMLButtonElement | null;
    if (btn) return btn;
    btn = document.createElement('button');
    btn.id = id;
    btn.type = 'button';
    btn.textContent = label;
    btn.style.cssText =
        'font: 12px/1.2 system-ui, sans-serif; padding: 4px 8px; border: 1px solid #d0d4d9; border-radius: 6px; background:#fff; cursor:pointer;';
    Object.assign(btn.style, styles || {});
    btn.addEventListener('click', onClick);
    return btn;
}

async function handleCopyAll(caseId: number | string): Promise<void> {
    const resp = await fetchSideConversations(caseId);
    const items = resp.data;
    const text = JSON.stringify(items, null, 2);
    await copyToClipboard(text);
    toast('All side conversations copied.');
}

async function handleCopyOne(caseId: number | string): Promise<void> {
    const resp = await fetchSideConversations(caseId);
    const chosen = getCurrentlyOpenSideConversationIdFromApi(resp);
    if (!chosen) {
        toast('Could not detect the open side conversation.');
        return;
    }
    const item = resp.data.find((it) => String(it.id) === String(chosen.id));
    if (!item) {
        toast('Open side conversation not found in API list.');
        return;
    }
    const text = JSON.stringify(item, null, 2);
    await copyToClipboard(text);
    toast(`Side conversation ${chosen.id} copied.`);
}

async function copyToClipboard(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
    }
}

function toast(msg: string): void {
    console.log(msg);
}

function mountButtons(): void {
    const caseId = currentConvId();
    if (!caseId) {
        return;
    }

    // 1) Copy all SC — in the list header between title and plus (+)
    const header = q(SEL.listHeader) as HTMLElement | null;
    const title = q(SEL.listTitle, header || undefined);
    const addBtn = q(SEL.listAddBtn, header || undefined);
    if (header && title) {
        const btnAll = createButton(
            IDS.copyAll,
            'Copy all SC',
            () => handleCopyAll(caseId),
            { marginLeft: '8px' },
        );
        if (!document.getElementById(IDS.copyAll)) {
            if (title.nextSibling) title.parentElement?.insertBefore(btnAll, title.nextSibling);
            else title.parentElement?.appendChild(btnAll);
            if (addBtn && btnAll.nextSibling !== addBtn) header.insertBefore(btnAll, addBtn);
        }
    } else {
    }

    // 2) Copy this SC — absolutely positioned in the detail content top-right, shown only if open
    const detailContent = q(SEL.detailContent) as HTMLElement | null;
    if (detailContent) {
        ensureRelative(detailContent);
        const btnOne = createButton(IDS.copyOne, 'Copy this SC', () => handleCopyOne(caseId), {
            position: 'absolute',
            right: '8px',
            top: '8px',
            zIndex: '10',
        });
        if (!document.getElementById(IDS.copyOne)) {
            detailContent.appendChild(btnOne);
        }
        (document.getElementById(IDS.copyOne) as HTMLElement).style.display =
            isSideConversationOpen() ? 'inline-block' : 'none';
    } else {
    }
}

export function initSideConversationsFeature(): void {
    // Initial mount
    mountButtons();

    // Observe DOM changes to remount or toggle visibility as SPA re-renders
    const obs = new MutationObserver(() => {
        mountButtons();
    });
    obs.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
    });

    // Additionally, watch clicks on the Side Conversations icon to attempt remount
    const tryBindIcon = () => {
        const icon = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.sideConversationIcon);
        if (!icon) {
            return;
        }
        if ((icon as any)._kh_sc_bound) return;
        (icon as any)._kh_sc_bound = true;
        icon.addEventListener('click', () => {
            setTimeout(mountButtons, 50);
            setTimeout(mountButtons, 250);
            setTimeout(mountButtons, 1000);
        });
    };
    tryBindIcon();
    const bindObs = new MutationObserver(() => tryBindIcon());
    bindObs.observe(document.body, { childList: true, subtree: true });
}

export function bootSideConversations(): void {
    initSideConversationsFeature();
}


