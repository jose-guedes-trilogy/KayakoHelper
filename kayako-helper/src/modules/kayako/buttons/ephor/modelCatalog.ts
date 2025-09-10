// Central model catalog: display name ↔ API id mapping and helpers

export const MODEL_DISPLAY_TO_API: Record<string, string | null> = {
  "Microsoft Phi-4": "phi-4",
  "Nova Premier": "bedrock-amazon-nova-premier",
  "Gemini 2.5 Pro": "gemini-2.5-pro",
  "OpenAI Codex Mini Latest": "codex-mini-latest",
  "Qwen 3.3 32B": "cerebras-qwen-3-32b",
  "GPT-5": "gpt-5",
  "Llama 4 Scout": "cerebras-4-scout",
  "Claude 4 Sonnet": "claude-4-sonnet-latest-thinking",
  "OpenAI 4.1": "gpt-4.1",
  "Grok 3": "grok-3",
  "DeepSeek V3 0324": "deepseek-v3",
  "Llama R1 Distill 70B": "groq-r1-llama",
  "Mistral Small 3.1": "mistral-small-31",
  "OpenAI o4 Mini": "o4-mini",
  "Gemini 2.5 Flash": "gemini-2.5-flash",
  "Haiku 3.5": "anthropic-haiku35",
  "Mistral Medium 3": "mistral-medium-3",
  "Kimi K2": "kimi-k2",
  "Minimax M1": "minimax-m1",
  "Grok 3 Mini": "grok-3-mini",
  "Grok 4": "grok-4",
  "DeepSeek R1": "deepseek-r1",
  "Claude 4 Opus": "claude-4-opus-latest-thinking",
  "OpenAI o3": "o3",
  "Perplexity Sonar Pro": null,
};

const API_TO_DISPLAY: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [disp, api] of Object.entries(MODEL_DISPLAY_TO_API)) {
    if (api) out[api.toLowerCase()] = disp;
  }
  return out;
})();

export function apiToDisplay(api: string): string {
  const label = API_TO_DISPLAY[String(api || "").toLowerCase()];
  return label || api;
}

export function displayToApi(display: string): string | null {
  return MODEL_DISPLAY_TO_API[display] ?? null;
}

export function buildAvailablePairs(availableApis: string[]): Array<{ api: string; display: string }> {
  const seen = new Set<string>();
  const pairs: Array<{ api: string; display: string }> = [];

  // First, add mapped names where API is actually available
  for (const [display, api] of Object.entries(MODEL_DISPLAY_TO_API)) {
    if (!api) continue;
    const hit = availableApis.find(a => a.toLowerCase() === api.toLowerCase());
    if (hit && !seen.has(hit.toLowerCase())) {
      seen.add(hit.toLowerCase());
      pairs.push({ api: hit, display });
    }
  }

  // Then, include any remaining APIs the backend exposes without a mapping
  for (const api of availableApis) {
    const key = api.toLowerCase();
    if (seen.has(key)) continue;
    pairs.push({ api, display: api });
  }

  // Sort by display label A–Z
  pairs.sort((a, b) => a.display.localeCompare(b.display));
  return pairs;
}


