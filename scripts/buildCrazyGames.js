#!/usr/bin/env node
// Build the CrazyGames bundle: dist/crazygames/ and dist/planetilt-crazygames-v<VERSION>.zip.
//
// THE BUNDLE IS FLAT -- no folders (CLAUDE.md). CrazyGames' drag-and-drop
// upload can drop subfolders, and a game missing its scripts is a black
// screen nobody reports. So everything is one directory:
//
//   index.html        the dev page, with the importmap removed, the module
//                     script swapped for game.js, and the platform flag plus
//                     the CrazyGames SDK injected at BUILD:PLATFORM (and
//                     the API URL, when PLANETILT_API_URL is set)
//   game.js           main.js and everything it imports (three, cannon-es
//                     included), bundled and minified by esbuild
//   style.css         as-is
//   mazeLevels.json   as-is (fetched at runtime by a relative URL)
//   dailyLevels.json  as-is, the same way (the daily maze pool)
//
// The platform flag is the ONLY difference from the web page, and only
// platform.js reads it (CLAUDE.md: one codebase, two platforms).
//
// Run: node scripts/buildCrazyGames.js   (or npm run build:crazygames)
//
// --web builds the same flat bundle WITHOUT the platform flag or the SDK, into
// dist/web/ and with no zip: the plain web game, for GitHub Pages (published
// by .github/workflows/pages.yml). Pages serves only what is committed, and
// node_modules is not, so the dev page's importmap cannot load there; the
// bundle has three and cannon-es inside it.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const WEB = process.argv.includes('--web');
const OUT = path.join(ROOT, 'dist', WEB ? 'web' : 'crazygames');
// The release version in the zip's name, so each upload to CrazyGames is
// told apart from the last. Bump it for every zip that goes up; CG_VERSION
// overrides it for a one-off build.
const VERSION = (process.env.CG_VERSION || '1.0.1').trim().replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(VERSION)) throw new Error('CG_VERSION is not x.y.z: ' + VERSION);
const ZIP = WEB ? null : path.join(ROOT, 'dist', `planetilt-crazygames-v${VERSION}.zip`);

// The cloud save / leaderboard server (server/), when PLANETILT_API_URL is
// set at build time; without it the game builds exactly as before, no server.
const API = (process.env.PLANETILT_API_URL || '').trim().replace(/\/+$/, '');
if (API && !/^https?:\/\/[^\s"'<>]+$/.test(API)) throw new Error('PLANETILT_API_URL is not a URL: ' + API);
const API_TAG = API ? `<script>window.__PLANETILT_API__ = ${JSON.stringify(API)};</script>` : '';

const PLATFORM_TAGS = [
    ...(WEB ? [] : ['<script>window.__PLATFORM__ = \'crazygames\';</script>']),
    ...(API_TAG ? [API_TAG] : []),
    ...(WEB ? [] : ['<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>'])
].join('\n');

function page() {
    let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const swap = (re, to, what) => {
        if (!re.test(html)) throw new Error(`index.html: could not find ${what} to rewrite`);
        html = html.replace(re, to);
    };
    swap(/<!--\s*\n\s*Development page:[\s\S]*?-->\n/, '', 'the development comment');
    swap(/<!-- BUILD:PLATFORM -->/, PLATFORM_TAGS, 'the BUILD:PLATFORM marker');
    swap(/<script type="importmap">[\s\S]*?<\/script>\n/, '', 'the importmap');
    swap(/<script type="module" src="main.js"><\/script>/, '<script src="game.js"></script>', 'the main.js module script');
    // The landing site is the web's front door; CrazyGames players play at
    // once (features.requireLogin), so its build carries none of it.
    if (!WEB) swap(/<!-- LANDING:BEGIN[\s\S]*?<!-- LANDING:END -->\n/, '', 'the LANDING block');
    return html;
}

async function build() {
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });

    await esbuild.build({
        entryPoints: [path.join(ROOT, 'main.js')],
        bundle: true,
        minify: true,
        // A classic script, not a module: no import graph to resolve at load,
        // and it runs at the end of <body> where the HUD markup already exists.
        format: 'iife',
        target: ['es2020'],
        outfile: path.join(OUT, 'game.js'),
        legalComments: 'eof',
        logLevel: 'warning'
    });
    fs.writeFileSync(path.join(OUT, 'index.html'), page());
    for (const f of ['style.css', 'mazeLevels.json', 'dailyLevels.json']) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
    // The web build's landing site pictures (GitHub Pages keeps folders).
    if (WEB) fs.cpSync(path.join(ROOT, 'landing'), path.join(OUT, 'landing'), { recursive: true });

    // Flatness, checked rather than assumed.
    const entries = fs.readdirSync(OUT, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory());
    if (!WEB && dirs.length) throw new Error('bundle is not flat: ' + dirs.map(d => d.name).join(', '));
    if (!WEB && /LANDING|landing\//.test(fs.readFileSync(path.join(OUT, 'index.html'), 'utf8'))) throw new Error('the CrazyGames page still carries the landing site');

    const kb = f => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + ' KB';
    if (ZIP) {
        fs.rmSync(ZIP, { force: true });
        // -j: junk paths, so the zip is flat whatever the working directory.
        execFileSync('zip', ['-q', '-j', ZIP, ...entries.map(e => path.join(OUT, e.name))]);
        console.log('Built ' + path.relative(ROOT, ZIP) + ' (' + (fs.statSync(ZIP).size / 1024).toFixed(0) + ' KB):');
    } else {
        console.log('Built ' + path.relative(ROOT, OUT) + '/ (web, no SDK):');
    }
    for (const e of entries) if (!e.isDirectory()) console.log('  ' + e.name.padEnd(18) + kb(e.name));
    if (WEB) console.log('  landing/          ' + fs.readdirSync(path.join(OUT, 'landing')).length + ' pictures');
    console.log(API ? 'Cloud save + leaderboards: ' + API : 'No PLANETILT_API_URL: built without the cloud server.');
}

build().catch(e => { console.error(e); process.exit(1); });
