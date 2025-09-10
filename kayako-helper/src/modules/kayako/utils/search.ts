/* src/modules/kayako/utils/search.ts
   Helpers for Kayako search and transcripts by case id. */

import { cleanConversation, Post } from '@/modules/kayako/buttons/copy-chat/cleanConversation.ts';

export async function searchConversationIds(
    query: string,
    limit: number,
    offset: number = 0,
): Promise<string[]> {
    const hostname = location.hostname;
    const params   = new URLSearchParams({
        query,
        offset: String(offset),
        limit : String(limit),
        fields:
            'data(requester(avatar%2Cfull_name)%2Clast_post_status%2Clast_replier(full_name%2Crole)%2Clast_message_preview%2Csubject%2Cpriority%2Cstate%2Cstatus%2Cassigned_agent(full_name%2Cavatar)%2Cupdated_at%2Clast_replied_at%2Chas_attachments)%2Cresource',
        include : 'case%2Ccase_status%2Ccase_priority%2Cuser%2Crole',
        resources: 'CASES',
    });

    const url = `https://${hostname}/api/v1/search?${params.toString()}`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Kayako search API ${res.status}`);

    const json = await res.json();
    return (json?.data ?? [])
        .map((item: any) => String(item?.resource?.id ?? item?.case?.id ?? item?.id ?? ''))
        .filter(Boolean)
        .slice(0, limit);
}

/** Quote a value for Kayako search. Escapes internal single quotes. */
export function quoteForSearch(value: string): string {
    const safe = (value ?? '').replace(/'/g, "\\'");
    return `'${safe}'`;
}

export async function fetchTranscriptByCase(
    caseId: string,
    limit: number,
): Promise<string> {
    const hostname = location.hostname;
    const url = `https://${hostname}/api/v1/cases/${caseId}/posts.json?filters=MESSAGES,NOTES&include=user&limit=${limit}`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Case ${caseId} – API ${res.status}`);
    const json: { data: Post[] } = await res.json();
    return cleanConversation(json.data);
}


