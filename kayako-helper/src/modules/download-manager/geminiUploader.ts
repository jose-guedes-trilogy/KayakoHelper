/* ./src/modules/download-manager/geminiUploader.ts
   Adds ONE “Upload ⬆ Ticket …” button to Gemini.
   ⦿ Disabled until a ticket is present in RAM.
   ⦿ Turns on automatically when Kayako copies a ticket afterwards. */

interface SerializedFile {
    name: string;
    type: string;
    buffer: ArrayBuffer;
}

const WRAPPER_SEL = '.leading-actions-wrapper';
const BTN_ID      = 'kayako-upload-btn';

/** ─────────────────────────   BOOTSTRAP   ─────────────────────────── */

let activeTicket: string | null = null;
let button: HTMLButtonElement;

export function bootGeminiUploader(): void {
    if ((window as any).geminiUploaderHasBooted) return;
    (window as any).geminiUploaderHasBooted = true;

    if (location.hostname !== 'gemini.google.com') return;
    console.log('[Kayako Helper] Gemini content-script booted');

    waitForWrapper().then(async (wrapper) => {
        if (wrapper.querySelector(`#${BTN_ID}`)) return;   // already injected
        await createButton(wrapper);
    });
}

async function createButton(wrapper: HTMLElement): Promise<void> {
    button = document.createElement('button');
    button.id   = BTN_ID;
    button.style.marginLeft = '0.5rem';
    button.onclick = () => { if (activeTicket) startUpload(); };
    wrapper.appendChild(button);

    await refreshState();
    updateButtonUi();

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'attachments.newTicket') {
            activeTicket = msg.ticketId as string;
            updateButtonUi();
        }
    });
}

/** ─────────────────────────   TICKET STATE   ──────────────────────── */

async function refreshState(): Promise<void> {
    const resp: { tickets: string[] } = await chrome.runtime.sendMessage({
        action: 'attachments.listTickets',
    });
    activeTicket = resp.tickets[0] ?? null;
}

function updateButtonUi(): void {
    if (!button) return;
    if (activeTicket) {
        button.disabled  = false;
        button.textContent = `Upload ⬆ Ticket ${activeTicket}`;
    } else {
        button.disabled  = true;
        button.textContent = 'Upload ⬆ (no ticket)';
    }
}

/** ─────────────────────────   MAIN FLOW   ─────────────────────────── */

async function startUpload(): Promise<void> {
    if (!activeTicket) return;
    button.disabled   = true;
    button.textContent = 'Uploading…';

    const { files }: { files: SerializedFile[] | null } =
        await chrome.runtime.sendMessage({
            action:   'attachments.getFiles',
            ticketId: activeTicket,
        });

    if (!files?.length) {
        alert('No files in RAM (maybe the service-worker slept).');
        await refreshState();
        updateButtonUi();
        return;
    }

    try {
        for (const f of files) {
            const file = new File([f.buffer], f.name, { type: f.type });
            await uploadFileToGemini(file);
            console.log('[attachments] Uploaded', f.name);
        }
        button.textContent = `Done ✔ (${files.length})`;
    } catch (e) {
        console.error(e);
        alert('Upload failed – see console.');
        updateButtonUi();
    } finally {
        button.disabled = false;
    }
}

/** ─────────────────────   LOW-LEVEL UPLOAD   ─────────────────────── */

export async function uploadFileToGemini(file: File): Promise<void> {
    /* 1. Feed id (qKIAYe) from inline JSON */
    const feed =
        findInDom(/"qKIAYe":"(feeds\/[a-z0-9]+)"/i) ??
        (() => { throw new Error('feed id qKIAYe not found'); })();

    /* 2. Start resumable session */
    const start = await fetch('https://push.clients6.google.com/upload/', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'push-id': feed,
            'x-goog-upload-command': 'start',
            'x-goog-upload-protocol': 'resumable',
            'x-goog-upload-header-content-length': String(file.size),
            'x-tenant-id': 'bard-storage',
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: `File name: ${encodeURIComponent(file.name)}`,
    });
    if (!start.ok) throw new Error(`push start ${start.status}`);

    const uploadUrl = start.headers.get('x-goog-upload-url')!;
    /* 3. Upload & finalise */
    const up = await fetch(uploadUrl, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'push-id': feed,
            'x-goog-upload-command': 'upload, finalize',
            'x-goog-upload-offset': '0',
            'x-tenant-id': 'bard-storage',
        },
        body: file,
    });
    if (!up.ok) throw new Error(`push upload ${up.status}`);

    const contrib = (await up.text()).trim();   // /contrib_service/ttl_1d/…

    /* 4. Tell Gemini via batchexecute */
    await registerBlobViaBatch(contrib, feed, file);
}

/** ───────────────   NEW: batchexecute RPC   ─────────────── */

/** Registers the blob via /data/batchexecute using the LIVE session args */
async function registerBlobViaBatch(
    contrib: string,
    feed: string,
    file: File,
): Promise<void> {
    /* 0. fresh session args pulled from inline JSON */
    const fSid  = findInDom(/"FdrFJe":"([^"]+)"/) ?? '';
    const reqId = Number(findInDom(/"jZXiKc":(\d+)/) ?? '0');

    if (!fSid) throw new Error('f.sid not found in page source');

    const nextReqId = reqId + 100000;

    /* ---------------- constants ---------------- */
    const RPC_ID = 'akDabf';             // still attachment RPC (update if needed)
    const bl     = findInDom(/"AmgiJf":"([^"]+)"/) ?? 'boq_bardchatui';
    const xsrf   = findInDom(/"SNlM0e":"([^"]+)"/) ?? '';

    /* 1. query string */
    const qs = new URLSearchParams({
        rpcids: RPC_ID,
        'source-path': '/app',
        bl,
        'f.sid': fSid,
        hl: 'en',
        _reqid: String(nextReqId),
        'soc-app': '1',
        'soc-platform': '1',
        'soc-device': '1',
        rt: 'c',
        at: xsrf,
    });

    /* 2. f.req body */
    const fReq = JSON.stringify([
        [
            [
                RPC_ID,
                JSON.stringify([
                    null,
                    contrib,
                    feed,
                    null,
                    [file.type, file.size, file.name],
                ]),
                null,
                'generic',
            ],
        ],
    ]);

    const body = new URLSearchParams({ 'f.req': fReq });

    /* 3. POST */
    const res = await fetch(
        'https://gemini.google.com/_/BardChatUi/data/batchexecute?' + qs,
        {
            method: 'POST',
            credentials: 'include',
            headers: {
                'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
                'x-same-domain': '1',
            },
            body: body.toString(),
        },
    );

    if (!res.ok) throw new Error(`batchexecute ${res.status}`);
}



/** ───────────────   UTILITIES   ─────────────── */

function waitForWrapper(): Promise<HTMLElement> {
    return new Promise((resolve) => {
        const id = setInterval(() => {
            const el = document.querySelector<HTMLElement>(WRAPPER_SEL);
            if (el) { clearInterval(id); resolve(el); }
        }, 600);
    });
}

/** Scan inline <script> tags for a regex and return first capture */
function findInDom(rx: RegExp): string | null {
    for (const s of Array.from(document.scripts)) {
        if (!s.src) {
            const m = rx.exec(s.textContent ?? '');
            if (m) return m[1];
        }
    }
    return null;
}
