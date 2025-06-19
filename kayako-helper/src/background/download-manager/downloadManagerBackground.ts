/*───────────────────────────────────────────────────────────*\
  Kayako ⇄ Gemini  ·  Background “RAM vault”
  – Fetches the “Download all” ZIP from Kayako (incl. cookies)
  – Unzips it with JSZip ↝ keeps every entry in memory
  – Exposes three message endpoints
        • attachments.fetchZip   (Kayako → SW)
        • attachments.listTickets
        • attachments.getFiles   (Gemini → SW)
  – Notifies all open Gemini tabs when a fresh ticket arrives
\*───────────────────────────────────────────────────────────*/
/* src/background/download-manager/downloadManagerBackground.ts */

import JSZip from 'jszip';

/* ------------------------------------------------------------------ */
/* Types & in-RAM store                                               */
/* ------------------------------------------------------------------ */
interface SerializedFile {
    name:   string;
    type:   string;
    buffer: ArrayBuffer;
}

const vault: Record<string, SerializedFile[]> = Object.create(null);

/* ------------------------------------------------------------------ */
/* Central message hub                                                */
/* ------------------------------------------------------------------ */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
        try {
            switch (msg.action) {
                /* ── 1) Kayako page asked us to pull the ZIP ──────────────── */
                case 'attachments.fetchZip': {
                    const { url, ticketId } = msg as { url: string; ticketId: string };

                    /* download the archive using Kayako credentials */
                    const zipRes = await fetch(url, { credentials: 'include' });
                    if (!zipRes.ok) throw new Error(`ZIP download failed – HTTP ${zipRes.status}`);
                    const zipAb = await zipRes.arrayBuffer();

                    /* unzip entirely in memory */
                    const zip   = await JSZip.loadAsync(zipAb);
                    const files: SerializedFile[] = [];

                    await Promise.all(
                        Object.values(zip.files).map(async (entry) => {
                            if (entry.dir) return; // skip folders
                            const buf = await entry.async('arraybuffer');
                            files.push({
                                name:   entry.name.split('/').pop()!,
                                type:   mimeFromName(entry.name),
                                buffer: buf,
                            });
                        }),
                    );

                    if (!files.length) throw new Error('Archive contained no files');
                    vault[ticketId] = files;

                    /* wake every Gemini tab so its button enables */
                    chrome.tabs.query({ url: '*://gemini.google.com/*' }, (tabs) => {
                        tabs.forEach((t) =>
                            t.id != null &&
                            chrome.tabs.sendMessage(t.id, {
                                action:   'attachments.newTicket',
                                ticketId,
                            }),
                        );
                    });

                    sendResponse({ ok: true, fileCount: files.length });
                    break;
                }

                /* ── 2) Gemini content-script wants to know what’s cached ─── */
                case 'attachments.listTickets':
                    sendResponse({ tickets: Object.keys(vault) });
                    break;

                /* ── 3) Gemini content-script requests the actual blobs ───── */
                case 'attachments.getFiles': {
                    const { ticketId } = msg as { ticketId: string };
                    sendResponse({ files: vault[ticketId] ?? null });
                    break;
                }

                default:
                    /* let other listeners handle */
                    return;
            }
        } catch (err) {
            console.error('[SW] attachments error:', err);
            sendResponse({ ok: false, error: String(err) });
        }
    })();

    /* keep the channel open for the async work above */
    return true;
});


/* ------------------------------------------------------------------ */
/* Helper: super-light MIME sniffing                                  */
/* ------------------------------------------------------------------ */
function mimeFromName(name: string): string {
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    switch (ext) {
        case 'png':  return 'image/png';
        case 'jpg':
        case 'jpeg': return 'image/jpeg';
        case 'gif':  return 'image/gif';
        case 'pdf':  return 'application/pdf';
        case 'txt':  return 'text/plain';
        case 'csv':  return 'text/csv';
        case 'doc':  return 'application/msword';
        case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        case 'xls':  return 'application/vnd.ms-excel';
        case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        default:     return 'application/octet-stream';
    }
}
