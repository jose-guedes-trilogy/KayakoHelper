// harClient.ts — Content script helper to call the background har-proxy-fetch
// Adds: viaPinnedTabOrigin (run in page context)

import type { EndpointSpec } from "./har_endpoints";

export interface CallOptions {
  endpoint: EndpointSpec;
  pathParams?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  body?: string | object | FormData | null;
  includeCredentials?: boolean;
  timeoutMs?: number;
  viaPinnedTabOrigin?: string; // e.g., "https://dash.alpha.school/"
}

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

// ---- URL + body helpers ------------------------------------------------------

function buildUrl(ep: EndpointSpec, pathParams: Record<string,string> = {}, query: Record<string, any> = {}): string {
  let path = ep.pathTemplate;
  for (const [k,v] of Object.entries(pathParams)) {
    path = path.replace(new RegExp(`{${k}}`, "g"), encodeURIComponent(String(v)));
  }
  if (path.includes("{id}") && pathParams["id"]) {
    path = path.replace(/{id}/g, encodeURIComponent(String(pathParams["id"])));
  }
  const url = new URL(path, ep.baseUrl);
  for (const [k,v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

function normalizeBody(body: any, sampleMime?: string | null): { body: any; headers: Record<string,string> } {
  const headers: Record<string,string> = {};
  if (body == null) return { body: null, headers };
  if (body instanceof FormData) return { body, headers };
  if (typeof body === "string") {
    if (sampleMime && sampleMime.includes("json")) headers["content-type"] = "application/json";
    return { body, headers };
  }
  headers["content-type"] = "application/json;charset=utf-8";
  return { body: JSON.stringify(body), headers };
}

// ---- Public API --------------------------------------------------------------

export async function callEndpoint(opts: CallOptions): Promise<any> {
  const { endpoint, pathParams, query, headers, body, includeCredentials, timeoutMs, viaPinnedTabOrigin } = opts;
  const url = buildUrl(endpoint, pathParams, query);

  const nb = normalizeBody(body, endpoint.sampleBodyMime);
  const merged = Object.assign({}, endpoint.requiredHeaders || {}, nb.headers, headers || {});
  const finalHeaders = sanitizeHeaders(merged);

  if (viaPinnedTabOrigin) {
    const res = await chrome.runtime.sendMessage({
      type: "har-proxy-tab-fetch",
      originUrl: viaPinnedTabOrigin,
      request: {
        url,
        method: endpoint.method,
        headers: finalHeaders,
        body: nb.body,
        includeCredentials,
        timeoutMs
      }
    });
    if (!res) throw new Error("No response from background.");
    if (!res.ok) {
      const msg = res.error ? res.error : `HTTP ${res.status} ${res.statusText}`;
      throw new Error(msg + " — " + (res.text || ""));
    }
    const ct = res.headers["content-type"] || res.headers["Content-Type"] || "";
    if (ct.includes("application/json")) {
      try { return JSON.parse(res.text); } catch (_e) { return res.text; }
    }
    return res.text;
  }

  // Default: worker-side fetch
  const res = await chrome.runtime.sendMessage({
    type: "har-proxy-fetch",
    url,
    method: endpoint.method,
    headers: finalHeaders,
    body: nb.body,
    includeCredentials,
    timeoutMs
  });

  if (!res) throw new Error("No response from background.");
  if (!res.ok) {
    const msg = res.error ? res.error : `HTTP ${res.status} ${res.statusText}`;
    throw new Error(msg + " — " + (res.text || ""));
  }
  const ct = res.headers["content-type"] || res.headers["Content-Type"] || "";
  if (ct.includes("application/json")) {
    try { return JSON.parse(res.text); } catch (_e) { return res.text; }
  }
  return res.text;
}

export async function getAwsSessionToken(originUrl: string): Promise<string | null> {
  const res = await chrome.runtime.sendMessage({ type: "har-get-aws-session-token", originUrl });
  if (res?.error) throw new Error(res.error);
  return res?.token ?? null;
}

export function findEndpoint(predicate: (e: EndpointSpec) => boolean, endpoints: EndpointSpec[]): EndpointSpec | undefined {
  return endpoints.find(predicate);
}
