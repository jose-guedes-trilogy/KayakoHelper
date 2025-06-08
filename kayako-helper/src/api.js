/*  API utilities
    – fetch & clean a conversation transcript
    – leave clipboard + UI to the caller                           */

import { cleanConversation } from './cleanConversation.js';
import { currentConvId }     from './utils/location.js';

/* ---------------------------------------------- */
/*  Public function                                */
/* ---------------------------------------------- */
export async function fetchTranscript(limit = 100) {
    const caseId = currentConvId();
    if (!caseId) throw new Error('Case ID not found in URL');

    const hostname = window.location.hostname;
    const url =
        `https://${hostname}/api/v1/cases/${caseId}` +
        `/posts.json?filters=MESSAGES,NOTES&include=user&limit=${limit}`;

    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Kayako API error ${res.status}`);

    const { data } = await res.json();
    return cleanConversation(data);
}
