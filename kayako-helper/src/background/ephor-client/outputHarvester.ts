import { mapMessagesToStageOutputs /* or groupMessagesByModel (compat) */ } from "@/background/ephor-client/outputHarvester";


export type EphorMessage = {
  id?: string;
  role?: string;
  model?: string;
  content?: any;
  text?: string;
  created_at?: number | string;
  meta?: Record<string, any>;
  metadata?: Record<string, any>;
  tags?: string[];
};

export type StageDef = {
  id?: string | null;
  name?: string | null;
};

type HarvestParams = {
  messages: EphorMessage[];
  stageOrder: StageDef[];
  includeRoles?: string[]; // e.g., ["assistant"], defaults to assistant only
};

function safeLower(x: any): string {
  return typeof x === "string" ? x.toLowerCase() : "";
}

function coerceTime(t?: number | string): number {
  if (t == null) return 0;
  if (typeof t === "number") return t;
  const n = Date.parse(String(t));
  return Number.isFinite(n) ? n : 0;
}

function extractTextFromMessage(m: EphorMessage): string {
  // Prefer explicit text
  if (typeof m.text === "string" && m.text.trim()) return m.text;

  // Some APIs wrap text into content parts (array of items)
  // Try common shapes without depending on SDK types.
  const c = m.content as any;

  // content as string
  if (typeof c === "string" && c.trim()) return c;

  // content as array of parts with .text or .value
  if (Array.isArray(c)) {
    const joined = c
      .map((p: any) => {
        if (!p) return "";
        if (typeof p === "string") return p;
        if (typeof p.text === "string") return p.text;
        if (typeof p.value === "string") return p.value;
        if (p.type === "text" && typeof p.data === "string") return p.data;
        return "";
      })
      .filter(Boolean)
      .join("");
    if (joined.trim()) return joined;
  }

  // content as object with nested .text
  if (c && typeof c === "object") {
    const maybe = (c as any).text ?? (c as any).value ?? (c as any).data;
    if (typeof maybe === "string" && maybe.trim()) return maybe;
  }

  // Fallback: nothing
  return "";
}

function getStageKeyFromMessage(m: EphorMessage): string | null {
  // 1) explicit metadata (preferred)
  const md = (m.metadata ?? m.meta ?? {}) as Record<string, any>;
  const direct = md.stage_id ?? md.stage ?? md.stageKey ?? md.stage_index; // supports several spellings
  if (direct != null && String(direct).trim()) return String(direct);

  // 2) tags like "stage:xyz" or "stage_index:1"
  const tags = Array.isArray(m.tags) ? m.tags : [];
  for (const t of tags) {
    const s = String(t || "");
    if (s.startsWith("stage:")) return s.slice("stage:".length);
    if (s.startsWith("stage_id:")) return s.slice("stage_id:".length);
    if (s.startsWith("stage_index:")) return s.slice("stage_index:".length);
  }

  // Unknown
  return null;
}

function buildStageKeyIndex(stageOrder: StageDef[]): { keys: string[]; byKey: Map<string, number> } {
  const keys: string[] = stageOrder.map((s, i) => {
    const id = (s.id ?? "").toString().trim();
    if (id) return id;
    // No stable id? fall back to 1-based index string so it’s human-friendly in logs.
    return `#${i + 1}`;
  });
  const byKey = new Map<string, number>();
  keys.forEach((k, idx) => byKey.set(k, idx));
  return { keys, byKey };
}

export function mapMessagesToStageOutputs(params: HarvestParams): string[] {
  const { messages, stageOrder, includeRoles = ["assistant"] } = params;

  // Sort deterministically by timestamp then id to prevent racey assignment
  const msgs = [...messages].sort((a, b) => {
    const ta = coerceTime(a.created_at);
    const tb = coerceTime(b.created_at);
    if (ta !== tb) return ta - tb;
    const ia = String(a.id ?? "");
    const ib = String(b.id ?? "");
    return ia.localeCompare(ib);
  });

  const { byKey } = buildStageKeyIndex(stageOrder);
  const out: string[] = Array(stageOrder.length).fill("");

  // Track which stage slots have been "claimed" when we must fall back
  const claimed: boolean[] = Array(stageOrder.length).fill(false);
  const includeSet = new Set(includeRoles.map(safeLower));

  for (const m of msgs) {
    // Filter roles (default assistant-only)
    if (includeSet.size) {
      const role = safeLower(m.role);
      if (!includeSet.has(role)) continue;
    }

    const text = extractTextFromMessage(m);
    if (!text) continue;

    // Best-effort stage key
    const keyFromMsg = getStageKeyFromMessage(m);

    if (keyFromMsg && byKey.has(keyFromMsg)) {
      const idx = byKey.get(keyFromMsg)!;
      out[idx] = (out[idx] ? out[idx] + "\n" : "") + text;
      claimed[idx] = true;
      continue;
    }

    // If we couldn’t identify a stage key, assign to the first unclaimed stage slot.
    // This gracefully handles older runs that didn’t annotate stage_id.
    let placed = false;
    for (let i = 0; i < out.length; i++) {
      if (!claimed[i]) {
        out[i] = (out[i] ? out[i] + "\n" : "") + text;
        claimed[i] = true;
        placed = true;
        break;
      }
    }

    // If all are claimed (e.g., multiple assistant messages in same stage),
    // append to the last slot (most common “refinement” case).
    if (!placed && out.length > 0) {
      const last = out.length - 1;
      out[last] = (out[last] ? out[last] + "\n" : "") + text;
    }
  }

  return out;
}

/* ---------------------------------------------------------------
   Backwards compatibility export:

   If your code previously did something like:
     const outputsByModel = groupMessagesByModel(messages);

   You can keep that call-site intact by importing this symbol.
   It will now return outputs mapped by STAGE ORDER instead.
---------------------------------------------------------------- */
export function groupMessagesByModel(messages: EphorMessage[], stageOrder: StageDef[]): string[] {
  return mapMessagesToStageOutputs({ messages, stageOrder, includeRoles: ["assistant"] });
}

/* ---------------------------------------------------------------
   Debug helpers (optional)
---------------------------------------------------------------- */
export function debugDumpStageAssignment(messages: EphorMessage[], stageOrder: StageDef[]): Array<{ id?: string; role?: string; stageKey: string | null; text: string }> {
  return [...messages]
    .sort((a, b) => coerceTime(a.created_at) - coerceTime(b.created_at))
    .map(m => ({
      id: m.id,
      role: m.role,
      stageKey: getStageKeyFromMessage(m),
      text: extractTextFromMessage(m).slice(0, 120),
    }));
}
