// src/utils/api.ts

import { cleanConversation, Post } from '@/modules/kayako/buttons/copy-chat/cleanConversation.ts';
import { currentConvId }           from './location.ts';

export const PAGE_SIZE       = 30;                            // how many posts we page by

/** Shape of the Kayako API response for posts */
export interface ApiResponse {
    data: Post[];
}

export interface RawApiResponse {
    data: Post[];
    total_count?: number;
    total?: number;
    [k: string]: unknown;
}

/**
 * Fetches the last `limit` posts (messages + notes) *raw* including attachments.
 * Always returns the latest posts for the current ticket.
 */
export async function fetchCasePostsWithAssets(
    limit: number = PAGE_SIZE,
): Promise<RawApiResponse> {                           //  ← change #1
    const caseId = currentConvId();
    if (!caseId) throw new Error('Case ID not found in URL');

    const hostname = window.location.hostname;
    const url =
        `https://${hostname}/api/v1/cases/${caseId}` +
        `/posts?include=attachment,post,note&filters=all&limit=${limit}`;

    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Kayako API error ${res.status}`);

    return res.json();                                  //  ← change #2
}

/**
 * Convenience: returns a plain-text transcript (used by other modules).
 */
export async function fetchTranscript(limit = 100): Promise<string> {
    const caseId = currentConvId();
    if (!caseId) throw new Error('Case ID not found in URL');

    const hostname = window.location.hostname;
    const url =
        `https://${hostname}/api/v1/cases/${caseId}` +
        `/posts.json?filters=MESSAGES,NOTES&include=user&limit=${limit}`;

    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Kayako API error ${res.status}`);

    const json: ApiResponse = await res.json();
    return cleanConversation(json.data);
}

/* ------------------------------------------------------------------ */
/*  Side Conversations API                                             */
/* ------------------------------------------------------------------ */

export interface SideConversationsResponse {
    status: number;
    data: SideConversationItem[];
    resource: string;        // "side_conversation"
    offset: number;
    limit: number;
    total_count: number;
    logs?: unknown[];
    session_id?: string;
}

export interface SideConversationItem {
    id: number | string;
    uuid?: string;
    subject?: string;
    first_message?: {
        id?: number | string;
        uuid?: string;
        subject?: string;
        body_text?: string;
        body_html?: string;
        recipients?: unknown;  // string[] | {email?: string, fullname?: string}[] | mixed
        fullname?: string;
        email?: string;
        creator?: unknown;
        identity?: unknown;
        mailbox?: unknown;
        attachments?: unknown[];
        download_all?: string;
        locale?: string;
        response_time?: unknown;
        created_at?: string;
        updated_at?: string;
        resource_type?: string;
        resource_url?: string;
    };
    message_count?: number;
    created_at?: string;
    updated_at?: string;
    status?: string;         // "open"
    resource_type?: string;  // "side_conversation"
    resource_url?: string;
}

const BASE = "https://central-supportdesk.kayako.com/api/v1";

export async function fetchSideConversations(
    caseId: number | string,
    offset = 0,
    limit = 1000,
    include = "*",
): Promise<SideConversationsResponse> {
    const url = `${BASE}/cases/${caseId}/side-conversations?caseId=${caseId}&offset=${offset}&limit=${limit}&include=${encodeURIComponent(include)}`;
    const res = await fetch(url, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            // Add your auth header here, e.g. "Authorization": `Bearer ${token}`
        },
        credentials: 'include',
    });
    if (!res.ok) {
        throw new Error(`fetchSideConversations failed: ${res.status} ${res.statusText}`);
    }
    return res.json();
}