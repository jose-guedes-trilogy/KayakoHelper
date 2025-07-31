#!/usr/bin/env python3
"""
src/utils/native/kb_host.py – semantic KB server (dynamic hybrid fusion + Cross‑Encoder re‑ranking)
===============================================================================
This is a drop‑in replacement for the previous *kb_host.py* with two key upgrades:

1. **Dynamic hybrid fusion** — the cosine‑vs‑BM25 weight α is chosen per query:
      • Long / natural‑language queries ( >3 tokens ) → α ≈ 0.85 (dense‑heavy)
      • Short keyword queries                        → α ≈ 0.40 (lexical‑heavy)

2. **Cross‑Encoder re‑ranking** — top `RERANK_CANDIDATES` hits are rescored with
   a Cross‑Encoder (`cross-encoder/ms-marco-MiniLM-L12-v2`) and then truncated
   to the final `k` results.

No other endpoints or behaviours changed, so your extension can continue to hit
`POST /query` exactly as before.
"""

from __future__ import annotations

import json, struct, sys, threading, sqlite3, functools, re
from pathlib import Path
from typing import Dict, Any, Optional, List

import faiss, numpy as np
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer, CrossEncoder
from symspellpy import SymSpell, Verbosity
from rapidfuzz import process as rf_proc

# ───── USER CONFIG ───────────────────────────────────────────────
MODEL_ALIAS: str = "miniLM"      # pick one of the keys in MODELS below
DEVICE:      str = "cpu"          # "cpu", "cuda", or "mps"
INDEX_ROOT   = Path("data") / "index"      # base dir of per‑model indexes
PORT:        int = 8000                     # FastAPI/uvicorn port

# —— Re‑ranking ----------------------------------------------------
RERANK_MODEL_ID  = "cross-encoder/ms-marco-MiniLM-L12-v2"
RERANK_CANDIDATES = 50  # how many candidates to feed the Cross‑Encoder

# ──────────────────────────────────────────────────────────────────

# Map alias ➜ HF model (mirrors evaluate_models.py)
MODELS: Dict[str, str] = {
    "stk-mpnet": "flax-sentence-embeddings/stackoverflow_mpnet-base",
    "all-mpnet": "sentence-transformers/all-mpnet-base-v2",
    "bge-base":  "BAAI/bge-base-en-v1.5",
    "e5-base":   "intfloat/e5-base-v2",
    "miniLM":    "sentence-transformers/all-MiniLM-L6-v2",
    "arctic-l":  "Snowflake/snowflake-arctic-embed-l-v2.0",  # local 4‑bit quant dir
}

TOP_K         = 10
SNIP_LEN      = 160      # snippet chars
N_CANDIDATES  = 60       # first‑stage dense + BM25 pool
MAX_EDIT_DIST = 3        # SymSpell param
BM25_CANDMULT = 40
BM25_FALLBACK = 400

# -----------------------------------------------------------------
if MODEL_ALIAS not in MODELS:
    raise ValueError(f"Unknown MODEL_ALIAS '{MODEL_ALIAS}'. Choose one of: {', '.join(MODELS)}")

MODEL_ID  = MODELS[MODEL_ALIAS]
INDEX_DIR = INDEX_ROOT / f"index_{MODEL_ALIAS}"
print(f"🔹 Starting KB server using model '{MODEL_ALIAS}' → {MODEL_ID}")
print(f"🔹 Loading assets from {INDEX_DIR}")

# ─────────── FAISS index & embedding model ───────────
index = faiss.read_index(str(INDEX_DIR / "faiss.index"))
inner = index.index if isinstance(index, faiss.IndexIDMap2) else index
if hasattr(inner, "hnsw"):
    inner.hnsw.efSearch = 128
if hasattr(inner, "nprobe"):
    inner.nprobe = 32

model = SentenceTransformer(MODEL_ID, device=DEVICE, trust_remote_code=True)
model.max_seq_length = 320  # must match index build

# ─────────── Cross‑Encoder re‑ranker ───────────
print(f"⏳ Loading Cross‑Encoder '{RERANK_MODEL_ID}' on '{DEVICE}' …")
rerank_model = CrossEncoder(RERANK_MODEL_ID, device=DEVICE)
print("✅  Cross‑Encoder ready")

# ─────────── SQLite metadata DB ───────────
db  = sqlite3.connect(INDEX_DIR / "meta.sqlite", check_same_thread=False)
cur = db.cursor()

# -- bootstrap full‑text table on first run -----------------------

def _fts_exists(c: sqlite3.Cursor) -> bool:
    return c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chunk_fts'").fetchone() is not None

