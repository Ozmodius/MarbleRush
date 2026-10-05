#!/usr/bin/env node
// Development server: serves the repo root, plus the vendor files at the flat
// names the import map expects. No dependencies.
//
//   node scripts/serve.js [port]       (default 8080, or $PORT)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const VENDOR = require('./vendor');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

function resolve(urlPath) {
    const name = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    if (VENDOR[name]) return VENDOR[name];
    const full = path.resolve(ROOT, name);
    // Stay inside the repo, and never hand out node_modules, scripts or dotfiles.
    if (!full.startsWith(ROOT + path.sep) && full !== ROOT) return null;
    const rel = path.relative(ROOT, full);
    if (/^(node_modules|scripts|\.git)([\\/]|$)/.test(rel) || rel.split(path.sep).some(p => p.startsWith('.'))) return null;
    return full;
}

const server = http.createServer((req, res) => {
    const file = resolve(req.url);
    if (!file) { res.writeHead(404); return res.end('Not found'); }
    fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(buf);
    });
});
server.listen(PORT, () => console.log(`Marble Rush on http://localhost:${PORT}`));
module.exports = server;
