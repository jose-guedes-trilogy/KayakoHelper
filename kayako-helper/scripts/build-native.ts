// scripts/build-native.ts
//---------------------------------------------------------------
// Builds utils/native/kayako_helper.exe **once** using PyInstaller.
// Skip if the exe is already present (CI/CD friendly).

// scripts/build-native.ts
import { existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const root       = resolve(__dirname, "..");
const nativeDir  = join(root, "src", "utils", "native");   // 👈  one-liner
const exePath    = join(nativeDir, "kayako_helper.exe");
const helperPy   = join(nativeDir, "helper.py");

if (existsSync(exePath)) {
    console.log("✓ Native helper already built – skipping");
    process.exit(0);
}

console.log("⏳ Building native helper (.exe) via PyInstaller …");

const r = spawnSync(
    "pyinstaller",
    [
        "--noconfirm",
        "--onefile",
        "--name",
        "kayako_helper",
        "--distpath",
        nativeDir,          // 👈  drop the hard-coded utils/native path
        helperPy,
    ],
    { stdio: "inherit" }
);

if (r.status !== 0) {
    console.error("✗ PyInstaller failed");
    process.exit(r.status ?? 1);
}

console.log("✅ kayako_helper.exe generated");