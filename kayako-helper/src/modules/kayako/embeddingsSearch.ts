// src/modules/kayako/embeddingsSearch.ts  –  adds a semantic-search box to the Kayako header
// rev-v2 – resilient to late loads & SPA navigation
// ---------------------------------------------------------------
import { sendNativeMsg } from "@/utils/native/sendNativeMessage";

const MIN_LEN     = 3;          // min chars before we query
const DEBOUNCE_MS = 350;        // keystroke debounce
const HEADER_SEL  = '[class*="session__header-secondary_"]';
const WRAPPER_ID  = "kh-embeddings-search-parent";


interface SearchHit {
    title: string;
    url: string;
    snippet: string;
}
interface SearchResp {
    success: boolean;
    corrected?: string;
    results?: SearchHit[];
    error?: string;
}


export function bootEmbeddingsSearch() {
    /* ----------------------------------------------------------------–
     * 1.  idempotent mount helper
     * ---------------------------------------------------------------- */
    const mountSearch = (header: HTMLElement) => {
        if (header.querySelector(`#${WRAPPER_ID}`)) return; // already there

        /* ── DOM scaffold ─────────────────────────────────────────── */
        const wrapper = document.createElement("div");
        wrapper.id = WRAPPER_ID;
        Object.assign(wrapper.style, {
            position:  "relative",
            flex:      "0 0 260px",
            marginRight: "12px",
        });

        const input = document.createElement("input");
        input.type = "search";
        input.placeholder = "Embeddings-based KB search…";
        input.autocomplete = "off";
        Object.assign(input.style, {
            width:        "100%",
            padding:      "6px 8px",
            border:       "1px solid #ccc",
            borderRadius: "4px",
        });

        const dropdown = document.createElement("ul");
        Object.assign(dropdown.style, {
            position:   "absolute",
            top:        "110%",
            left:       "0",
            right:      "0",
            maxHeight:  "340px",
            overflowY:  "auto",
            listStyle:  "none",
            margin:     "4px 0 0",
            padding:    "0",
            background: "#fff",
            border:     "1px solid #ccc",
            borderRadius: "4px",
            boxShadow:  "0 2px 4px rgba(0,0,0,0.1)",
            zIndex:     "9999",
            display:    "none",
        });

        wrapper.appendChild(input);
        wrapper.appendChild(dropdown);
        header.prepend(wrapper);

        /* ── helpers ─────────────────────────────────────────────── */
        let timer: number | null = null;
        let lastQuery = "";

        const clearResults = () => {
            dropdown.innerHTML = "";
            dropdown.style.display = "none";
        };

        const renderResults = (data: any, original: string) => {
            dropdown.innerHTML = "";

            // autocorrect notice
            if (data.corrected) {
                const info = document.createElement("li");
                Object.assign(info.style, { padding: "6px 8px", fontStyle: "italic" });
                info.innerHTML =
                    `Showing results for <b>${data.corrected}</b>. ` +
                    `<a href="#" id="search-orig">Search instead for “${original}”</a>`;
                dropdown.appendChild(info);

                info.querySelector<HTMLAnchorElement>("#search-orig")!.onclick = (e) => {
                    e.preventDefault();
                    input.value = original;
                    triggerSearch(original);
                };
            }

            // hits
            for (const hit of data.results ?? []) {
                const li = document.createElement("li");
                li.style.cssText =
                    "padding:8px 10px;cursor:pointer;border-top:1px solid #eee";
                li.innerHTML =
                    `<div style="font-weight:500;margin-bottom:2px">${hit.title}</div>` +
                    `<div style="font-size:12px;color:#555">${hit.snippet}…</div>`;
                li.onclick = () => window.open(hit.url, "_blank");
                dropdown.appendChild(li);
            }

            dropdown.style.display = dropdown.childElementCount ? "block" : "none";
        };

        const triggerSearch = (q: string) => {
            console.log("[KH] search →", q);

            lastQuery = q;
            sendNativeMsg<{ type: "search"; text: string; k: number }, SearchResp>(
                { type: "search", text: q, k: 10 }
            )
                .then((resp) => {
                    console.log("[KH] resp:", resp);

                    if (q !== lastQuery) return;          // stale debounce
                    if (!resp.success) {
                        clearResults();
                        console.error("KB search error:", resp.error);
                        return;
                    }
                    renderResults(resp, q);
                })
                .catch((err) => {
                    clearResults();
                    console.error("KB search exception:", err);
                });
        };

        /* ── input events ────────────────────────────────────────── */
        input.addEventListener("input", () => {
            const q = input.value.trim();
            if (q.length < MIN_LEN) {
                clearResults();
                return;
            }
            if (timer) clearTimeout(timer);
            timer = window.setTimeout(() => triggerSearch(q), DEBOUNCE_MS);
        });

        input.addEventListener("keydown", (e) => {
            if (e.key === "Escape") clearResults();
        });
    };

    /* ----------------------------------------------------------------–
     * 2.  attempt immediate mount (cheap) and set up observers
     * ---------------------------------------------------------------- */
    const tryMount = () => {
        const header = document.querySelector<HTMLElement>(HEADER_SEL);
        if (header) mountSearch(header);
    };

    // First quick shot
    tryMount();

    // MutationObserver – fires whenever nodes are added/removed
    const mo = new MutationObserver(() => tryMount());
    mo.observe(document.body, { childList: true, subtree: true });

    // URL poll – catches soft route changes that don't mutate DOM
    let lastURL = location.href;
    setInterval(() => {
        if (location.href !== lastURL) {
            lastURL = location.href;
            // slight delay lets Kayako paint its new DOM
            setTimeout(tryMount, 50);
        }
    }, 200);
}
