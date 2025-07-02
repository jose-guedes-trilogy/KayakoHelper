/*  src/modules/download-manager/geminiUploader.ts
    Upload Kayako ticket attachments straight to Gemini.
    ————————————————————————————————————————————————————————————————————
    CHANGES (2025-07-01)
    • Notify composer *first* (ESY5D), then upload, then register (MaZiqc).
    • Only one ESY5D per batch, not once per file.
    • Fix wrapper selector typo; more robust yFnxrf parsing.
    • **NEW:** keep a monotonic, large _reqid counter so Gemini accepts replies.
    • **NEW:** batch‑register all blobs in a single MaZiqc call.
*/

interface SerializedFile {
    name: string;
    type: string;
    buffer: ArrayBuffer;
}

const WRAPPER_SEL = '.leading-actions-wrapper';
const BTN_ID      = 'kayako-upload-btn';

let activeTicket: string | null = null;
let button: HTMLButtonElement;

/* ─────────────────────────  BOOTSTRAP  ───────────────────────── */

export function bootGeminiUploader(): void {
    if ((window as any).geminiUploaderHasBooted) return;
    (window as any).geminiUploaderHasBooted = true;

    if (location.hostname !== 'gemini.google.com') return;

    waitForWrapper().then(async wrapper => {
        if (wrapper.querySelector(`#${BTN_ID}`)) return; // already injected
        await createButton(wrapper);
    });
}

async function createButton(wrapper: HTMLElement): Promise<void> {
    button = document.createElement('button');
    button.id = BTN_ID;
    button.style.marginLeft = '0.5rem';
    button.onclick = () => { if (activeTicket) void startUpload(); };
    wrapper.appendChild(button);

    await refreshState();
    updateButtonUi();

    chrome.runtime.onMessage.addListener(msg => {
        if (msg.action === 'attachments.newTicket') {
            activeTicket = msg.ticketId as string;
            updateButtonUi();
        }
    });
}

/* ──────────────────────  TICKET STATE  ─────────────────────── */

async function refreshState(): Promise<void> {
    const resp: { tickets: string[] } = await chrome.runtime.sendMessage({
        action: 'attachments.listTickets',
    });
    activeTicket = resp.tickets[0] ?? null;
}

function updateButtonUi(): void {
    if (!button) return;
    if (activeTicket) {
        button.disabled = false;
        button.textContent = `Upload ⬆ Ticket ${activeTicket}`;
    } else {
        button.disabled = true;
        button.textContent = 'Upload ⬆ (no ticket)';
    }
}

/* ───────────────────────  MAIN FLOW  ───────────────────────── */

async function startUpload(): Promise<void> {
    if (!activeTicket) return;
    button.disabled = true;
    button.textContent = 'Uploading…';

    const { files }: { files: SerializedFile[] | null } =
        await chrome.runtime.sendMessage({
            action:   'attachments.getFiles',
            ticketId: activeTicket,
        });

    if (!files?.length) {
        alert('No files in RAM (maybe the service‑worker slept).');
        await refreshState();
        updateButtonUi();
        return;
    }

    try {
        /* 0️⃣ Let the composer know attachments are coming */
        await notifyComposerEnabled();

        /* 1️⃣ Upload every file and collect blob descriptors */
        const blobs: [string, [string, number, string, string]][] = [];

        for (const f of files) {
            const file  = new File([f.buffer], f.name, { type: f.type });
            const contrib = await uploadFileToGemini(file);   // returns path
            const meta: [string, number, string, string] = [
                file.name,
                file.size,
                file.type,
                `C:\\fakepath\\${file.name}`,
            ];
            blobs.push([contrib, meta]);
        }

        /* 2️⃣ Register *all* blobs in one MaZiqc call */
        await fireRpc(RPC_REGISTER, [[blobs]]);

        button.textContent = `Done ✔ (${files.length})`;
    } catch (err) {
        console.error(err);
        alert('Upload failed – check console.');
        updateButtonUi();
    } finally {
        button.disabled = false;
    }
}

/* ──────────────────  LOW‑LEVEL UPLOAD PIPELINE  ───────────────── */