if not _fts_exists(cur):
    print("⚠️  No chunk_fts table – run build_index.py first or check your paths.")
    raise SystemExit(1)

# -- detect optional columns -------------------------------------
cur.execute("PRAGMA table_info(chunks)")
_CHUNK_COLS = {r[1] for r in cur.fetchall()}
HAS_INTERNAL = "internal" in _CHUNK_COLS
HAS_STATUS   = "status"   in _CHUNK_COLS

# ----------------------------------------------------------------
app = FastAPI()

# ─────────── SymSpell vocabulary build ───────────
print("⏳  Building SymSpell vocabulary …")
sym = SymSpell(max_dictionary_edit_distance=MAX_EDIT_DIST)
_tok_re = re.compile(r"[A-Za-z0-9']+")

try:
    cur.execute("CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vocab USING fts5vocab(chunk_fts,'row')")
    for (term,) in cur.execute("SELECT term FROM chunk_vocab"):
        if len(term) > 3:
            sym.create_dictionary_entry(term.lower(), 1)
except sqlite3.OperationalError:
    # read‑only DB or FTS5‑vocab not supported → spell‑correction silently disabled
    pass

print("⏳  Expanding with raw tokens …")
for (txt,) in cur.execute("SELECT text FROM chunk_fts LIMIT 100000"):
    for tok in _tok_re.findall(txt.lower()):
        if len(tok) > 3:
            sym.create_dictionary_entry(tok, 1)
VOCAB = set(sym.words)
print(f"✅  {len(VOCAB):,} spell tokens")

# ─────────── helper functions ───────────

_ise_re = re.compile(r"([a-z]+)isation$", re.I)

def _correct(tok: str) -> str:
    if len(tok) < 4 or tok in VOCAB or tok.isupper():
        return tok
    m = _ise_re.match(tok)
    if m:
        return m.group(1) + "ization"
    sug = sym.lookup(tok.lower(), Verbosity.TOP, MAX_EDIT_DIST)
    if sug:
        return sug[0].term
    best, score, _ = rf_proc.extractOne(tok.lower(), VOCAB)
    return best if score >= 85 else tok


def _bm25_scores(txt: str, limit: int):
    rows = cur.execute(
        "SELECT chunk_id, bm25(chunk_fts) FROM chunk_fts WHERE chunk_fts MATCH ? ORDER BY bm25(chunk_fts) LIMIT ?",
        (txt, limit),
    ).fetchall()
    return {cid: s for cid, s in rows}


def _minmax(d: Dict[int, float]):
    if not d:
        return {}
    lo, hi = min(d.values()), max(d.values())
    return {k: 1.0 for k in d} if lo == hi else {k: (v - lo) / (hi - lo) for k, v in d.items()}


# —— Dynamic hybrid fusion helpers --------------------------------

def _alpha_for_query(q: str) -> float:
    """Choose cosine‑vs‑BM25 weight per query."""
    return 0.85 if len(q.split()) > 2 else 0.65


def _rank(txt: str, allowed: Optional[set[int]], alpha: float):
    v = model.encode([txt], normalize_embeddings=True)
    cos_d, idxs = index.search(np.asarray(v, dtype="float32"), N_CANDIDATES)
    cos = {int(cid): float(s) for cid, s in zip(idxs[0], cos_d[0]) if allowed is None or cid in allowed}

    bm25_raw = _bm25_scores(txt, N_CANDIDATES * BM25_CANDMULT)
    if allowed is not None:
        bm25_raw = {cid: s for cid, s in bm25_raw.items() if cid in allowed}
    bm25 = _minmax(bm25_raw)

    fused = [
        (alpha * cos.get(cid, 0) + (1 - alpha) * bm25.get(cid, 0), cid)
        for cid in set(cos) | set(bm25)
    ]
    fused.sort(reverse=True)
    return [cid for _, cid in fused]


def _blend(cid: int, q: str, alpha: float):
    bm = _bm25_scores(q, 1).get(cid, 0)
    vq = model.encode([q], normalize_embeddings=True)
    sim, _ = index.search(np.asarray(vq, dtype="float32"), 1)
    return alpha * float(sim[0][0]) + (1 - alpha) * bm


# —— Dedupe + metadata helpers ------------------------------------

def _dedup(ids: List[int], k: int) -> List[int]:
    seen, uniq = set(), []
    for cid in ids:
        aid = cid >> 8
        if aid not in seen:
            seen.add(aid)
            uniq.append(cid)
            if len(uniq) == k:
                break
    return uniq


