/*  Assets-inspector – data layer (types, fetch, cache, helpers)  */

import type { Post } from '@/modules/kayako/buttons/copy-chat/cleanConversation.ts';
import { fetchCasePostsWithAssets, PAGE_SIZE } from '@/utils/api.ts';
import { EXTENSION_SELECTORS } from '@/generated/selectors.ts';

export interface Attachment {
    url?: string;
    url_download?: string;
    type?: string;
}
export interface PostWithAssets extends Post {
    id: number;
    contents: string;
    attachments?: Attachment[];
    download_all?: string;
}

/**
 * Represents a link discovered in a post. When available, includes the
 * visible anchor text for improved UI display and filtering.
 */
export interface LinkItem { url: string; post: number; text?: string }

/* ───────────── Helpers ───────────── */

const IMG_EXT_RE      = /\.(png|jpe?g|gif|webp|svg)$/i;
const KAYAKO_MEDIA_RE = /\/media\/url\//i;

const extractUrls = (html?: string): string[] => {
    const src = html ?? '';
    const out = new Set<string>();
    // Match http(s)://, protocol-relative //, and www.-prefixed domains
    const re  = /(?:(?:https?:)?\/\/|www\.)[^\s"'\\\]]+/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) out.add(m[0]);
    const arr = [...out];
    try {
        console.info('[AssetsInspector][data] extractUrls', {
            inputLength: src.length,
            found: arr.length,
            sample: arr.slice(0, 10),
        });
    } catch {}
    return arr;
};

/** Remove terminal commas/periods accidentally appended to URLs (e.g., Kayako compose). */
const sanitizeUrl = (raw: string): string => {
    try {
        let u = (raw || '').trim();
        // Only trim trailing commas or periods (ASCII + some common unicode fullwidth variants)
        const TRIM_CHARS = /[.,\uFF0C\u3002]+$/u;
        const original = u;
        while (TRIM_CHARS.test(u)) u = u.replace(TRIM_CHARS, '');
        if (u !== original) {
            try { console.log('[AssetsInspector] Sanitized URL', { original, sanitized: u }); } catch {}
        }
        return u;
    } catch { return raw; }
};

/** Parse <a href="...">text</a> anchors from the HTML and return href + text. */
const extractAnchors = (html?: string): Array<{ url: string; text: string }> => {
    try {
        const src = html ?? '';
        if (!src || !src.toLowerCase().includes('<a')) return [];
        const tmp = document.createElement('div');
        tmp.innerHTML = src;
        const out: Array<{ url: string; text: string }> = [];
        tmp.querySelectorAll('a[href]').forEach(a => {
            const href = (a.getAttribute('href') || '').trim();
            if (!href) return;
            if (/^(?:javascript:|mailto:)/i.test(href)) return;
            const text = (a.textContent || '').trim();
            let absolute = href;
            if (!/^https?:/i.test(href)) {
                try {
                    const base = (typeof location !== 'undefined' && (location as any)?.href) ? (location as any).href : undefined as unknown as string;
                    absolute = base ? new URL(href, base).toString() : new URL(href).toString();
                } catch { /* keep original */ }
            }
            out.push({ url: sanitizeUrl(absolute), text });
        });
        try {
            console.info('[AssetsInspector][data] extractAnchors', {
                inputLength: src.length,
                found: out.length,
                sample: out.slice(0, 10),
            });
        } catch {}
        return out;
    } catch (err) {
        try { console.warn('[AssetsInspector] extractAnchors failed', err); } catch {}
        return [];
    }
};

const grabInlineImageSrc = (html?: string): string[] => {
    const src = html ?? '';
    const urls: string[] = [];
    const re = /\[img[^][]*?\s+src\s*=\s*"([^"]+)"[^]]*]/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
        const captured = m[1] ?? '';
        if (captured) urls.push(captured);
    }
    try {
        console.info('[AssetsInspector][data] grabInlineImageSrc', {
            inputLength: src.length,
            found: urls.length,
            sample: urls.slice(0, 10),
        });
    } catch {}
    return urls;
};

