#!/usr/bin/env node
// scripts/build.js -- the CrazyGames bundle of Marble Rush.
//
//   node scripts/build.js          -> dist/crazygames/
//   node scripts/build.js --zip    -> also dist/marblerush-crazygames-<build>.zip
//
// <build> is VERSION plus the git sha, e.g. v0.1.0-1a2b3c4-cg. CG_VERSION
// overrides the version, CG_BUILD the whole label. Bump VERSION for each zip
// that goes up to CrazyGames.
//
// It only PACKAGES. What differs on CrazyGames lives in platform.js; this
// script turns that on by injecting window.__PLATFORM__ and the SDK into
// index.html with an exact-match edit that FAILS the build if index.html moved.
//
// The bundle is FLAT, no folders: CrazyGames' portal takes a drag-and-drop of
// the unzipped files and a drop can lose its folders (Ball Smack lost vendor/,
// fonts/ and icons/ that way on 2026-10-04). index.html's import map already
// uses flat names, so nothing needs rewriting; the build fails if a shipped
// file would land in a folder or a module imports by root path.
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const VENDOR = require('./vendor');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'crazygames');
const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const VERSION = 'v' + String(process.env.CG_VERSION || '0.1.0').replace(/^v/i, '');

// CrazyGames' published limits (as recorded in 3dBallSmack's build script).
const MAX_FILES = 1500;
const MOBILE_HOMEPAGE_BYTES = 20 * 1024 * 1024;

function fail(msg) { console.error('\n[build] FAILED: ' + msg + '\n'); process.exit(1); }
function git(cmd) {
    try { return execSync('git ' + cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch (_) { return null; }
}
const BUILD = process.env.CG_BUILD || VERSION + '-' + (git('rev-parse --short HEAD') || 'local') + '-cg';

// What ships: tracked files at the repo root that the page uses. Taken from
// git's index, so nothing untracked rides along.
function shipped(rel) {
    if (rel.includes('/')) return false;                    // docs/, scripts/ ...
    if (/^test_.*\.js$/.test(rel)) return false;
    if (/\.js$/.test(rel)) return true;
    return ['index.html', 'style.css', 'mazeLevels.json'].includes(rel);
}
const tracked = (git('ls-files') || '').split('\n').filter(Boolean);
if (!tracked.length) fail('git ls-files returned nothing -- run this inside the repo.');
const files = tracked.filter(shipped);

const HTML_EDITS = [{
    why: 'turn on CrazyGames mode and load the SDK before any module runs',
    find: '    <script type="importmap">',
    replace: '    <script>window.__PLATFORM__ = "crazygames"; window.__BUILD_VERSION__ = ' + JSON.stringify(BUILD) + ';</script>\n' +
             '    <script src="' + SDK_URL + '"></script>\n' +
             '    <script type="importmap">',
}];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const rel of files) {
    let text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (rel === 'index.html') {
        for (const e of HTML_EDITS) {
            const n = text.split(e.find).length - 1;
            if (n !== 1) fail(`index.html: expected exactly one match to ${e.why}, found ${n}. Update HTML_EDITS to match index.html.`);
            text = text.replace(e.find, e.replace);
        }
    }
    // A root-relative path breaks when CrazyGames serves the game from a sub-path.
    if (/\.js$/.test(rel) && /(fetch\(\s*['"`]\/[^'"`\s]|from\s+['"]\/[^'"\s]|import\(\s*['"]\/[^'"\s])/.test(text)) {
        fail(`${rel} loads something by a root-relative path ('/...'); use a relative one.`);
    }
    fs.writeFileSync(path.join(OUT, rel), text);
}
for (const [name, src] of Object.entries(VENDOR)) {
    if (!fs.existsSync(src)) fail(`vendor file missing: ${src} -- run npm install.`);
    if (fs.existsSync(path.join(OUT, name))) fail(`name clash: ${name} is both an app file and a vendor file.`);
    fs.copyFileSync(src, path.join(OUT, name));
}

// Every relative import in every shipped module must resolve to a file in the
// (flat) bundle.
const out = fs.readdirSync(OUT);
for (const f of out.filter(n => n.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(OUT, f), 'utf8');
    for (const m of text.matchAll(/(?:from\s+|import\(\s*)['"](\.\/[^'"]+)['"]/g)) {
        const target = m[1].slice(2);
        if (target.includes('/')) fail(`${f} imports ${m[1]}, which points into a folder; the bundle is flat.`);
        if (!out.includes(target)) fail(`${f} imports ${m[1]}, which is not in the bundle.`);
    }
}

const total = out.reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
if (out.length > MAX_FILES) fail(`${out.length} files, over CrazyGames' ${MAX_FILES}.`);
if (total > MOBILE_HOMEPAGE_BYTES) console.warn(`[build] warning: ${(total / 1048576).toFixed(1)} MB is over the 20 MB mobile-homepage threshold.`);
console.log(`[build] ${BUILD}: ${out.length} files, ${(total / 1048576).toFixed(2)} MB in dist/crazygames/`);

if (process.argv.includes('--zip')) {
    const zipPath = path.join(ROOT, 'dist', `marblerush-crazygames-${BUILD}.zip`);
    fs.rmSync(zipPath, { force: true });
    try { execSync(`zip -qrD ${JSON.stringify(zipPath)} .`, { cwd: OUT, stdio: 'inherit' }); }
    catch (_) { fail('could not run "zip" -- install it, or upload the dist/crazygames folder\'s contents instead.'); }
    console.log(`[build] zip     dist/${path.basename(zipPath)}`);
}
