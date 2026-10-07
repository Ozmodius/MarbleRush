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
    const players = new Map(), tokens = new Map(), saves = new Map(), scores = new Map(), links = new Map();
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
        async createLink(code, playerId, expiresAt) { links.set(code, { playerId, expiresAt }); },
        async claimLink(code, now) {
            const l = links.get(code);
            links.delete(code);
            return l && l.expiresAt >= now ? l.playerId : null;
        },
        async close() {}
    };
}
