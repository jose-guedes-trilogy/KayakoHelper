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

/* ───────────── Helpers ───────────── */

const IMG_EXT_RE      = /\.(png|jpe?g|gif|webp|svg)$/i;
const KAYAKO_MEDIA_RE = /\/media\/url\//i;

const extractUrls = (html?: string): string[] => {
    const src = html ?? '';
    const out = new Set<string>();
    const re  = /https?:\/\/[^\s"'\\\]]+/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) out.add(m[0]);
    return [...out];
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
let cache: Record<'links'|'images'|'attachments', { url: string; post: number }[]> =
    { links: [], images: [], attachments: [] };
let isLoading   = false;

export const PAGE_LIMIT = PAGE_SIZE;

export const getState = () => ({ fetched, totalPosts, cache, isLoading });

/* ───────────── Loader ───────────── */

export async function loadAssets(limit: number): Promise<void> {
    if (isLoading) return;
    isLoading = true;

    try {
        const rawResp = await fetchCasePostsWithAssets(limit) as unknown;
        const obj     = rawResp as Record<string, unknown>;
        const posts   = (obj['posts'] ?? obj['data'] ?? []) as PostWithAssets[];
        const total   = Number(obj['total_count'] ?? obj['total'] ?? posts.length);

        if (!posts.length) return;

        totalPosts = total;
        fetched    = posts.length;

        cache = { links: [], images: [], attachments: [] };

        for (const p of posts) {
            const inlineImgs = new Set(grabInlineImageSrc(p.contents));
            inlineImgs.forEach(u => cache.images.push({ url: u, post: p.id }));

            extractUrls(p.contents).forEach(u => {
                if (inlineImgs.has(u)) return;
                cache.links.push({ url: u, post: p.id });
                if (isProbablyImage(u)) cache.images.push({ url: u, post: p.id });
            });

            let hasNonImageAttachment = false;
            for (const att of p.attachments ?? []) {
                const dl = att.url_download ?? att.url;
                if (!dl) continue;
                if (att.type?.startsWith('image/')) {
                    // Image attachments should appear only in Images, not in Attachments
                    cache.images.push({ url: dl, post: p.id });
                } else {
                    cache.attachments.push({ url: dl, post: p.id });
                    hasNonImageAttachment = true;
                }
            }
            // Only include download_all when there is at least one non-image attachment
            if (hasNonImageAttachment && p.download_all)
                cache.attachments.push({ url: p.download_all, post: p.id });
        }

        /* dedupe */
        const dedup = <T extends { url: string }>(arr: T[]) =>
            Array.from(new Map(arr.map(o => [o.url, o])).values());
        cache.links       = dedup(cache.links);
        cache.images      = dedup(cache.images);
        cache.attachments = dedup(cache.attachments);

        /* group links by domain (adds header rows) */
        if (cache.links.length) {
            const grouped: Record<keyof typeof CATEGORY_LABELS, typeof cache.links> = {
                salesforce: [], netsuite: [],
                kayako_instances: [], kayako_tickets: [], kayako_articles: [], kayako: [],
                github: [], jira: [], other: [],
            };
            cache.links.forEach(l => grouped[classify(l.url)].push(l));

            // Diagnostic counts for categories
            try { console.log('[AssetsInspector] Link categories', Object.fromEntries(Object.entries(grouped).map(([k,v]) => [k, v.length]))); } catch {}

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
    } finally {
        isLoading = false;
    }
}
