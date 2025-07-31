#!/usr/bin/env python3
"""
src/utils/native/helper.py  –  native-messaging bridge  +  KB-host babysitter
============================================================

Changes since the last version:
• Auto-starts `kb_host.py` in a background process the first time we need it.
• Keeps the one-shot PyInstaller-friendliness (see bottom of file).
• All “mkdir” logic & JSON pipe framing remain 100 % intact.
"""

import sys, struct, json, os, requests, time, subprocess, socket, shutil
from pathlib import Path
from threading import Thread
from typing import Any, Dict, Optional

# ────────────────────────────── Config ────────────────────────────────
KB_PORT         = 8000
KB_URL          = f"http://127.0.0.1:{KB_PORT}/query"
KB_STARTUP_SEC  = 25               # give kb_host time to load its model
REQUEST_TIMEOUT = 10
EXE_NAME        = "kayako_helper.exe"
# ──────────────────────────────────────────────────────────────────────


# —— Native-messaging framing ————————————————————————————————
def _read_msg() -> Optional[Dict[str, Any]]:
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    n = struct.unpack("<I", raw)[0]
    return json.loads(sys.stdin.buffer.read(n).decode("utf-8"))


def _send_msg(obj: Dict[str, Any]) -> None:
    b = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(b)))
    sys.stdout.buffer.write(b)
    sys.stdout.buffer.flush()


# —— Ticket-folder handler (unchanged) ————————————————————————
def _handle_mkdir(msg: Dict[str, Any]) -> None:
    tid      = str(msg.get("ticketId"))
    loc      = msg.get("location")
    base_dir = (Path.home() / "Downloads") if loc == "DOWNLOADS" else Path("V:/Tickets")
    folder   = base_dir / tid

    already = folder.exists()
    try:
        if not already:
            os.makedirs(folder)
        _send_msg({
            "type": "mkdir-result",
            "success": True,
            "path": str(folder),
            "alreadyExisted": already,
        })
    except Exception as e:
        _send_msg({
            "type": "mkdir-result",
            "success": False,
            "error": str(e),
        })


# —— KB-host babysitting ————————————————————————————————
_kb_started = False
_kb_proc: Optional[subprocess.Popen] = None


def _is_kb_up() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", KB_PORT), timeout=0.2):
            return True
    except OSError:
        return False


def _spawn_kb_host() -> None:
    global _kb_started, _kb_proc
    if _kb_started or _is_kb_up():
        return

    here = Path(__file__).parent.resolve()
    kb_path = here / "kb_host.py"           # side-by-side file
    if not kb_path.exists():
        _send_msg({"type": "search-result", "success": False,
                   "error": f"kb_host.py not found at {kb_path}"})
        return

    # On Windows under PyInstaller one-file, sys.executable == bundle.exe
    py = sys.executable
    _kb_proc = subprocess.Popen(
        [py, "-u", str(kb_path)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
        cwd=str(kb_path.parent),
    )
    _kb_started = True

    # give it a bit of head-start in a thread so we stay responsive
    def _wait():
        deadline = time.time() + KB_STARTUP_SEC
        while time.time() < deadline:
            if _is_kb_up():
                return
            time.sleep(0.4)

    Thread(target=_wait, daemon=True).start()


# —— Search handler —————————————————————————————————————————
def _handle_search(msg: Dict[str, Any]) -> None:
    _spawn_kb_host()

    payload = {k: v for k, v in msg.items() if k in {"text", "k", "filters"}}
    t0 = time.perf_counter()
    try:
        r = requests.post(KB_URL, json=payload, timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
        _send_msg({
            "type": "search-result",
            "success": True,
            "elapsedMs": int((time.perf_counter() - t0) * 1000),
            **r.json(),
        })
    except Exception as e:
        _send_msg({
            "type": "search-result",
            "success": False,
            "error": str(e),
        })


# —— Main loop ————————————————————————————————————————————
def main() -> None:
    while True:
        m = _read_msg()
        if m is None:
            break

        match m.get("type", "mkdir"):
            case "search":
                _handle_search(m)
            case "mkdir" | _:
                _handle_mkdir(m)


# —— Entry point ——————————————————————————————————————————
if __name__ == "__main__":
    main()

"""
───────────────────────────────────────────────────────────────────────────────
🛠  PACKAGING  (set-and-forget)
───────────────────────────────────────────────────────────────────────────────
We want an .exe *only if* it isn’t already present.  The Node build-step
below does exactly that using PyInstaller’s one-file mode.

1.  Save this helper.py next to kb_host.py (they’re bundled together).

2.  Add `scripts/build-native.ts` (see next section) and wire it in
    `package.json`   →   "postinstall": "ts-node scripts/build-native.ts"

3.  Commit; `npm install` on any machine will now leave a ready-made
    kayako_helper.exe in  utils/native/   *unless it already exists*.

PyInstaller hint for FAISS/torch:
    pyinstaller helper.py -n kayako_helper --onefile ^
        --add-data "data/index;data/index"
"""
