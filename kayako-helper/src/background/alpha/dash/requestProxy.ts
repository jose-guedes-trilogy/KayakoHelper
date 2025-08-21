// requestProxy.ts — Background module (MV3) to proxy cross-origin requests
// Adds support for:
//  - "har-get-aws-session-token": open a pinned app tab, extract x-amz-security-token, close
//  - "har-proxy-tab-fetch": open a pinned app tab, run fetch() there, close
// Also keeps "har-proxy-fetch" (plain worker-side fetch with sanitization)

type ProxyFetchRequest = {
  type: "har-proxy-fetch";
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
  includeCredentials?: boolean; // default true
  timeoutMs?: number; // default 30000
};

type ProxyFetchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  headers: Record<string, string>;
  text?: string;
  error?: string;
};

type TabFetchRequest = {
  type: "har-proxy-tab-fetch";
  originUrl: string; // e.g., "https://dash.alpha.school/"
  request: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | null;
    includeCredentials?: boolean;
    timeoutMs?: number;
  };
};

type GetAwsTokenRequest = {
  type: "har-get-aws-session-token";
  originUrl: string; // e.g., "https://dash.alpha.school/"
};

// ---- Header sanitation -------------------------------------------------------

const FORBIDDEN_HEADERS = new Set([
  "accept-charset","accept-encoding","access-control-request-headers","access-control-request-method",
  "connection","content-length","cookie","cookie2","date","dnt","expect","host","keep-alive",
  "origin","referer","te","trailer","transfer-encoding","upgrade","via","user-agent",
  "sec-ch-ua","sec-ch-ua-mobile","sec-ch-ua-platform","sec-fetch-dest","sec-fetch-mode","sec-fetch-site","sec-fetch-user",
]);

function isValidHeaderName(name: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name);
}

function isIso88591(value: string): boolean {
  if (/[\r\n]/.test(value)) return false;
  for (const ch of value) {
    // @ts-ignore
    if (ch.codePointAt(0)! > 255) return false;
  }
  return true;
}

function sanitizeHeaders(h: Record<string, string> | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  for (const [k, v] of Object.entries(h)) {
    if (v == null) continue;
    const name = k.toLowerCase().trim();
    if (!isValidHeaderName(name)) continue;
    if (FORBIDDEN_HEADERS.has(name)) continue;

    const val = String(v);
    if (!isIso88591(val)) continue;
    if (val.includes("…") || /redact/i.test(val)) continue;

    out[name] = val;
  }
  if (!out["accept"]) out["accept"] = "application/json, text/plain, */*";
  return out;
}

// ---- Helpers: pinned tab open/close + run code -------------------------------

async function openPinnedTab(url: string): Promise<number> {
  const tab = await chrome.tabs.create({ url, pinned: true, active: false });
  const tabId = tab.id!;
  await waitForTabComplete(tabId);
  return tabId;
}

