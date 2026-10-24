#!/usr/bin/env node
// Build the CrazyGames bundle: dist/crazygames/ and
// dist/planetilt-crazygames-v<version>-<commit>.zip (version from package.json,
// commit from git, "-dirty" when built from uncommitted changes).
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
// dist/web/ and with no zip: the plain web game, for planetilt.com (a Render
// static site that runs this). A static host serves only what is committed, and
// node_modules is not, so the dev page's importmap cannot load there; the
// bundle has three and cannon-es inside it.
//
// The web build is also an INSTALLABLE APP with OFFLINE PLAY (the user's
// call, 2026-10-22; platform.js features.offlineInstall, web only -- never
// the CrazyGames bundle, which this script checks):
//   manifest.webmanifest  the app: name, icons, colours, standalone
//   icons/                the app icon (cropped from the marketing cover)
//   sw.js                 the service worker (as-is; see its header)
//   offline-manifest.json what sw.js keeps for an OFFLINE PLAY owner:
//                         { version, files }, the version a hash of every
//                         file's bytes, so each deploy is a new offline copy
// and the page's head gets the manifest link and the iPhone's Home Screen
// tags at BUILD:PLATFORM.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const WEB = process.argv.includes('--web');
const OUT = path.join(ROOT, 'dist', WEB ? 'web' : 'crazygames');
// The zip is named for what is in it, so an upload can always be traced to
// its code: package.json's version (bump it for each CrazyGames upload) and
// the commit it was built from.
const VERSION = require(path.join(ROOT, 'package.json')).version;
function commitTag() {
    try {
        const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
        const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT, encoding: 'utf8' }).trim();
        return sha ? '-' + sha + (dirty ? '-dirty' : '') : '';
    } catch (_) { return ''; }   // not a git checkout: the version alone
}
const ZIP = WEB ? null : path.join(ROOT, 'dist', `planetilt-crazygames-v${VERSION}${commitTag()}.zip`);

// The cloud save / leaderboard server (server/), when PLANETILT_API_URL is
// set at build time; without it the game builds exactly as before, no server.
const API = (process.env.PLANETILT_API_URL || '').trim().replace(/\/+$/, '');
if (API && !/^https?:\/\/[^\s"'<>]+$/.test(API)) throw new Error('PLANETILT_API_URL is not a URL: ' + API);
const API_TAG = API ? `<script>window.__PLANETILT_API__ = ${JSON.stringify(API)};</script>` : '';

// The installable app's head tags (web only).
const APP_TAGS = [
    '<link rel="manifest" href="manifest.webmanifest">',
    '<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">',
    '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-title" content="PlaneTilt">',
    // Drawn under the status bar like the rest of the page (safeArea.js keeps
    // the bars clear of it).
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'
];
const BG = '#070a17';   // style.css --bg
const MANIFEST = {
    name: 'PlaneTilt',
    short_name: 'PlaneTilt',
    description: 'Tilt the board. Roll to the rescue. Fifty marble mazes on five planets.',
    id: '/',
    start_url: '/',
    scope: '/',
    // No orientation: a phone holds portrait itself (portraitLock.js), and a
    // tablet or computer must not be locked.
    display: 'standalone',
    background_color: BG,
    theme_color: BG,
    icons: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        // Full-bleed art with the marble in the middle: safe to mask.
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
};

const PLATFORM_TAGS = [
    ...(WEB ? APP_TAGS : []),
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

// The web app: manifest, icons, service worker, and the offline copy's list.
// Not the landing pictures: a player who owns offline play is signed in, and
// signing out drops the copy (offlinePlay.js), so the site is never shown
// offline.
function writeApp() {
    fs.cpSync(path.join(ROOT, 'icons'), path.join(OUT, 'icons'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'sw.js'), path.join(OUT, 'sw.js'));
    fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), JSON.stringify(MANIFEST, null, 2) + '\n');
    const files = ['index.html', 'game.js', 'style.css', 'mazeLevels.json', 'dailyLevels.json', 'manifest.webmanifest',
        ...fs.readdirSync(path.join(OUT, 'icons')).sort().map(f => 'icons/' + f)];
    const hash = require('crypto').createHash('sha256');
    for (const f of files) { hash.update(f + '\0'); hash.update(fs.readFileSync(path.join(OUT, f))); }
    // The page is cached as '/', the address players open.
    fs.writeFileSync(path.join(OUT, 'offline-manifest.json'), JSON.stringify({ version: hash.digest('hex').slice(0, 16), files: files.map(f => (f === 'index.html' ? './' : f)) }) + '\n');
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
    // The web build's landing site pictures (the web host keeps folders).
    if (WEB) fs.cpSync(path.join(ROOT, 'landing'), path.join(OUT, 'landing'), { recursive: true });
    if (WEB) writeApp();

    // Flatness, checked rather than assumed.
    const entries = fs.readdirSync(OUT, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory());
    if (!WEB && dirs.length) throw new Error('bundle is not flat: ' + dirs.map(d => d.name).join(', '));
    if (!WEB && /LANDING|landing\//.test(fs.readFileSync(path.join(OUT, 'index.html'), 'utf8'))) throw new Error('the CrazyGames page still carries the landing site');
    // No app and no offline copy on CrazyGames (platform.js features.offlineInstall).
    if (!WEB && (/rel="manifest"|apple-mobile-web-app/.test(fs.readFileSync(path.join(OUT, 'index.html'), 'utf8')) || entries.some(e => /^(sw\.js|manifest\.webmanifest|offline-manifest\.json)$/.test(e.name)))) throw new Error('the CrazyGames bundle carries the web app or its service worker');

    const kb = f => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + ' KB';
    if (ZIP) {
        // Older builds' zips go, so dist/ holds just the one to upload.
        for (const f of fs.readdirSync(path.join(ROOT, 'dist'))) if (/^planetilt-crazygames.*\.zip$/.test(f)) fs.rmSync(path.join(ROOT, 'dist', f), { force: true });
        // -j: junk paths, so the zip is flat whatever the working directory.
        execFileSync('zip', ['-q', '-j', ZIP, ...entries.map(e => path.join(OUT, e.name))]);
        console.log('Built ' + path.relative(ROOT, ZIP) + ' (' + (fs.statSync(ZIP).size / 1024).toFixed(0) + ' KB):');
    } else {
        console.log('Built ' + path.relative(ROOT, OUT) + '/ (web, no SDK):');
    }
    for (const e of entries) if (!e.isDirectory()) console.log('  ' + e.name.padEnd(22) + kb(e.name));
    if (WEB) console.log('  landing/          ' + fs.readdirSync(path.join(OUT, 'landing')).length + ' pictures');
    if (WEB) console.log('  icons/            ' + fs.readdirSync(path.join(OUT, 'icons')).length + ' icons; offline copy v' + JSON.parse(fs.readFileSync(path.join(OUT, 'offline-manifest.json'), 'utf8')).version);
    console.log(API ? 'Cloud save + leaderboards: ' + API : 'No PLANETILT_API_URL: built without the cloud server.');
}

build().catch(e => { console.error(e); process.exit(1); });
