#!/usr/bin/env node
// src/selectors/build-selectors.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import prettier from 'prettier';
import { fileURLToPath } from 'url';

/* ------------------------------------------------------------------ */
/*  Path helpers that work everywhere                                 */
/* ------------------------------------------------------------------ */
const __filename = fileURLToPath(import.meta.url);        // full path to this file
const __dirname  = path.dirname(__filename);              // .../src/selectors
const ROOT       = path.resolve(__dirname, '..', '..');   // project root
const SRC        = path.join(ROOT, 'src');
const OUT        = path.join(SRC, 'generated');

const JSON_PATH  = path.join(__dirname, 'selectors.json');      // same dir
const SCSS_TMPL  = path.join(__dirname, '_tmpl.scss');          // optional
const TS_PATH    = path.join(OUT, 'selectors.ts');
const SCSS_PATH  = path.join(OUT, '_selectors.scss');

/* ------------------------------------------------------------------ */
/*  Read selectors.json                                               */
/* ------------------------------------------------------------------ */
const raw = await fs.readFile(JSON_PATH, 'utf8');
const data = JSON.parse(raw);

/* ------------------------------------------------------------------ */
/*  Build selectors.ts                                                */
/* ------------------------------------------------------------------ */
function buildTS() {
    const makeInterface = (name, obj) =>
        `export interface ${name} {\n${Object.keys(obj)
            .map((k) => `  ${k}: string;`)
            .join('\n')}\n}\n`;

    const kayakoKeys = data.kayako;
    const extKeys = data.extension;

    const ts = [
        '/* AUTO-GENERATED – DO NOT EDIT */',
        makeInterface('KayakoSelectors', kayakoKeys),
        makeInterface('ExtensionSelectors', extKeys),

        'export const KAYAKO_SELECTORS: KayakoSelectors = {',
        ...Object.entries(kayakoKeys).map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`),
        '};',

        'export const EXTENSION_SELECTORS: ExtensionSelectors = {',
        ...Object.entries(extKeys).map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`),
        '};',
        '',
    ].join('\n');

    return prettier.format(ts, { parser: 'typescript' });
}

/* ------------------------------------------------------------------ */
/*  Build _selectors.scss                                             */
/* ------------------------------------------------------------------ */
async function buildSCSS() {
    let header = '';
    try {
        header = await fs.readFile(SCSS_TMPL, 'utf8');
    } catch {
        /* header is optional → ignore */
    }

    const lines = [header.trimEnd(), ''];

    /* -------- Sass variables -------- */
    for (const [k, v] of Object.entries(data.kayako))
        lines.push(`$${k}: ${JSON.stringify(v)};`);
    for (const [k, v] of Object.entries(data.extension))
        lines.push(`$${k}: ${JSON.stringify(v)};`);

    lines.push('');

    /* -------- Custom-props on :root (optional) -------- */
    lines.push(':root {');

    for (const [k, v] of Object.entries(data.kayako))
        lines.push(`  --kayako-${k}: ${JSON.stringify(v)};`);
    for (const [k, v] of Object.entries(data.extension))
        lines.push(`  --extension-${k}: ${JSON.stringify(v)};`);

    lines.push('}', '', ':export {');
    for (const [k, v] of Object.entries(data.kayako))
        lines.push(`  ${k}: ${JSON.stringify(v)};`);
    for (const [k, v] of Object.entries(data.extension))
        lines.push(`  ${k}: ${JSON.stringify(v)};`);
    lines.push('}', '');

    return prettier.format(lines.join('\n'), { parser: 'scss' });
}

/* ------------------------------------------------------------------ */
/*  Write files                                                       */
/* ------------------------------------------------------------------ */
await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(TS_PATH, await buildTS(), 'utf8');
await fs.writeFile(SCSS_PATH, await buildSCSS(), 'utf8');

console.log('selectors.ts and _selectors.scss generated ✅');
