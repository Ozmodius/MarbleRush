// STORAGE for the PlaneTilt server: players and their device tokens, one save
// per player, best times per leaderboard, and short-lived link codes.
//
// Two implementations behind one interface:
//   createPgStore(url)   Postgres (production, DATABASE_URL)
//   createMemoryStore()  in memory (tests, and running locally without a DB)
// Every method is async so the two are interchangeable.
//
// Tables are created on start (CREATE TABLE IF NOT EXISTS) -- no separate
// migration step to forget on deploy.

import pg from 'pg';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,                 -- 'guest' | 'crazygames'
    external_id TEXT,                          -- the CrazyGames user id
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (kind, external_id)
);
CREATE TABLE IF NOT EXISTS tokens (
    token_hash  TEXT PRIMARY KEY,              -- sha256 of the bearer token
    player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS saves (
    player_id   TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    data        JSONB NOT NULL,                -- the game's own save, merged
    saved_at    BIGINT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS scores (
    player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    board       TEXT NOT NULL,                 -- 'roll:w1_01' | 'walk:w1_01' | 'daily:2026-10-07:d1_03'
    ms          INTEGER NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (player_id, board)
);
CREATE INDEX IF NOT EXISTS scores_board_ms ON scores (board, ms);
-- Play tracking (2026-10-08): anonymous counts per day, per maze level and
-- mode -- starts, clears, falls, quits, and the sum of clear times.
CREATE TABLE IF NOT EXISTS level_stats (
    day         TEXT NOT NULL,                 -- YYYY-MM-DD (UTC)
    level       TEXT NOT NULL,                 -- 'w1_01', or a daily maze id
    mode        TEXT NOT NULL,                 -- 'roll' | 'explore' | 'daily'
    metric      TEXT NOT NULL,                 -- 'starts' | 'clears' | 'falls' | 'quits' | 'clear_ms'
    n           BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (day, level, mode, metric)
);
-- Where each player has got to, from their synced save: so a stats page can
-- show the level players stop at.
ALTER TABLE players ADD COLUMN IF NOT EXISTS last_seen BIGINT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS furthest INTEGER;
ALTER TABLE players ADD COLUMN IF NOT EXISTS player_level INTEGER;
-- Player accounts (2026-10-08): a username and email with a password. The
-- player row stays the identity (saves, scores, tokens hang off it);
-- kind becomes 'account'.
CREATE TABLE IF NOT EXISTS accounts (
    player_id     TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    username      TEXT NOT NULL,
    username_key  TEXT NOT NULL UNIQUE,        -- lower case
    email         TEXT NOT NULL,
    email_key     TEXT NOT NULL UNIQUE,        -- lower case
    password_hash TEXT NOT NULL,
    verified      BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Emailed codes: confirming a new account ('verify', carrying the pending
-- account) or resetting a password ('reset'). Hashed; few tries; short life.
CREATE TABLE IF NOT EXISTS codes (
    email_key   TEXT NOT NULL,
    purpose     TEXT NOT NULL,
    code_hash   TEXT NOT NULL,
    expires_at  BIGINT NOT NULL,
    tries       INTEGER NOT NULL DEFAULT 0,
    payload     JSONB,
    PRIMARY KEY (email_key, purpose)
);
CREATE TABLE IF NOT EXISTS links (
    code        TEXT PRIMARY KEY,
    player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    expires_at  BIGINT NOT NULL
);
`;

export async function createPgStore(url) {
    // Hosted Postgres (Render, Neon, Supabase) wants TLS; a local one does not.
    const local = /localhost|127\.0\.0\.1/.test(url);
    const pool = new pg.Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 5 });
    await pool.query(SCHEMA);
    const one = async (q, v) => (await pool.query(q, v)).rows[0] || null;
    const row = r => r && { id: r.id, kind: r.kind, externalId: r.external_id, name: r.name };
    return {
        kind: 'postgres',
        async playerByToken(hash) {
            return row(await one('SELECT p.* FROM tokens t JOIN players p ON p.id = t.player_id WHERE t.token_hash = $1', [hash]));
        },
        async playerByExternal(kind, externalId) {
            return row(await one('SELECT * FROM players WHERE kind = $1 AND external_id = $2', [kind, externalId]));
        },
        async createPlayer({ id, kind, externalId = null, name }) {
            await pool.query('INSERT INTO players (id, kind, external_id, name) VALUES ($1, $2, $3, $4)', [id, kind, externalId, name]);
            return { id, kind, externalId, name };
        },
        async playerById(id) { return row(await one('SELECT * FROM players WHERE id = $1', [id])); },
        async renamePlayer(id, name) { await pool.query('UPDATE players SET name = $2 WHERE id = $1', [id, name]); },
        async addToken(playerId, hash) { await pool.query('INSERT INTO tokens (token_hash, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [hash, playerId]); },
        async getSave(playerId) {
            const r = await one('SELECT data, saved_at FROM saves WHERE player_id = $1', [playerId]);
            return r ? { data: r.data, savedAt: Number(r.saved_at) } : null;
        },
        async putSave(playerId, data, savedAt) {
            await pool.query(`INSERT INTO saves (player_id, data, saved_at, updated_at) VALUES ($1, $2, $3, now())
                ON CONFLICT (player_id) DO UPDATE SET data = EXCLUDED.data, saved_at = EXCLUDED.saved_at, updated_at = now()`, [playerId, data, savedAt]);
        },
        // Keeps the player's best (lowest) time on a board; returns it.
        async upsertScore(playerId, board, ms) {
            const r = await one(`INSERT INTO scores (player_id, board, ms) VALUES ($1, $2, $3)
                ON CONFLICT (player_id, board) DO UPDATE SET ms = LEAST(scores.ms, EXCLUDED.ms), updated_at = now()
                RETURNING ms`, [playerId, board, ms]);
            return r.ms;
        },
        async scoreOf(playerId, board) {
            const r = await one('SELECT ms FROM scores WHERE player_id = $1 AND board = $2', [playerId, board]);
            return r ? r.ms : null;
        },
        async scoresOf(playerId) {
            const { rows } = await pool.query('SELECT board, ms FROM scores WHERE player_id = $1', [playerId]);
            return rows.map(r => ({ board: r.board, ms: r.ms }));
        },
        async deleteScores(playerId) { await pool.query('DELETE FROM scores WHERE player_id = $1', [playerId]); },
        async top(board, limit) {
            const { rows } = await pool.query(`SELECT s.player_id, s.ms, p.name FROM scores s JOIN players p ON p.id = s.player_id
                WHERE s.board = $1 ORDER BY s.ms ASC, s.updated_at ASC LIMIT $2`, [board, limit]);
            return rows.map(r => ({ playerId: r.player_id, name: r.name, ms: r.ms }));
        },
        // 1 + how many players are strictly faster; and how many in all.
        async rank(board, ms) {
            const r = await one('SELECT COUNT(*) FILTER (WHERE ms < $2) AS faster, COUNT(*) AS total FROM scores WHERE board = $1', [board, ms]);
            return { rank: Number(r.faster) + 1, total: Number(r.total) };
        },
        // Tracking: add to the day's counters (rows: [{ level, mode, metric, n }]).
        async addStats(day, rows) {
            for (const r of rows) {
                await pool.query(`INSERT INTO level_stats (day, level, mode, metric, n) VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (day, level, mode, metric) DO UPDATE SET n = level_stats.n + EXCLUDED.n`, [day, r.level, r.mode, r.metric, r.n]);
            }
        },
        // Totals since `fromDay`: [{ level, mode, metric, n }].
        async statsSince(fromDay) {
            const { rows } = await pool.query('SELECT level, mode, metric, SUM(n)::BIGINT AS n FROM level_stats WHERE day >= $1 GROUP BY level, mode, metric', [fromDay]);
            return rows.map(r => ({ level: r.level, mode: r.mode, metric: r.metric, n: Number(r.n) }));
        },
        async touchPlayer(id, { lastSeen, furthest, playerLevel }) {
            await pool.query('UPDATE players SET last_seen = $2, furthest = COALESCE($3, furthest), player_level = COALESCE($4, player_level) WHERE id = $1',
                [id, lastSeen, furthest ?? null, playerLevel ?? null]);
        },
        // Every player with a known position: [{ furthest, playerLevel, lastSeen }].
        async playerPositions() {
            const { rows } = await pool.query('SELECT furthest, player_level, last_seen FROM players WHERE last_seen IS NOT NULL');
            return rows.map(r => ({ furthest: r.furthest || 0, playerLevel: r.player_level || 1, lastSeen: Number(r.last_seen) }));
        },
        // --- accounts ---
        async accountByKey(key) {
            const r = await one('SELECT * FROM accounts WHERE username_key = $1 OR email_key = $1', [key]);
            return r && { playerId: r.player_id, username: r.username, email: r.email, passwordHash: r.password_hash, verified: r.verified };
        },
        async accountOf(playerId) {
            const r = await one('SELECT * FROM accounts WHERE player_id = $1', [playerId]);
            return r && { playerId: r.player_id, username: r.username, email: r.email, passwordHash: r.password_hash, verified: r.verified };
        },
        async usernameTaken(key) { return !!(await one('SELECT 1 FROM accounts WHERE username_key = $1', [key])); },
        async emailTaken(key) { return !!(await one('SELECT 1 FROM accounts WHERE email_key = $1', [key])); },
        async createAccount({ playerId, username, email, passwordHash, verified }) {
            await pool.query(`INSERT INTO accounts (player_id, username, username_key, email, email_key, password_hash, verified)
                VALUES ($1, $2, $3, $4, $5, $6, $7)`, [playerId, username, username.toLowerCase(), email, email.toLowerCase(), passwordHash, !!verified]);
            await pool.query("UPDATE players SET kind = 'account', name = $2, external_id = NULL WHERE id = $1", [playerId, username]);
        },
        async setPassword(playerId, passwordHash) { await pool.query('UPDATE accounts SET password_hash = $2, verified = true WHERE player_id = $1', [playerId, passwordHash]); },
        async deletePlayer(playerId) { await pool.query('DELETE FROM players WHERE id = $1', [playerId]); },
        async deleteToken(hash) { await pool.query('DELETE FROM tokens WHERE token_hash = $1', [hash]); },
        async revokeTokens(playerId) { await pool.query('DELETE FROM tokens WHERE player_id = $1', [playerId]); },
        async putCode(emailKey, purpose, { codeHash, expiresAt, payload = null }) {
            await pool.query(`INSERT INTO codes (email_key, purpose, code_hash, expires_at, tries, payload) VALUES ($1, $2, $3, $4, 0, $5)
                ON CONFLICT (email_key, purpose) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, tries = 0, payload = EXCLUDED.payload`,
                [emailKey, purpose, codeHash, expiresAt, payload]);
        },
        async getCode(emailKey, purpose) {
            const r = await one('SELECT * FROM codes WHERE email_key = $1 AND purpose = $2', [emailKey, purpose]);
            return r && { codeHash: r.code_hash, expiresAt: Number(r.expires_at), tries: r.tries, payload: r.payload };
        },
        async bumpCode(emailKey, purpose) { await pool.query('UPDATE codes SET tries = tries + 1 WHERE email_key = $1 AND purpose = $2', [emailKey, purpose]); },
        async deleteCode(emailKey, purpose) { await pool.query('DELETE FROM codes WHERE email_key = $1 AND purpose = $2', [emailKey, purpose]); },
        async createLink(code, playerId, expiresAt) {
            await pool.query('DELETE FROM links WHERE expires_at < $1', [Date.now()]);
            await pool.query('INSERT INTO links (code, player_id, expires_at) VALUES ($1, $2, $3)', [code, playerId, expiresAt]);
        },
        // Single use: claiming deletes the code. Null if unknown or expired.
        async claimLink(code, now) {
            const r = await one('DELETE FROM links WHERE code = $1 RETURNING player_id, expires_at', [code]);
            return r && Number(r.expires_at) >= now ? r.player_id : null;
        },
        async close() { await pool.end(); }
    };
}

export function createMemoryStore() {
    const players = new Map(), tokens = new Map(), saves = new Map(), scores = new Map(), links = new Map(), stats = new Map();
    const accounts = new Map(), codes = new Map();
    const acct = a => a && { ...a };
    const key = (p, b) => p + '\u0000' + b;
    return {
        kind: 'memory',
        async playerByToken(hash) { const id = tokens.get(hash); return id ? { ...players.get(id) } : null; },
        async playerByExternal(kind, externalId) {
            for (const p of players.values()) if (p.kind === kind && p.externalId === externalId) return { ...p };
            return null;
        },
        async createPlayer({ id, kind, externalId = null, name }) { players.set(id, { id, kind, externalId, name }); return { id, kind, externalId, name }; },
        async playerById(id) { const p = players.get(id); return p ? { ...p } : null; },
        async renamePlayer(id, name) { const p = players.get(id); if (p) p.name = name; },
        async addToken(playerId, hash) { tokens.set(hash, playerId); },
        async getSave(playerId) { const s = saves.get(playerId); return s ? JSON.parse(JSON.stringify(s)) : null; },
        async putSave(playerId, data, savedAt) { saves.set(playerId, { data: JSON.parse(JSON.stringify(data)), savedAt }); },
        async upsertScore(playerId, board, ms) {
            const k = key(playerId, board), cur = scores.get(k);
            const best = cur ? Math.min(cur.ms, ms) : ms;
            scores.set(k, { playerId, board, ms: best, at: cur && cur.ms <= ms ? cur.at : Date.now() + Math.random() });
            return best;
        },
        async scoreOf(playerId, board) { const s = scores.get(key(playerId, board)); return s ? s.ms : null; },
        async scoresOf(playerId) { return [...scores.values()].filter(s => s.playerId === playerId).map(s => ({ board: s.board, ms: s.ms })); },
        async deleteScores(playerId) { for (const [k, s] of scores) if (s.playerId === playerId) scores.delete(k); },
        async top(board, limit) {
            return [...scores.values()].filter(s => s.board === board).sort((a, b) => a.ms - b.ms || a.at - b.at).slice(0, limit)
                .map(s => ({ playerId: s.playerId, name: players.get(s.playerId).name, ms: s.ms }));
        },
        async rank(board, ms) {
            const all = [...scores.values()].filter(s => s.board === board);
            return { rank: all.filter(s => s.ms < ms).length + 1, total: all.length };
        },
        async addStats(day, rows) {
            for (const r of rows) {
                const k = [day, r.level, r.mode, r.metric].join('\u0000');
                stats.set(k, (stats.get(k) || 0) + r.n);
            }
        },
        async statsSince(fromDay) {
            const sum = new Map();
            for (const [k, n] of stats) {
                const [day, level, mode, metric] = k.split('\u0000');
                if (day < fromDay) continue;
                const kk = [level, mode, metric].join('\u0000');
                sum.set(kk, (sum.get(kk) || 0) + n);
            }
            return [...sum].map(([k, n]) => { const [level, mode, metric] = k.split('\u0000'); return { level, mode, metric, n }; });
        },
        async touchPlayer(id, { lastSeen, furthest, playerLevel }) {
            const p = players.get(id);
            if (!p) return;
            p.lastSeen = lastSeen;
            if (furthest !== undefined && furthest !== null) p.furthest = furthest;
            if (playerLevel !== undefined && playerLevel !== null) p.playerLevel = playerLevel;
        },
        async playerPositions() {
            return [...players.values()].filter(p => p.lastSeen).map(p => ({ furthest: p.furthest || 0, playerLevel: p.playerLevel || 1, lastSeen: p.lastSeen }));
        },
        async accountByKey(key) { for (const a of accounts.values()) if (a.username.toLowerCase() === key || a.email.toLowerCase() === key) return acct(a); return null; },
        async accountOf(playerId) { return acct(accounts.get(playerId)) || null; },
        async usernameTaken(key) { return [...accounts.values()].some(a => a.username.toLowerCase() === key); },
        async emailTaken(key) { return [...accounts.values()].some(a => a.email.toLowerCase() === key); },
        async createAccount({ playerId, username, email, passwordHash, verified }) {
            accounts.set(playerId, { playerId, username, email, passwordHash, verified: !!verified });
            const p = players.get(playerId);
            if (p) { p.kind = 'account'; p.name = username; p.externalId = null; }
        },
        async setPassword(playerId, passwordHash) { const a = accounts.get(playerId); if (a) { a.passwordHash = passwordHash; a.verified = true; } },
        async deletePlayer(playerId) {
            players.delete(playerId); accounts.delete(playerId); saves.delete(playerId);
            for (const [h, id] of tokens) if (id === playerId) tokens.delete(h);
            for (const [k, s] of scores) if (s.playerId === playerId) scores.delete(k);
        },
        async deleteToken(hash) { tokens.delete(hash); },
        async revokeTokens(playerId) { for (const [h, id] of tokens) if (id === playerId) tokens.delete(h); },
        async putCode(emailKey, purpose, { codeHash, expiresAt, payload = null }) { codes.set(emailKey + '|' + purpose, { codeHash, expiresAt, tries: 0, payload: payload && JSON.parse(JSON.stringify(payload)) }); },
        async getCode(emailKey, purpose) { const c = codes.get(emailKey + '|' + purpose); return c ? { ...c } : null; },
        async bumpCode(emailKey, purpose) { const c = codes.get(emailKey + '|' + purpose); if (c) c.tries++; },
        async deleteCode(emailKey, purpose) { codes.delete(emailKey + '|' + purpose); },
        async createLink(code, playerId, expiresAt) { links.set(code, { playerId, expiresAt }); },
        async claimLink(code, now) {
            const l = links.get(code);
            links.delete(code);
            return l && l.expiresAt >= now ? l.playerId : null;
        },
        async close() {}
    };
}
