import { cleanConversation, Post } from '@/modules/kayako/buttons/copy-chat/cleanConversation.ts';
import { currentConvId }           from './location.ts';

export const PAGE_SIZE       = 30;                            // how many posts we page by

/** Shape of the Kayako API response for posts */
interface ApiResponse {
    data: Post[];
}

interface RawApiResponse {
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
