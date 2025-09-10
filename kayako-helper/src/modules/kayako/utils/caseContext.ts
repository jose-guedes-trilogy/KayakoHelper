/* src/modules/kayako/utils/caseContext.ts
   Centralised per-ticket context: requesterId harvesting from network JSON
   and on-demand API fallback. Designed to be resilient and reusable. */

import { currentConvId } from '@/utils/location';

let cachedTicketId: string | null = null;
let cachedRequesterId: number | null = null;
let cachedOrganizationId: number | null = null;
let cachedOrganizationName: string | null = null;

const requesterWaiters: Array<(id: number | null) => void> = [];
const orgWaiters: Array<(org: { id: number | null; name: string | null }) => void> = [];
let bootstrapped = false;

function resetForTicket(newTicketId: string | null): void {
    if (newTicketId === cachedTicketId) return;
    cachedTicketId = newTicketId;
    cachedRequesterId = null;
    cachedOrganizationId = null;
    cachedOrganizationName = null;
}

function resolveRequesterWaiters(): void {
    const id = cachedRequesterId;
    while (requesterWaiters.length) {
        const fn = requesterWaiters.shift();
        try { fn?.(id); } catch {}
    }
}

function resolveOrgWaiters(): void {
    const payload = { id: cachedOrganizationId, name: cachedOrganizationName };
    while (orgWaiters.length) {
        const fn = orgWaiters.shift();
        try { fn?.(payload); } catch {}
    }
}

function tryExtractRequesterId(json: any): number | null {
    try {
        // Primary: sample JSON indicates data.requester.id
        const id1 = json?.data?.requester?.id;
        if (typeof id1 === 'number' && Number.isFinite(id1)) return id1;

        // Alternate shapes seen in some responses
        const id2 = json?.requester?.id;
        if (typeof id2 === 'number' && Number.isFinite(id2)) return id2;

        const id3 = json?.resources?.case?.requester?.id
            ?? json?.resources?.cases?.requester?.id
            ?? null;
        if (typeof id3 === 'number' && Number.isFinite(id3)) return id3;

        // Some responses inline the user object under resources.user[<id>]
        const userRes = json?.resources?.user || json?.resources?.users;
        if (userRes && typeof userRes === 'object') {
            // Prefer the user referenced by data.requester.id if present as string keys
            const maybe = Object.keys(userRes)[0];
            const guess = Number(maybe);
            if (Number.isFinite(guess)) return guess;
        }
    } catch {}
    return null;
}

function tryExtractOrganization(json: any): { id: number | null; name: string | null } {
    try {
        // Primary: resources.organization is a map keyed by id
        const orgMap = json?.resources?.organization || json?.resources?.organizations;
        if (orgMap && typeof orgMap === 'object') {
            const entries = Object.values(orgMap) as any[];
            if (entries.length) {
                const org = entries[0] || {};
                const id = typeof org?.id === 'number' ? org.id : null;
                const name = typeof org?.name === 'string' ? org.name : null;
                if (id || name) return { id, name };
            }
        }

        // Alternate shapes
        const id2 = json?.data?.organization?.id ?? json?.organization?.id ?? null;
        const name2 = json?.data?.organization?.name ?? json?.organization?.name ?? null;
        if ((typeof id2 === 'number' && Number.isFinite(id2)) || typeof name2 === 'string') {
            return { id: (typeof id2 === 'number' ? id2 : null), name: (typeof name2 === 'string' ? name2 : null) };
        }
    } catch {}
    return { id: null, name: null };
}

function installMessageTap(): void {
    window.addEventListener('message', ev => {
        try {
            if (ev.source !== window) return;
            const data: any = ev.data;
            if (!data || data.source !== 'KTC') return;
            // tagCleaner injector posts POSTS_JSON messages with the raw JSON
            if (data.kind !== 'POSTS_JSON') return;

            // Reset per-ticket based on URL
            resetForTicket(currentConvId());

            const id = tryExtractRequesterId(data.json);
            if (id && (!cachedRequesterId || cachedRequesterId !== id)) {
                cachedRequesterId = id;
                try { console.debug('[KH][caseContext] requesterId from POSTS_JSON', { id }); } catch {}
                resolveRequesterWaiters();
            }

            const org = tryExtractOrganization(data.json);
            if ((org.id && org.id !== cachedOrganizationId) || (org.name && org.name !== cachedOrganizationName)) {
                cachedOrganizationId = org.id ?? cachedOrganizationId;
                cachedOrganizationName = org.name ?? cachedOrganizationName;
                try { console.debug('[KH][caseContext] organization from POSTS_JSON', { id: cachedOrganizationId, name: cachedOrganizationName }); } catch {}
                resolveOrgWaiters();
            }
        } catch (err) {
            try { console.debug('[KH][caseContext] message tap error', err); } catch {}
        }
    });
}

async function fetchViaCaseApi(): Promise<void> {
    const ticketId = currentConvId();
    if (!ticketId) return;
    try {
        const url = `${location.origin}/api/v1/cases/${ticketId}`;
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) return;
        const js = await res.json();
        const reqId = tryExtractRequesterId(js);
        if (reqId) {
            cachedRequesterId = reqId;
            try { console.debug('[KH][caseContext] requesterId from /cases API', { id: reqId }); } catch {}
            resolveRequesterWaiters();
        }
        const org = tryExtractOrganization(js);
        if (org.id || org.name) {
            if (org.id) cachedOrganizationId = org.id;
            if (org.name) cachedOrganizationName = org.name;
            try { console.debug('[KH][caseContext] organization from /cases API', { id: cachedOrganizationId, name: cachedOrganizationName }); } catch {}
            resolveOrgWaiters();
        }
    } catch (err) {
        try { console.debug('[KH][caseContext] /cases API fetch error', err); } catch {}
        return;
    }
}

export function initCaseContext(): void {
    if (bootstrapped) return;
    bootstrapped = true;
    resetForTicket(currentConvId());

    // Poll for SPA route changes; light-weight
    let lastPath = location.pathname;
    setInterval(() => {
        if (location.pathname !== lastPath) {
            lastPath = location.pathname;
            resetForTicket(currentConvId());
        }
    }, 600);

    installMessageTap();
}

export function getRequesterId(): number | null {
    return cachedRequesterId;
}

export async function waitForRequesterId(timeoutMs = 2000): Promise<number | null> {
    initCaseContext();
    if (cachedRequesterId) return cachedRequesterId;

    // Kick off background fetch via Case API as a fallback
    void fetchViaCaseApi();

    return new Promise<number | null>(resolve => {
        const to = window.setTimeout(() => resolve(cachedRequesterId), timeoutMs);
        requesterWaiters.push(id => { clearTimeout(to); resolve(id); });
    });
}

export function getOrganization(): { id: number | null; name: string | null } {
    return { id: cachedOrganizationId, name: cachedOrganizationName };
}

export async function waitForOrganization(timeoutMs = 2000): Promise<{ id: number | null; name: string | null }> {
    initCaseContext();
    if (cachedOrganizationId || cachedOrganizationName) return { id: cachedOrganizationId, name: cachedOrganizationName };

    void fetchViaCaseApi();

    return new Promise(resolve => {
        const to = window.setTimeout(() => resolve({ id: cachedOrganizationId, name: cachedOrganizationName }), timeoutMs);
        orgWaiters.push(org => { clearTimeout(to); resolve(org); });
    });
}


