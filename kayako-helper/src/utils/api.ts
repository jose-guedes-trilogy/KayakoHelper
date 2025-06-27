// src/utils/api.ts

import { cleanConversation, Post } from '@/modules/kayako/buttons/copy-chat/cleanConversation.ts';
import { currentConvId }           from './location.ts';

/** Shape of the Kayako API response for posts */
interface ApiResponse {
    data: Post[];
}

/**
 * Fetches the last `limit` posts for the current conversation,
 * cleans them into a transcript, and returns it.
 */
export async function fetchTranscript(limit: number = 100): Promise<string> {
    const caseId = currentConvId();
    if (!caseId) {
        throw new Error('Case ID not found in URL');
    }

    const hostname: string = window.location.hostname;
    const url: string =
        `https://${hostname}/api/v1/cases/${caseId}` +
        `/posts.json?filters=MESSAGES,NOTES&include=user&limit=${limit}`;

    const res: Response = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
        throw new Error(`Kayako API error ${res.status}`);
    }

    const json: ApiResponse = await res.json();
    return cleanConversation(json.data);
}
