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
-- Retention: the day a player was first seen, and each day they played.
ALTER TABLE players ADD COLUMN IF NOT EXISTS first_day TEXT;
CREATE TABLE IF NOT EXISTS player_days (
    player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    day         TEXT NOT NULL,
    PRIMARY KEY (player_id, day)
);
-- Everything else counted per day: purchases, claims, ads, sessions
-- ('sessions', 'session_ms'), ...
CREATE TABLE IF NOT EXISTS event_stats (
    day         TEXT NOT NULL,
    name        TEXT NOT NULL,
    n           BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (day, name)
);
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
-- The platform (2026-10-11, for the admin page): 'web' | 'crazygames'. A
-- player keeps the last one it played on (null before it was recorded); the
-- play counts, event counts and days played carry it ('unknown' for what
-- came before), as part of the counts' keys. Idempotent, from any state.
ALTER TABLE players ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE level_stats ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE event_stats ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE player_days ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'unknown';
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
                   WHERE i.indrelid = 'level_stats'::regclass AND i.indisprimary AND a.attname = 'platform') THEN
        ALTER TABLE level_stats DROP CONSTRAINT IF EXISTS level_stats_pkey;
        ALTER TABLE level_stats ADD PRIMARY KEY (day, level, mode, metric, platform);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
                   WHERE i.indrelid = 'event_stats'::regclass AND i.indisprimary AND a.attname = 'platform') THEN
        ALTER TABLE event_stats DROP CONSTRAINT IF EXISTS event_stats_pkey;
        ALTER TABLE event_stats ADD PRIMARY KEY (day, name, platform);
    END IF;
