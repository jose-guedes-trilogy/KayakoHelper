// RequestReplicator.ts — Floating panel to test HAR endpoints
// Now with: Headers box, Scan AWS Token, and "Run in pinned app tab" toggle.

import { HAR_ENDPOINTS, type EndpointSpec } from "@/background/alpha/dash/har_endpoints";
import { callEndpoint, getAwsSessionToken } from "@/background/alpha/dash/har_client";
import { APP_ORIGIN, REGION, USER_POOL_ID, IDENTITY_POOL_ID, getUserListSigned } from "@/background/alpha/dash/alphaApi";
import { runCredProbeInPinnedTab } from "@/background/alpha/dash/credProbeClient";

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any>, ...children: any[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs || {})) {
    if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") (el as any)[k.toLowerCase()] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c == null) continue;
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

function safeParse(jsonText: string): any {
  if (!jsonText.trim()) return {};
  try { return JSON.parse(jsonText); } catch (_e) { throw new Error("Invalid JSON"); }
}

export function bootRequestReplicator() {
  if (document.getElementById("oh-replicator")) return;
  const root = h("div", { id: "oh-replicator", style: {
      position: "fixed", right: "16px", bottom: "16px", zIndex: 999999,
      width: "380px", background: "white", border: "1px solid #ddd",
      boxShadow: "0 6px 24px rgba(0,0,0,.15)", borderRadius: "12px", fontFamily: "Inter, system-ui, sans-serif"
    }});
  const header = h("div", { style: { padding: "10px 12px", fontWeight: "600", borderBottom: "1px solid #eee" } }, "Request Replicator");

  const select = h("select", { style: { width: "100%", padding: "8px", margin: "8px 0" } });
  for (const ep of HAR_ENDPOINTS) {
    select.appendChild(h("option", { value: ep.id }, `${ep.method} ${ep.host}${ep.pathTemplate}`));
  }

  const pathParams = h("input", { placeholder: '{"id":"123"} pathParams', style: { width: "100%", padding: "8px", margin: "4px 0" } });
  const query = h("input", { placeholder: '{"q":"test"} query', style: { width: "100%", padding: "8px", margin: "4px 0" } });
  const headersBox = h("textarea", { placeholder: '{"x-amz-security-token":"<sessionToken>"} headers', style: { width: "100%", height: "70px", padding: "8px", margin: "4px 0", fontFamily: "monospace" } });
  const body = h("textarea", { placeholder: "raw JSON or leave empty", style: { width: "100%", height: "90px", padding: "8px", margin: "4px 0", fontFamily: "monospace" } });

  const row = h("div", { style: { display: "flex", gap: "8px", alignItems: "center", margin: "6px 0" } });
  const sigToggle = h("input", { type: "checkbox" });
  const sigLabel  = h("label", {}, "Sign with AWS (SigV4)");
  const pinnedToggle = h("input", { type: "checkbox" });
  const pinnedLabel = h("label", {}, "Run in pinned app tab");
  const scanAwsBtn = h("button", { style: { marginLeft: "auto", padding: "8px", borderRadius: "8px", border: "1px solid #ccc", cursor: "pointer" } }, "Scan AWS Token");
  row.appendChild(sigToggle);
  row.appendChild(sigLabel);
  row.appendChild(pinnedToggle);
  row.appendChild(pinnedLabel);
  row.appendChild(scanAwsBtn);

  const runBtn = h("button", { style: { width: "100%", padding: "10px", margin: "6px 0 8px 0", borderRadius: "8px", border: "1px solid #ccc", cursor: "pointer" } }, "Send");
  const hint = h("div", { style: { fontSize: "12px", color: "#666", padding: "0 12px 8px" } },
      'Tip: IAM-protected API Gateway requires SigV4. Use “Sign with AWS (SigV4)”. “Scan AWS Token” alone won’t authorize.');
  const output = h("pre", { style: { background: "#0b1020", color: "#e2e8f0", padding: "10px", margin: 0, borderBottomLeftRadius: "12px", borderBottomRightRadius: "12px", maxHeight: "240px", overflow: "auto" } });

  root.appendChild(header);
  root.appendChild(h("div", { style: { padding: "8px 12px" } },
      select,
      pathParams,
      query,
      headersBox,
      body,
      row,
      runBtn,
      hint,
  ));
  root.appendChild(output);
  document.body.appendChild(root);

  runBtn.onclick = async () => {
    output.textContent = "Sending…";
    try {
      const ep = HAR_ENDPOINTS.find(e => e.id === (select as HTMLSelectElement).value)!;
      const pp = safeParse((pathParams as HTMLInputElement).value || "{}");
      const qq = safeParse((query as HTMLInputElement).value || "{}");
      const hh = safeParse((headersBox as HTMLTextAreaElement).value || "{}");
      // Drop any AWS/SigV4 headers; the signer will compute these.
      for (const k of Object.keys(hh)) {
        if (/^(authorization|host|x-amz-(?:date|content-sha256|security-token))$/i.test(k)) {
          delete (hh as any)[k];
        }
      }
      const bbText = (body as HTMLTextAreaElement).value.trim();
      const bodyStr = bbText ? bbText : null;

      // Build URL from EndpointSpec locally
      let path = ep.pathTemplate;
      for (const [k, v] of Object.entries(pp)) {
        path = path.replace(new RegExp(`{${k}}`, "g"), encodeURIComponent(String(v)));
      }
      const urlObj = new URL(path, ep.baseUrl);
      for (const [k, v] of Object.entries(qq)) {
        if (v != null) urlObj.searchParams.set(k, String(v));
      }
      const url = urlObj.toString();

      const needsSig =
        (sigToggle as HTMLInputElement).checked ||
        /execute-api\.[^.]+\.amazonaws\.com$/i.test(ep.host);

      if (needsSig) {
        const res = await chrome.runtime.sendMessage({
          type: "aws.signedFetch",
          url,
          method: ep.method,
          headers: hh,
          body: bodyStr,
          originUrl: APP_ORIGIN,
          region: REGION,
          userPoolId: USER_POOL_ID,
          identityPoolId: IDENTITY_POOL_ID,
          timeoutMs: 30000,
        });

        if (!res) throw new Error("No response from background");
        if (!res.ok) {
          const msg = res.error ? res.error : `HTTP ${res.status} ${res.statusText}`;
          const dbg = res.debug ? ` [debug: ${JSON.stringify(res.debug).slice(0,300)}…]` : "";
          throw new Error(msg + dbg + " — " + (res.text || ""));
        }
        const ct = res.headers["content-type"] || res.headers["Content-Type"] || "";
        (output as HTMLPreElement).textContent =
          ct.includes("application/json")
            ? JSON.stringify(JSON.parse(res.text || "{}"), null, 2)
            : (res.text || "");
        return;
      }

      // Unsigned path (optionally via pinned app tab)
      const res2 = await callEndpoint({
        endpoint: ep,
        pathParams: pp,
        query: qq,
        body: bbText ? JSON.parse(bbText) : null,
        headers: hh,
        viaPinnedTabOrigin: (pinnedToggle as HTMLInputElement).checked ? APP_ORIGIN : undefined
      });
      (output as HTMLPreElement).textContent = (typeof res2 === "string") ? res2 : JSON.stringify(res2, null, 2);
    } catch (e) {
      (output as HTMLPreElement).textContent = "Error: " + (e as Error).message;
    }
  };

  scanAwsBtn.onclick = async () => {
    (output as HTMLPreElement).textContent = "Getting AWS session via background…";
    try {
      // ---- Primary path: let background do deep discovery + STS
      const sts = await chrome.runtime.sendMessage({
        type: "aws.getStsForOrigin",
        originUrl: APP_ORIGIN,
        region: REGION,
        userPoolId: USER_POOL_ID,
        identityPoolId: IDENTITY_POOL_ID, // may be undefined; background will discover & cache
      });

      if (sts?.ok && sts.credentials?.sessionToken) {
        const cur = safeParse((headersBox as HTMLTextAreaElement).value || "{}");
        cur["x-amz-security-token"] = sts.credentials.sessionToken;
        (headersBox as HTMLTextAreaElement).value = JSON.stringify(cur, null, 2);

        if (sts.identityPoolId) {
          try {
            const origin = new URL(APP_ORIGIN).origin;
            await chrome.storage?.local.set({ [`alpha.identityPoolId|${origin}`]: sts.identityPoolId });
          } catch {}
        }

        (output as HTMLPreElement).textContent =
            "STS ready. Added x-amz-security-token and saved Identity Pool ID.";
        return;
      }

      // ---- Fallback: run CredProbe (MAIN world) to scrape STS directly
      (output as HTMLPreElement).textContent = "Background path failed; running CredProbe…";
      const { info, creds } = await runCredProbeInPinnedTab();
      if (!creds?.SessionToken) throw new Error("CredProbe did not return SessionToken");

      const cur = safeParse((headersBox as HTMLTextAreaElement).value || "{}");
      cur["x-amz-security-token"] = creds.SessionToken;
      (headersBox as HTMLTextAreaElement).value = JSON.stringify(cur, null, 2);

      if (info?.identityPoolId) {
        try {
          const origin = new URL(APP_ORIGIN).origin;
          await chrome.storage?.local.set({ [`alpha.identityPoolId|${origin}`]: info.identityPoolId });
        } catch {}
      }

      (output as HTMLPreElement).textContent =
          "CredProbe OK. Added x-amz-security-token and saved Identity Pool ID.";
    } catch (e) {
      const msg = (e as Error).message || String(e);
      if (/No idToken available/i.test(msg)) {
        (output as HTMLPreElement).textContent =
            "You’re not logged in on the app. Open https://dash.alpha.school/ and sign in, then scan again.";
      } else {
        (output as HTMLPreElement).textContent = "Scan error: " + msg;
      }
    }
  };



}
// Old:
// (async () => {
//   try {
//     const data = await getUserListSigned();
//     console.log("Signed user list:", data);
//   } catch (e) {
//     console.error("Signed call failed:", e);
//   }
// })();

// Safer (dev-only):
if (typeof process !== "undefined" && process.env?.NODE_ENV === "development") {
  (async () => {
    try {
      const data = await getUserListSigned();
      console.log("Signed user list:", data);
    } catch (e) {
      console.warn("Signed call (dev):", e);
    }
  })();
}



// RequestReplicator.ts
export async function bootCredProbeClient(opts: { verbose?: boolean } = {}) {
  try {
    // Try background prewarm; if you’re not logged in, this will return {ok:false} but won’t throw.
    const sts = await chrome.runtime.sendMessage({
      type: "aws.getStsForOrigin",
      originUrl: APP_ORIGIN,
      region: REGION,
      userPoolId: USER_POOL_ID,
      identityPoolId: IDENTITY_POOL_ID,
    });

    if (sts?.ok && sts.credentials?.sessionToken) {
      if (opts.verbose) console.log("[CredProbeClient] prewarmed STS from background.", sts.source || "");
      return;
    }
    if (opts.verbose) console.warn("[CredProbeClient] prewarm skipped:", sts?.error || "not logged in");
  } catch (e:any) {
    if (opts.verbose) console.warn("[CredProbeClient] prewarm error:", e?.message || e);
    // do not rethrow – this is a background warm-up hook
  }
}

