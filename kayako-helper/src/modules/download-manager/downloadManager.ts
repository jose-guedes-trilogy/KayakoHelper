/* modules/download-manager/downloadManager.ts
   ──────────────────────────────────────────────────────────
   One-liner wrapper to keep existing import paths working. */

import { bootCreateFolderButton } from '@/modules/download-manager/createFolderButton';
import {bootKayakoAttachments} from "@/modules/download-manager/kayakoAttachments";

export function  bootDownloadManager() {
    bootCreateFolderButton();

    /* Transfer Kayako attachments to Gemini */
    bootKayakoAttachments();
}