export async function uploadFileToGemini(file: File): Promise<string> {
    /* 1. Grab the feed id (qKIAYe) straight from the inlined JSON. */
    const feedId =
        findInDom(/"qKIAYe":"(feeds\/[a-z0-9]+)"/i) ??
        (() => { throw new Error('feed id qKIAYe not found'); })();

    /* 2. Kick off a resumable session */
    const start = await fetch('https://push.clients6.google.com/upload/', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'push-id': feedId,
            'x-goog-upload-command': 'start',
            'x-goog-upload-protocol': 'resumable',
            'x-goog-upload-header-content-length': String(file.size),
            'x-tenant-id': 'bard-storage',
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'x-client-pctx': getClientPctx(),
        },
        body: `File name: ${encodeURIComponent(file.name)}`,
    });
    if (!start.ok) throw new Error(`push start ${start.status}`);

    const uploadUrl = start.headers.get('x-goog-upload-url');
    if (!uploadUrl) throw new Error('No x-goog-upload-url header');

    /* 3. Ship the bytes & finalise the session */
    const up = await fetch(uploadUrl, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'push-id': feedId,
            'x-goog-upload-command': 'upload, finalize',
            'x-goog-upload-offset': '0',
            'x-tenant-id': 'bard-storage',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'x-client-pctx': getClientPctx(),
        },
        body: file,
    });
    if (!up.ok) throw new Error(`push upload ${up.status}`);

    /* Response body is the contrib path “/contrib_service/ttl_1d/…” */
    return (await up.text()).trim();
}

/* ────────  BATCHEXECUTE RPCs  ───────── */

const RPC_REGISTER = 'MaZiqc';
const RPC_NOTIFY   = 'ESY5D';

async function notifyComposerEnabled(): Promise<void> {
    await fireRpc(RPC_NOTIFY, [[[['bard_activity_enabled']]]]);
}

/* ─────────────────────  RPC CORE  ───────────────────────── */

let reqCounter: number | null = null; // monotonic counter shared across calls

async function fireRpc(rpcId: string, payload: unknown): Promise<void> {
    const { fSid, at, bl, baseReqId } = getSessionTokens();

    /* 1️⃣ Initialise / synchronise counter */
    if (reqCounter === null || baseReqId * 1_000 > reqCounter) {
        reqCounter = baseReqId * 1_000;          // ← critical change
    }

    /* 2️⃣ Strictly monotonic step (UI uses 100 000) */
    reqCounter += 100_000;

    const qs = new URLSearchParams({
        rpcids: rpcId,
        'source-path': '/app',
        bl,
        'f.sid': fSid,
        hl: 'en',
        _reqid: String(reqCounter),
        rt: 'c',
    });

    const body = new URLSearchParams({
        'f.req': JSON.stringify([[[rpcId, JSON.stringify(payload), null, 'generic']]]),
        at,
    });

    const res = await fetch(
        'https://gemini.google.com/_/BardChatUi/data/batchexecute?' + qs,
        {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                'X-Same-Domain': '1',
                'x-goog-ext-525001261-jspb': '[]',
                'x-client-pctx': getClientPctx(),
            },
            body: body.toString(),
        },
    );

    if (!res.ok) throw new Error(`batchexecute ${rpcId} failed ${res.status}`);
}

/* ─────────────────────  UTILITIES  ───────────────────────── */

function getSessionTokens(): { fSid: string; at: string; bl: string; baseReqId: number } {
    const fSid     = findInDom(/"FdrFJe":"([^\"]+)"/);
    const atToken  = findInDom(/"SNlM0e":"([^\"]+)"/);
    const blVer    = findInDom(/"cfb2h":"([^\"]+)"/);
    const reqIdStr =
        findInDom(/"yFnxrf":"(\d+)"/)   // new: value is a *string* in the DOM‑dumped JSON
        ?? findInDom(/"yFnxrf":(\d+)/);   // fallback – old pattern

    if (!fSid || !atToken || !blVer || !reqIdStr) {
        throw new Error('Missing one of f.sid, at, bl or yFnxrf tokens');
    }
    return { fSid, at: atToken, bl: blVer, baseReqId: Number(reqIdStr) };
}

function getClientPctx(): string {
    const pctx = findInDom(/"Ylro7b":"([^\"]+)"/); // <script data-id="_gd">
    if (!pctx) throw new Error('x-client-pctx not found in DOM');
    return pctx;
}

function waitForWrapper(): Promise<HTMLElement> {
    return new Promise(resolve => {
        const id = setInterval(() => {
            const el = document.querySelector<HTMLElement>(WRAPPER_SEL);
            if (el) { clearInterval(id); resolve(el); }
        }, 600);
    });
}

function findInDom(rx: RegExp): string | null {
    for (const s of Array.from(document.scripts)) {
        if (!s.src && s.textContent) {
            const m = rx.exec(s.textContent);
            if (m) return m[1];
        }
    }
    return null;
}



