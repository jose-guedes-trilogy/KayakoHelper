// scripts/build-native.ts
//---------------------------------------------------------------
// Builds utils/native/kayako_helper.exe **once** using PyInstaller.
// Skip if the exe is already present (CI/CD friendly).

import { existsSync } from "fs";
import { join, resolve } from "path";
import { spawnSync } from "child_process";

const root = resolve(__dirname, "..");
const exePath = join(root, "utils", "native", "kayako_helper.exe");
const helperPy = join(root, "utils", "native", "helper.py");

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
        join(root, "utils", "native"),
        helperPy,
    ],
    { stdio: "inherit" }
);

if (r.status !== 0) {
    console.error("✗ PyInstaller failed");
    process.exit(r.status ?? 1);
}

console.log("✅ kayako_helper.exe generated");
