// Starts the PlaneTilt API. Render (or any host) runs `node server/index.js`
// from the repo root; the server reads the game's own level files and save
// rules from there, so it can never disagree with the game about them.
//
// Env:
//   PORT                       set by Render
//   DATABASE_URL               Postgres; without it, an in-memory store
//                              (fine for trying it out, lost on restart)
//   ALLOWED_ORIGINS            '*' (default) or a comma list, see app.js
//   CRAZYGAMES_PUBLIC_KEY_URL  where CrazyGames publishes its token key
//   CRAZYGAMES_PUBLIC_KEY_PEM  or the key itself
//   RATE_LIMIT                 requests per IP per minute (default 240)
//   ADMIN_TOKEN                opens the stats page (/admin); unset, it is off

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createPgStore, createMemoryStore } from './db.js';
import { createCrazyVerifier, DEFAULT_KEY_URL } from './auth.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readLevels = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')).levels || [];

const env = process.env;
const store = env.DATABASE_URL ? await createPgStore(env.DATABASE_URL) : createMemoryStore();
if (!env.DATABASE_URL) console.warn('[api] no DATABASE_URL: using an in-memory store (data is lost on restart)');

const handle = createApp({
    store,
    levels: readLevels('mazeLevels.json'),
    dailyLevels: readLevels('dailyLevels.json'),
    verifyCrazy: createCrazyVerifier({
        pem: env.CRAZYGAMES_PUBLIC_KEY_PEM ? env.CRAZYGAMES_PUBLIC_KEY_PEM.replace(/\\n/g, '\n') : null,
        keyUrl: env.CRAZYGAMES_PUBLIC_KEY_URL || DEFAULT_KEY_URL
    }),
    origins: env.ALLOWED_ORIGINS || '*',
    rateMax: Number(env.RATE_LIMIT) || 240,
    adminToken: env.ADMIN_TOKEN || null
});

const server = http.createServer(handle);
const port = Number(env.PORT) || 8787;
server.listen(port, () => console.log(`[api] PlaneTilt API on :${port} (${store.kind})`));
const stop = () => server.close(() => store.close().then(() => process.exit(0)));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