async function waitForTabComplete(tabId: number): Promise<void> {
  // Wait until the tab reports status "complete"
  const done = await new Promise<void>((resolve) => {
    function listener(_tabId: number, info: chrome.tabs.TabChangeInfo) {
      if (_tabId === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    // Also poll in case we missed the event
    chrome.tabs.get(tabId, (t) => {
      if (t && (t as any).status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
  return done;
}

async function closeTab(tabId: number): Promise<void> {
  try { await chrome.tabs.remove(tabId); } catch {}
}

// ---- Injected functions (run in page) ---------------------------------------

async function injectedGetAwsSessionToken(): Promise<string | null> {
  // This body is stringified by executeScript; keep it self-contained.
  // Heuristics: scan localStorage and cookies for a session token-like value.
  function findJwtLikeInString(s: string): string | null {
    const m = /eyJ[A-Za-z0-9_\-]+?\.[A-Za-z0-9_\-]+?\.[A-Za-z0-9_\-]+/.exec(s);
    return m ? m[0] : null;
  }
  function findAwsSessionTokenLike(s: string): string | null {
    // STS session tokens are long Base64-ish and often start with "IQoJ" or "FwoG" or look like "eyJ..."
    const m = /(IQoJ|FwoG|eyJ)[A-Za-z0-9_\-\.=]{80,}/.exec(s);
    return m ? m[0] : null;
  }
  function scanLocalStorage(): string | null {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        const val = localStorage.getItem(key);
        if (!val) continue;
        // Look for sessionToken fields or token-ish strings
        const direct = findAwsSessionTokenLike(val) || findJwtLikeInString(val);
        if (direct) return direct;
        if (val.trim().startsWith("{")) {
          try {
            const obj = JSON.parse(val);
            // Deep scan for sessionToken-ish property
            const stack: any[] = [obj];
            while (stack.length) {
              const cur = stack.pop();
              if (cur && typeof cur === "object") {
                for (const [k, v] of Object.entries(cur)) {
                  if (typeof v === "string" && /sessiontoken|idtoken|accesstoken|token/i.test(k)) {
                    const tok = findAwsSessionTokenLike(v) || findJwtLikeInString(v) || v;
                    if (tok && String(tok).length > 60) return String(tok);
                  } else if (v && typeof v === "object") {
                    stack.push(v);
                  }
                }
              }
            }
          } catch {}
        }
      }
    } catch {}
    return null;
  }
  function scanCookies(): string | null {
    try {
      const parts = document.cookie.split(/; */).map(x => x.split("="));
      for (const p of parts) {
        if (p.length < 2) continue;
        const val = decodeURIComponent(p.slice(1).join("="));
        const tok = findAwsSessionTokenLike(val) || findJwtLikeInString(val);
        if (tok) return tok;
      }
    } catch {}
    return null;
  }

  return scanLocalStorage() || scanCookies();
}

async function injectedRunFetch(req: any): Promise<any> {
  function toHeaders(obj: any): Headers {
    const h = new Headers();
    if (obj && typeof obj === "object") {
      for (const [k, v] of Object.entries(obj)) {
        if (v == null) continue;
        try { h.set(k, String(v)); } catch {}
      }
    }
    return h;
  }

  // Try to auto-augment with x-amz-security-token if missing
  const headers = toHeaders(req.headers || {});
  if (!headers.has("x-amz-security-token")) {
    try {
      // Inline the token finder
      const tok = await (injectedGetAwsSessionToken as any)();
      if (tok) headers.set("x-amz-security-token", tok);
    } catch {}
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), req.timeoutMs ?? 30000);

  try {
    const res = await fetch(req.url, {
      method: req.method || "GET",
      headers,
      body: req.body ?? null,
      credentials: req.includeCredentials ? "include" : "omit",
      signal: controller.signal,
      mode: "cors",
    });
    const text = await res.text();
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => (outHeaders[k] = v));
    clearTimeout(t);
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      url: res.url,
      headers: outHeaders,
      text,
    };
  } catch (err: any) {
    clearTimeout(t);
    return {
      ok: false,
      status: 0,
      statusText: "NETWORK_ERROR",
      url: req.url,
      headers: {},
      error: String(err && err.message ? err.message : err),
    };
  }
}

// ---- Installer --------------------------------------------------------------

export function installHarProxy() {
  chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
    if (!msg) return;

    // 0) Lightweight ping so callers can detect whether this worker has the proxy installed.
    if (msg.type === "har-proxy-ping") {
      try { sendResponse({ ok: true }); } catch {}
      return; // no need to keep the channel open
    }

    // 1) Plain worker-side fetch (sanitized)
    if (msg.type === "har-proxy-fetch") {
      const req = msg as ProxyFetchRequest;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? 30000);
      const includeCreds = req.includeCredentials ?? true;

      (async () => {
        try {
          const safeHeaders = sanitizeHeaders(req.headers || {});
          const res = await fetch(req.url, {
            method: (req.method || "GET") as any,
            headers: safeHeaders,
            body: req.body ?? null,
            credentials: includeCreds ? "include" : "omit",
            signal: controller.signal,
            mode: "cors",
          });
          const text = await res.text();
          const headers: Record<string, string> = {};
          res.headers.forEach((v, k) => (headers[k] = v));
          const payload: ProxyFetchResponse = {
            ok: res.ok,
            status: res.status,
            statusText: res.statusText,
            url: res.url,
            headers,
            text,
          };
          clearTimeout(timeout);
          sendResponse(payload);
        } catch (err: any) {
          clearTimeout(timeout);
          const payload: ProxyFetchResponse = {
            ok: false,
            status: 0,
            statusText: "NETWORK_ERROR",
            url: req.url,
            headers: {},
            error: String(err && err.message ? err.message : err),
          };
          sendResponse(payload);
        }
      })();

      return true; // keep channel open
    }

    // 2) Get AWS session token via pinned tab
    if (msg.type === "har-get-aws-session-token") {
      const { originUrl } = msg as GetAwsTokenRequest;
      (async () => {
        let tabId: number | null = null;
        try {
          tabId = await openPinnedTab(originUrl);
          const [result] = await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: injectedGetAwsSessionToken,
          });
          const token = result?.result || null;
          sendResponse({ token });
        } catch (err: any) {
          sendResponse({ token: null, error: String(err && err.message ? err.message : err) });
        } finally {
          if (tabId != null) await closeTab(tabId);
        }
      })();
      return true;
    }

    // 3) Run fetch in pinned tab (page context)
    if (msg.type === "har-proxy-tab-fetch") {
      const { originUrl, request } = msg as TabFetchRequest;
      (async () => {
        let tabId: number | null = null;
        try {
          tabId = await openPinnedTab(originUrl);
          const [result] = await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: injectedRunFetch,
            args: [request],
          });
          sendResponse(result?.result ?? { ok: false, status: 0, statusText: "NO_RESULT", url: request.url, headers: {}, error: "No result" });
        } catch (err: any) {
          sendResponse({
            ok: false,
            status: 0,
            statusText: "INJECTION_ERROR",
            url: request.url,
            headers: {},
            error: String(err && err.message ? err.message : err),
          });
        } finally {
          if (tabId != null) await closeTab(tabId);
        }
      })();
      return true;
    }

    // Unhandled
    return;
  });
}