def _to_chunks(ids: List[int]):
    if not ids:
        return []
    order = {cid: i for i, cid in enumerate(ids)}

    cols = ["c.chunk_id", "c.title", "c.url", "c.product", "c.category"]
    keys = ["chunk_id", "title", "url", "product", "category"]
    if HAS_INTERNAL:
        cols.append("c.internal"); keys.append("internal")
    if HAS_STATUS:
        cols.append("c.status");   keys.append("status")
    cols.append(f"SUBSTR(f.text, 1, {SNIP_LEN}) AS snippet"); keys.append("snippet")

    q = (
        f"SELECT {', '.join(cols)} FROM chunks AS c "
        f"JOIN chunk_fts AS f USING(chunk_id) WHERE c.chunk_id IN ({','.join('?'*len(ids))})"
    )
    rows = cur.execute(q, ids).fetchall()
    rows.sort(key=lambda r: order[r[0]])
    return [dict(zip(keys, r)) for r in rows]


# —— SQL filter builder -------------------------------------------

def _build_where(f: Dict[str, Any]):
    if not f:
        return "", []
    c, p = [], []

    def _eq(col, v):
        c.append(f"LOWER(TRIM({col}))=?"); p.append(v.lower().strip())

    if "product"  in f: _eq("product",  f["product"])
    if "category" in f: _eq("category", f["category"])
    if "status"   in f and HAS_STATUS:   _eq("status", f["status"])
    if "internal" in f and HAS_INTERNAL:
        c.append("COALESCE(internal,0)=?"); p.append(int(f["internal"]))

    return ("WHERE " + " AND ".join(c), p) if c else ("", [])


# —— Main search API ----------------------------------------------

class QueryReq(BaseModel):
    text: str
    k: Optional[int] = TOP_K
    filters: Optional[Dict[str, Any]] = None


@app.post("/query")
def _api(req: QueryReq):
    return search(req.text, req.k or TOP_K, req.filters or {})


def search(text: str, k: int = TOP_K, filters: Optional[Dict[str, Any]] = None):
    filters = filters or {}

    # —— spell‑correction ———————————————————————————
    corrected = " ".join(_correct(t) for t in _tok_re.findall(text))
    queries = [corrected]

    # —— SQL filters ———————————————————————————
    where_sql, params = _build_where(filters)
    allowed = {
        cid for (cid,) in cur.execute(f"SELECT chunk_id FROM chunks {where_sql}", params)
    } if where_sql else None

    # —— dynamic α ———————————————————————————
    alpha = _alpha_for_query(corrected)

    # —— stage 1: dense + BM25 hybrid —————————————————
    hit_lists = [(_rank(q, allowed, alpha), q) for q in queries]
    hit_lists.sort(key=lambda p: (-_blend(p[0][0], p[1], alpha) if p[0] else float("inf"), 0))
    first_stage = hit_lists[0][0] if hit_lists else []

    # —— stage 2: article‑level dedupe —————————————————
    first_stage = _dedup(first_stage, RERANK_CANDIDATES)

    # —— fallback purely‑lexical if no hits —————————
    if not first_stage:
        bm25_raw = _bm25_scores(corrected, BM25_FALLBACK)
        if allowed is not None:
            bm25_raw = {cid: s for cid, s in bm25_raw.items() if cid in allowed}
        first_stage = sorted(bm25_raw, key=bm25_raw.get, reverse=True)[:RERANK_CANDIDATES]

    # —— fetch metadata for candidates ————————————
    chunks = _to_chunks(first_stage)

    # —— stage 3: Cross‑Encoder re‑ranking ——————————
    if chunks:
        pairs = [[corrected, c["snippet"]] for c in chunks]
        scores = rerank_model.predict(pairs, batch_size=16)
        for c, s in zip(chunks, scores):
            c["score"] = float(s)
        chunks.sort(key=lambda x: -x["score"])
        chunks = chunks[:k]

    return {
        "corrected": corrected if corrected != text else None,
        "results":   chunks,
    }


# —— stdin pipe glue (unchanged) ----------------------------------

def _read():
    raw = sys.stdin.buffer.read(4)
    if not raw:
        sys.exit(0)
    n = struct.unpack("=I", raw)[0]
    return json.loads(sys.stdin.buffer.read(n).decode())


def _send(obj):
    b = json.dumps(obj).encode()
    sys.stdout.buffer.write(struct.pack("=I", len(b)))
    sys.stdout.buffer.write(b)
    sys.stdout.buffer.flush()


def _native():
    while True:
        m = _read()
        if m.get("type") == "query":
            _send({"type": "results", **search(m["text"], m.get("k", TOP_K), m.get("filters"))})


# —— main —————————————————————————————————————————
if __name__ == "__main__":
    threading.Thread(target=_native, daemon=True).start()
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=PORT)