const isProbablyImage = (url: string) =>
    IMG_EXT_RE.test(url) || KAYAKO_MEDIA_RE.test(url);

/* domain-classifier – updated to split Kayako links */
export const classify = (u: string):
    | 'salesforce' | 'netsuite'
    | 'kayako_instances' | 'kayako_tickets' | 'kayako_articles' | 'kayako'
    | 'jira' | 'github' | 'other' => {

    if (/(?:\.|^)force\.com/i.test(u) || /salesforce\.com/i.test(u)) return 'salesforce';
    if (/netsuite\.com/i.test(u))                                      return 'netsuite';
    if (u.includes('github.com/'))                                      return 'github';
    if (u.includes('.atlassian.net'))                                   return 'jira';

    // Kayako domains
    if (/\.kayako\.com/i.test(u)) {
        try {
            const href = (typeof location !== 'undefined' && (location as any)?.href) ? (location as any).href : undefined as unknown as string;
            const url = href ? new URL(u, href) : new URL(u);
            const path = url.pathname || '/';
            if (/^\/agent\/conversations\//i.test(path)) return 'kayako_tickets';
            if (/^\/article\//i.test(path))               return 'kayako_articles';
            if (path === '/' || path === '')                return 'kayako_instances';
            return 'kayako';
        } catch {
            if (/\/agent\/conversations\//i.test(u)) return 'kayako_tickets';
            if (/\/article\//i.test(u))               return 'kayako_articles';
            return 'kayako';
        }
    }

    return 'other';
};

export const CATEGORY_LABELS = {
    salesforce       : 'Salesforce Links',
    netsuite         : 'NetSuite Links',
    kayako_instances : 'Kayako Instances',
    kayako_tickets   : 'Kayako Tickets',
    kayako_articles  : 'Kayako Articles',
    kayako           : 'Kayako Link',
    github           : 'GitHub Links',
    jira             : 'Jira Links',
    other            : 'Other Links',
} as const;

/* ───────────── State ───────────── */

let fetched     = 0;
let totalPosts  = 0;
type CacheType = {
    links: LinkItem[];
    images: { url: string; post: number }[];
    attachments: { url: string; post: number }[];
};
let cache: CacheType = { links: [], images: [], attachments: [] };
let isLoading   = false;

export const PAGE_LIMIT = PAGE_SIZE;

export const getState = () => ({ fetched, totalPosts, cache, isLoading });

/* ───────────── Loader ───────────── */

export async function loadAssets(limit: number): Promise<void> {
    if (isLoading) { try { console.warn('[AssetsInspector][data] loadAssets: already loading, skipping'); } catch {} return; }
    isLoading = true;

    try {
        try { console.info('[AssetsInspector][data] loadAssets:start', { limit }); } catch {}
        const rawResp = await fetchCasePostsWithAssets(limit) as unknown;
        const obj     = rawResp as Record<string, unknown>;
        const posts   = (obj['posts'] ?? obj['data'] ?? []) as PostWithAssets[];
        const total   = Number(obj['total_count'] ?? obj['total'] ?? posts.length);
        try { console.info('[AssetsInspector][data] loadAssets:response', { posts: posts.length, total }); } catch {}

        if (!posts.length) return;

        totalPosts = total;
        fetched    = posts.length;

        cache = { links: [], images: [], attachments: [] };

        // High-level response overview
        try {
            console.info('[AssetsInspector][data] posts overview', {
                fetched,
                totalPosts,
                postIds: posts.map(p => p.id),
                sample: posts.slice(0, 3).map(p => ({
                    id: p.id,
                    contentsLength: (p.contents || '').length,
                    hasContents: !!p.contents,
                    attachmentsCount: (p.attachments || []).length,
                    hasDownloadAll: !!p.download_all,
                })),
            });
        } catch {}

        // Helper: extract HTML/text content from various possible fields
        const pickPostHtml = (post: any): string => {
            try {
                const keyedCandidates: Array<[string, unknown]> = [
                    ['contents', post?.contents],
                    ['content', post?.content],
                    ['body_html', post?.body_html],
                    ['body', post?.body],
                    ['bodyText', post?.bodyText],
                    ['body_text', post?.body_text],
                    ['message', post?.message],
                    ['note.body_html', post?.note?.body_html],
                    ['post.body_html', post?.post?.body_html],
                    ['original.body_html', post?.original?.body_html],
                    ['original.body_text', post?.original?.body_text],
                ];
                const found = keyedCandidates.find(([, v]) => typeof v === 'string' && (v as string).length > 0);
                const chosen = (found?.[1] as string) || '';
                const key = found?.[0] || '';
                if (key) { try { console.info('[AssetsInspector][data] pickPostHtml', { id: post?.id, key, length: chosen.length }); } catch {} }
                if (!chosen) {
                    try { console.warn('[AssetsInspector][data] No HTML contents for post', { id: post?.id, keys: Object.keys(post || {}) }); } catch {}
                }
                return chosen;
            } catch {
                return '';
            }
        };

        // Helper: normalize attachments array from various possible fields
        const pickAttachments = (post: any): Attachment[] => {
            try {
                const raw = (post?.attachments ?? post?.attachment ?? post?.files ?? []) as any;
                const arr: any[] = Array.isArray(raw) ? raw : (raw ? [raw] : []);
                return arr.map(x => ({ url: x?.url, url_download: x?.url_download ?? x?.download_url ?? x?.href, type: x?.type ?? x?.mime_type })) as Attachment[];
            } catch {
                return [] as Attachment[];
            }
        };

        for (const p of posts) {
            try {
                const prefix = `[AssetsInspector][data][post:${p.id}]`;
                console.groupCollapsed?.('[AssetsInspector][data] post', p.id);
                console.info(prefix, 'meta', {
                    id: p.id,
                    keys: Object.keys(p || {}),
                    contentsLength: (pickPostHtml(p) || '').length,
                    attachmentsCount: (pickAttachments(p) || []).length,
                    hasDownloadAll: !!p.download_all,
                });
                // Full dump for visibility in consoles where groups don't expand
                console.info(prefix, 'full-post-object', p);
                const full = pickPostHtml(p) ?? '';
                console.info(prefix, 'full-contents', full);
            } catch {}
            const html = pickPostHtml(p);
            const inlineImgs = new Set(grabInlineImageSrc(html));
            inlineImgs.forEach(u => cache.images.push({ url: u, post: p.id }));
            try {
                const prefix = `[AssetsInspector][data][post:${p.id}]`;
                console.info(prefix, 'inlineImgs -> images[]', { count: inlineImgs.size, sample: [...inlineImgs].slice(0, 10) });
            } catch {}

            // First, collect anchors with their visible text
            const anchors = extractAnchors(html);
            const anchorUrlSet = new Set(anchors.map(a => a.url));
            try {
                const prefix = `[AssetsInspector][data][post:${p.id}]`;
                console.info(prefix, 'anchors', { count: anchors.length, sample: anchors.slice(0, 10) });
            } catch {}
            anchors.forEach(({ url, text }) => {
                const clean = sanitizeUrl(url);
                cache.links.push({ url: clean, post: p.id, text });
                if (isProbablyImage(clean)) cache.images.push({ url: clean, post: p.id });
            });

            // Then, collect any remaining bare URLs not already covered by anchors
            const rawUrls = extractUrls(html);
            let skippedInline = 0, skippedAnchorDupe = 0, kept = 0;
            rawUrls.forEach(u => {
                if (inlineImgs.has(u)) { skippedInline++; return; }
                if (anchorUrlSet.has(u)) { skippedAnchorDupe++; return; }
                const clean = sanitizeUrl(u);
                cache.links.push({ url: clean, post: p.id });
                if (isProbablyImage(clean)) cache.images.push({ url: clean, post: p.id });
                kept++;
            });
            try {
                const prefix = `[AssetsInspector][data][post:${p.id}]`;
                console.info(prefix, 'bareUrls processed', {
                    raw: rawUrls.length,
                    kept,
                    skippedInline,
                    skippedAnchorDupe,
                });
            } catch {}

            let hasNonImageAttachment = false;
            const attachments = pickAttachments(p);
            try {
                const prefix = `[AssetsInspector][data][post:${p.id}]`;
                console.info(prefix, 'attachments (normalized)', { count: attachments.length, sample: attachments.slice(0, 10) });
            } catch {}
            for (const att of attachments) {
                const dl = att.url_download ?? att.url;
                if (!dl) continue;
                const clean = sanitizeUrl(dl);
                if (att.type?.startsWith('image/')) {
                    // Image attachments should appear only in Images, not in Attachments
                    cache.images.push({ url: clean, post: p.id });
                    try {
                        const prefix = `[AssetsInspector][data][post:${p.id}]`;
                        console.info(prefix, 'attachment:image -> images[]', { url: clean, type: att.type });
                    } catch {}
                } else {
                    cache.attachments.push({ url: clean, post: p.id });
                    hasNonImageAttachment = true;
                    try {
                        const prefix = `[AssetsInspector][data][post:${p.id}]`;
                        console.info(prefix, 'attachment:file -> attachments[]', { url: clean, type: att.type });
                    } catch {}
                }
            }
            // Only include download_all when there is at least one non-image attachment
            const dlAllRaw = (p as any)?.download_all ?? (p as any)?.downloadAll ?? (p as any)?.attachments_download_all;
            if (hasNonImageAttachment && dlAllRaw) {
                const dlAll = sanitizeUrl(dlAllRaw);
                cache.attachments.push({ url: dlAll, post: p.id });
                try {
                    const prefix = `[AssetsInspector][data][post:${p.id}]`;
                    console.info(prefix, 'download_all -> attachments[]', { url: dlAll });
                } catch {}
            }
            try { console.groupEnd?.(); } catch {}
        }

        /* dedupe */
        const before = {
            links: cache.links.length,
            images: cache.images.length,
            attachments: cache.attachments.length,
        };
        const dedup = <T extends { url: string }>(arr: T[]) =>
            Array.from(new Map(arr.map(o => [o.url, o])).values());
        cache.links       = dedup(cache.links);
        cache.images      = dedup(cache.images);
        cache.attachments = dedup(cache.attachments);
        try { console.info('[AssetsInspector][data] dedupe', { before, after: { links: cache.links.length, images: cache.images.length, attachments: cache.attachments.length } }); } catch {}
        try { console.info('[AssetsInspector][data] loadAssets:cache built', { links: cache.links.length, images: cache.images.length, attachments: cache.attachments.length }); } catch {}

        /* group links by domain (adds header rows) */
        if (cache.links.length) {
            const grouped: Record<keyof typeof CATEGORY_LABELS, typeof cache.links> = {
                salesforce: [], netsuite: [],
                kayako_instances: [], kayako_tickets: [], kayako_articles: [], kayako: [],
                github: [], jira: [], other: [],
            };
            cache.links.forEach(l => grouped[classify(l.url)].push(l));

            // Diagnostic counts for categories
            try {
                const counts = Object.fromEntries(Object.entries(grouped).map(([k,v]) => [k, v.length]));
                const samples = Object.fromEntries(Object.entries(grouped).map(([k,v]) => [k, v.slice(0, 5)]));
                console.log('[AssetsInspector] Link categories', counts, samples);
            } catch {}

            const order: (keyof typeof grouped)[] = [
                'kayako_instances', 'kayako_tickets', 'kayako_articles', 'kayako',
                'salesforce', 'netsuite', 'github', 'jira', 'other',
            ];

            cache.links = ([] as typeof cache.links).concat(
                ...order.flatMap(k =>
                    grouped[k].length
                        ? [{ url: `--- ${CATEGORY_LABELS[k]} ---`, post: 0 }, ...grouped[k]]
                        : []),
            );
        }
    } catch (err) {
        try { console.error('[AssetsInspector][data] loadAssets:error', err); } catch {}
    } finally {
        isLoading = false;
    }
}