END $$;
`;

// ONE-TIME WIPES (the user's calls). Each runs once, in one transaction, and
// is recorded in `wipes`, so no restart or redeploy ever repeats it. What it
// deletes is first copied into backup tables named after it.
//   alpha_2026_10_11  The Crew (alpha): every player starts over. Saves and
//                     leaderboard times go; accounts, players, sign-in tokens
//                     and the play stats stay. The game's SAVE_VERSION went to
//                     2 at the same time, so a device's own old save loads
//                     fresh too and cannot merge back up.
//   harder_2026_10_13  The harder ladder: all 50 levels were regenerated, so
//                     old clears and times belong to levels that are gone.
//                     The same wipe as alpha's (saves, leaderboard times, a
//                     player's furthest and level), with SAVE_VERSION 3.
//   platform_2026_10_11  Not a wipe, and deletes nothing: the platform
//                     columns (SCHEMA) start empty, so the players who signed
//                     in with CrazyGames, and their days played, are marked
//                     'crazygames' once.
export const WIPES = [
    {
        id: 'alpha_2026_10_11',
        sql: `CREATE TABLE IF NOT EXISTS wipe_alpha_2026_10_11_saves AS SELECT * FROM saves;
              CREATE TABLE IF NOT EXISTS wipe_alpha_2026_10_11_scores AS SELECT * FROM scores;
              DELETE FROM saves;
              DELETE FROM scores;
              UPDATE players SET furthest = NULL, player_level = NULL;`
    },
    {
        id: 'platform_2026_10_11',
        sql: `UPDATE players SET platform = 'crazygames' WHERE kind = 'crazygames' AND platform IS NULL;
              UPDATE player_days d SET platform = 'crazygames' FROM players p WHERE p.id = d.player_id AND p.kind = 'crazygames';`
    },
    {
        id: 'harder_2026_10_13',
        sql: `CREATE TABLE IF NOT EXISTS wipe_harder_2026_10_13_saves AS SELECT * FROM saves;
              CREATE TABLE IF NOT EXISTS wipe_harder_2026_10_13_scores AS SELECT * FROM scores;
              DELETE FROM saves;
              DELETE FROM scores;
              UPDATE players SET furthest = NULL, player_level = NULL;`
    }
];
export const PLATFORMS = ['web', 'crazygames'];
// A platform filter: 'web' | 'crazygames', or null for all.
export const platformOf = (v) => (PLATFORMS.includes(v) ? v : null);
export async function runWipes(pool, wipes = WIPES) {
    await pool.query('CREATE TABLE IF NOT EXISTS wipes (id TEXT PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const done = [];
    for (const w of wipes) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const r = await client.query('INSERT INTO wipes (id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id', [w.id]);
            if (r.rows.length) await client.query(w.sql);
            await client.query('COMMIT');
            if (r.rows.length) { done.push(w.id); console.log('[db] wipe ' + w.id + ' done'); }
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            throw e;
        } finally {
            client.release();
        }
    }
    return done;
}

// An admin page row from a players/accounts/saves join.
function adminRow(r) {
    return {
        id: r.id, kind: r.kind, name: r.name, platform: r.platform || null, externalId: r.external_id || null,
        createdAt: r.created_at ? new Date(r.created_at).getTime() : null, firstDay: r.first_day || null,
        lastSeen: r.last_seen ? Number(r.last_seen) : null, furthest: r.furthest || 0, playerLevel: r.player_level || null,
        account: r.username ? { username: r.username, email: r.email, verified: !!r.verified } : null,
        wallet: r.wallet === null || r.wallet === undefined ? null : Number(r.wallet), xp: r.xp === null || r.xp === undefined ? null : Number(r.xp),
        saveAt: r.save_at ? new Date(r.save_at).getTime() : null, scores: Number(r.scores || 0)
    };
}

export async function createPgStore(url) {
    // Hosted Postgres (Render, Neon, Supabase) wants TLS; a local one does not.
    const local = /localhost|127\.0\.0\.1/.test(url);
    const pool = new pg.Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 5 });
    await pool.query(SCHEMA);
    await runWipes(pool);
    const one = async (q, v) => (await pool.query(q, v)).rows[0] || null;
    const row = r => r && { id: r.id, kind: r.kind, externalId: r.external_id, name: r.name, platform: r.platform || null };
    return {
        kind: 'postgres',
        async playerByToken(hash) {
            return row(await one('SELECT p.* FROM tokens t JOIN players p ON p.id = t.player_id WHERE t.token_hash = $1', [hash]));
        },
        async playerByExternal(kind, externalId) {
            return row(await one('SELECT * FROM players WHERE kind = $1 AND external_id = $2', [kind, externalId]));
        },
        async createPlayer({ id, kind, externalId = null, name, platform = null }) {
            await pool.query('INSERT INTO players (id, kind, external_id, name, platform) VALUES ($1, $2, $3, $4, $5)', [id, kind, externalId, name, platform]);
            return { id, kind, externalId, name, platform };
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
        // Tracking: add to the day's counters (rows: [{ level, mode, metric, n }])
        // for a platform ('web' | 'crazygames' | 'unknown').
        async addStats(day, rows, platform = 'unknown') {
            for (const r of rows) {
                await pool.query(`INSERT INTO level_stats (day, level, mode, metric, n, platform) VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (day, level, mode, metric, platform) DO UPDATE SET n = level_stats.n + EXCLUDED.n`, [day, r.level, r.mode, r.metric, r.n, platform]);
            }
        },
        // Totals since `fromDay`, on one platform or (null) all: [{ level, mode, metric, n }].
        async statsSince(fromDay, platform = null) {
            const { rows } = await pool.query('SELECT level, mode, metric, SUM(n)::BIGINT AS n FROM level_stats WHERE day >= $1 AND ($2::TEXT IS NULL OR platform = $2) GROUP BY level, mode, metric', [fromDay, platform]);
            return rows.map(r => ({ level: r.level, mode: r.mode, metric: r.metric, n: Number(r.n) }));
        },
        // A platform given is where the player is playing now.
        async touchPlayer(id, { lastSeen, furthest, playerLevel, day, platform }) {
            await pool.query('UPDATE players SET last_seen = $2, furthest = COALESCE($3, furthest), player_level = COALESCE($4, player_level), first_day = COALESCE(first_day, $5), platform = COALESCE($6, platform) WHERE id = $1',
                [id, lastSeen, furthest ?? null, playerLevel ?? null, day ?? null, platform ?? null]);
            if (day) await pool.query(`INSERT INTO player_days (player_id, day, platform) SELECT $1, $2, COALESCE($3, p.platform, 'unknown') FROM players p WHERE p.id = $1
                ON CONFLICT (player_id, day) DO UPDATE SET platform = CASE WHEN player_days.platform = 'unknown' THEN EXCLUDED.platform ELSE player_days.platform END`, [id, day, platform ?? null]);
        },
        async addEvents(day, rows, platform = 'unknown') {
            for (const r of rows) {
                await pool.query(`INSERT INTO event_stats (day, name, n, platform) VALUES ($1, $2, $3, $4)
                    ON CONFLICT (day, name, platform) DO UPDATE SET n = event_stats.n + EXCLUDED.n`, [day, r.name, r.n, platform]);
            }
        },
        // [{ day, name, n }] since fromDay, day by day.
        async eventsSince(fromDay, platform = null) {
            const { rows } = await pool.query('SELECT day, name, SUM(n)::BIGINT AS n FROM event_stats WHERE day >= $1 AND ($2::TEXT IS NULL OR platform = $2) GROUP BY day, name', [fromDay, platform]);
            return rows.map(r => ({ day: r.day, name: r.name, n: Number(r.n) }));
        },
        // Players active each day: [{ day, n }].
        async activeByDay(fromDay, platform = null) {
            const { rows } = await pool.query('SELECT day, COUNT(*) AS n FROM player_days WHERE day >= $1 AND ($2::TEXT IS NULL OR platform = $2) GROUP BY day', [fromDay, platform]);
            return rows.map(r => ({ day: r.day, n: Number(r.n) }));
        },
        // For retention: players first seen since fromDay, by first day, and
        // on which days they came back: [{ firstDay, day, n }].
        async cohorts(fromDay, platform = null) {
            const { rows } = await pool.query(`SELECT p.first_day, d.day, COUNT(*) AS n FROM players p JOIN player_days d ON d.player_id = p.id
                WHERE p.first_day >= $1 AND ($2::TEXT IS NULL OR p.platform = $2) GROUP BY p.first_day, d.day`, [fromDay, platform]);
            return rows.map(r => ({ firstDay: r.first_day, day: r.day, n: Number(r.n) }));
        },
        // Every player with a known position: [{ furthest, playerLevel, lastSeen }].
        async playerPositions(platform = null) {
            const { rows } = await pool.query('SELECT furthest, player_level, last_seen FROM players WHERE last_seen IS NOT NULL AND ($1::TEXT IS NULL OR platform = $1)', [platform]);
            return rows.map(r => ({ furthest: r.furthest || 0, playerLevel: r.player_level || 1, lastSeen: Number(r.last_seen) }));
        },
        // How many players there are by platform and kind: [{ platform, kind, n }].
        async playerCounts() {
            const { rows } = await pool.query("SELECT COALESCE(platform, 'unknown') AS platform, kind, COUNT(*) AS n FROM players GROUP BY 1, 2");
            return rows.map(r => ({ platform: r.platform, kind: r.kind, n: Number(r.n) }));
        },
        // --- admin: players ---
        // A page of players, newest seen first (or by `sort`), matching `q`
        // (name, username, email or id, any part, any case), on a platform
        // and of a kind. -> { total, players: [summary] }.
        async adminPlayers({ q = '', platform = null, kind = null, sort = 'seen', limit = 50, offset = 0 }) {
            const order = { seen: 'p.last_seen DESC NULLS LAST', created: 'p.created_at DESC', furthest: 'p.furthest DESC NULLS LAST', name: 'lower(p.name) ASC' }[sort] || 'p.last_seen DESC NULLS LAST';
            const where = `($1::TEXT = '' OR p.name ILIKE $1 OR p.id ILIKE $1 OR a.username ILIKE $1 OR a.email ILIKE $1)
                AND ($2::TEXT IS NULL OR p.platform = $2) AND ($3::TEXT IS NULL OR p.kind = $3)`;
            const like = q ? '%' + String(q).replace(/[\\%_]/g, m => '\\' + m) + '%' : '';
            const total = await one(`SELECT COUNT(*) AS n FROM players p LEFT JOIN accounts a ON a.player_id = p.id WHERE ${where}`, [like, platform, kind]);
            const { rows } = await pool.query(`SELECT p.*, a.username, a.email, a.verified,
                    (s.data->>'wallet')::BIGINT AS wallet, (s.data->>'xp')::BIGINT AS xp, s.updated_at AS save_at,
                    (SELECT COUNT(*) FROM scores sc WHERE sc.player_id = p.id) AS scores
                FROM players p LEFT JOIN accounts a ON a.player_id = p.id LEFT JOIN saves s ON s.player_id = p.id
                WHERE ${where} ORDER BY ${order}, p.id LIMIT $4 OFFSET $5`, [like, platform, kind, limit, offset]);
            return { total: Number(total.n), players: rows.map(adminRow) };
        },
        async adminPlayer(id) {
            const r = await one(`SELECT p.*, a.username, a.email, a.verified, a.created_at AS account_at,
                    (s.data->>'wallet')::BIGINT AS wallet, (s.data->>'xp')::BIGINT AS xp, s.updated_at AS save_at,
                    (SELECT COUNT(*) FROM scores sc WHERE sc.player_id = p.id) AS scores,
                    (SELECT COUNT(*) FROM tokens t WHERE t.player_id = p.id) AS sessions,
                    (SELECT COUNT(*) FROM player_days d WHERE d.player_id = p.id) AS days_played
                FROM players p LEFT JOIN accounts a ON a.player_id = p.id LEFT JOIN saves s ON s.player_id = p.id WHERE p.id = $1`, [id]);
            return r ? { ...adminRow(r), accountAt: r.account_at ? new Date(r.account_at).getTime() : null, sessions: Number(r.sessions), daysPlayed: Number(r.days_played) } : null;
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
    const accounts = new Map(), codes = new Map(), events = new Map();
    const acct = a => a && { ...a };
    const key = (p, b) => p + '\u0000' + b;
    const memAdminRow = (p) => {
        const a = accounts.get(p.id), s = saves.get(p.id);
        return {
            id: p.id, kind: p.kind, name: p.name, platform: p.platform || null, externalId: p.externalId || null,
            createdAt: p.createdAt || null, firstDay: p.firstDay || null, lastSeen: p.lastSeen || null, furthest: p.furthest || 0, playerLevel: p.playerLevel || null,
            account: a ? { username: a.username, email: a.email, verified: !!a.verified } : null,
            wallet: s && Number.isFinite(s.data.wallet) ? s.data.wallet : null, xp: s && Number.isFinite(s.data.xp) ? s.data.xp : null,
            saveAt: s ? (s.at || null) : null, scores: [...scores.values()].filter(x => x.playerId === p.id).length
        };
    };
    return {
        kind: 'memory',
        async playerByToken(hash) { const id = tokens.get(hash); return id ? { ...players.get(id) } : null; },
        async playerByExternal(kind, externalId) {
            for (const p of players.values()) if (p.kind === kind && p.externalId === externalId) return { ...p };
            return null;
        },
        async createPlayer({ id, kind, externalId = null, name, platform = null }) { players.set(id, { id, kind, externalId, name, platform, createdAt: Date.now() }); return { id, kind, externalId, name, platform }; },
        async playerById(id) { const p = players.get(id); return p ? { ...p } : null; },
        async renamePlayer(id, name) { const p = players.get(id); if (p) p.name = name; },
        async addToken(playerId, hash) { tokens.set(hash, playerId); },
        async getSave(playerId) { const s = saves.get(playerId); return s ? JSON.parse(JSON.stringify(s)) : null; },
        async putSave(playerId, data, savedAt) { saves.set(playerId, { data: JSON.parse(JSON.stringify(data)), savedAt, at: Date.now() }); },
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
        async addStats(day, rows, platform = 'unknown') {
            for (const r of rows) {
                const k = [day, r.level, r.mode, r.metric, platform].join('\u0000');
                stats.set(k, (stats.get(k) || 0) + r.n);
            }
        },
        async statsSince(fromDay, platform = null) {
            const sum = new Map();
            for (const [k, n] of stats) {
                const [day, level, mode, metric, pf] = k.split('\u0000');
                if (day < fromDay || (platform && pf !== platform)) continue;
                const kk = [level, mode, metric].join('\u0000');
                sum.set(kk, (sum.get(kk) || 0) + n);
            }
            return [...sum].map(([k, n]) => { const [level, mode, metric] = k.split('\u0000'); return { level, mode, metric, n }; });
        },
        async touchPlayer(id, { lastSeen, furthest, playerLevel, day, platform }) {
            const p = players.get(id);
            if (!p) return;
            p.lastSeen = lastSeen;
            if (platform) p.platform = platform;
            if (day) {
                if (!p.firstDay) p.firstDay = day;
                p.days = p.days || new Map();
                const was = p.days.get(day);
                if (!was || was === 'unknown') p.days.set(day, platform || p.platform || 'unknown');
            }
            if (furthest !== undefined && furthest !== null) p.furthest = furthest;
            if (playerLevel !== undefined && playerLevel !== null) p.playerLevel = playerLevel;
        },
        async addEvents(day, rows, platform = 'unknown') { for (const r of rows) { const k = [day, r.name, platform].join('\u0000'); events.set(k, (events.get(k) || 0) + r.n); } },
        async eventsSince(fromDay, platform = null) {
            const sum = new Map();
            for (const [k, n] of events) {
                const [day, name, pf] = k.split('\u0000');
                if (day < fromDay || (platform && pf !== platform)) continue;
                const kk = day + '\u0000' + name;
                sum.set(kk, (sum.get(kk) || 0) + n);
            }
            return [...sum].map(([k, n]) => { const [day, name] = k.split('\u0000'); return { day, name, n }; });
        },
        async activeByDay(fromDay, platform = null) {
            const by = new Map();
            for (const p of players.values()) for (const [d, pf] of p.days || []) if (d >= fromDay && (!platform || pf === platform)) by.set(d, (by.get(d) || 0) + 1);
            return [...by].map(([day, n]) => ({ day, n }));
        },
        async cohorts(fromDay, platform = null) {
            const by = new Map();
            for (const p of players.values()) {
                if (!p.firstDay || p.firstDay < fromDay || (platform && p.platform !== platform)) continue;
                for (const d of (p.days || new Map()).keys()) { const k = p.firstDay + '|' + d; by.set(k, (by.get(k) || 0) + 1); }
            }
            return [...by].map(([k, n]) => { const [firstDay, day] = k.split('|'); return { firstDay, day, n }; });
        },
        async playerPositions(platform = null) {
            return [...players.values()].filter(p => p.lastSeen && (!platform || p.platform === platform)).map(p => ({ furthest: p.furthest || 0, playerLevel: p.playerLevel || 1, lastSeen: p.lastSeen }));
        },
        async playerCounts() {
            const by = new Map();
            for (const p of players.values()) { const k = (p.platform || 'unknown') + '|' + p.kind; by.set(k, (by.get(k) || 0) + 1); }
            return [...by].map(([k, n]) => { const [platform, kind] = k.split('|'); return { platform, kind, n }; });
        },
        // --- admin: players (as the Postgres store) ---
        async adminPlayers({ q = '', platform = null, kind = null, sort = 'seen', limit = 50, offset = 0 }) {
            const ql = String(q || '').toLowerCase();
            const all = [...players.values()].map(p => memAdminRow(p)).filter(r =>
                (!ql || [r.name, r.id, r.account && r.account.username, r.account && r.account.email].some(v => v && String(v).toLowerCase().includes(ql)))
                && (!platform || r.platform === platform) && (!kind || r.kind === kind));
            const desc = (k) => (a, b) => (b[k] ?? -Infinity) - (a[k] ?? -Infinity);
            const cmp = { seen: desc('lastSeen'), created: desc('createdAt'), furthest: desc('furthest'), name: (a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1 }[sort] || desc('lastSeen');
            all.sort((a, b) => cmp(a, b) || (a.id < b.id ? -1 : 1));
            return { total: all.length, players: all.slice(offset, offset + limit) };
        },
        async adminPlayer(id) {
            const p = players.get(id);
            if (!p) return null;
            const a = accounts.get(id);
            return { ...memAdminRow(p), accountAt: a ? (a.createdAt || null) : null, sessions: [...tokens.values()].filter(t => t === id).length, daysPlayed: p.days ? p.days.size : 0 };
        },
        async accountByKey(key) { for (const a of accounts.values()) if (a.username.toLowerCase() === key || a.email.toLowerCase() === key) return acct(a); return null; },
        async accountOf(playerId) { return acct(accounts.get(playerId)) || null; },
        async usernameTaken(key) { return [...accounts.values()].some(a => a.username.toLowerCase() === key); },
        async emailTaken(key) { return [...accounts.values()].some(a => a.email.toLowerCase() === key); },
        async createAccount({ playerId, username, email, passwordHash, verified }) {
            accounts.set(playerId, { playerId, username, email, passwordHash, verified: !!verified, createdAt: Date.now() });
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
