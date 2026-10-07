# PlaneTilt API — cloud saves and leaderboards

A small Node server (no framework; `pg` and `jose` only) backed by Postgres.
The game works without it; with it, a player's progress follows them between
the web build, CrazyGames and their devices, and every level has a
leaderboard. Design notes are in `docs/PLAN.md` ("No server ... until").

## Deploy on Render

**Database:** New → Postgres (any plan). Copy its *Internal Database URL*.

**Web Service** (this repo):

| Setting | Value |
| --- | --- |
| Root Directory | *(leave blank: the repo root; the server reads the game's level files and save rules from there)* |
| Runtime | Node |
| Build Command | `npm ci --prefix server` |
| Start Command | `node server/index.js` |
| Health Check Path | `/health` |

Environment variables:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | the Postgres *Internal Database URL* |
| `NODE_VERSION` | `22` |
| `ALLOWED_ORIGINS` | optional; default `*`. To lock it down: `https://ozmodius.github.io,https://*.crazygames.com` |
| `CRAZYGAMES_PUBLIC_KEY_URL` | optional; default `https://sdk.crazygames.com/publicKey.json` |
| `RATE_LIMIT` | optional; requests per IP per minute, default 240 |

Tables are created on first start. Without `DATABASE_URL` the server runs on
an in-memory store (handy to try it; everything is lost on restart).

Check it: `https://<your-service>.onrender.com/health` → `{"ok":true,"store":"postgres"}`.

## Point the game at it

The URL is baked in at build time; unset, the game builds with no server.

- **Web (GitHub Pages):** repo Settings → Secrets and variables → Actions →
  Variables → `PLANETILT_API_URL` = `https://<your-service>.onrender.com`.
  The next push to main builds with it.
- **CrazyGames zip:** `PLANETILT_API_URL=https://<your-service>.onrender.com npm run build:crazygames`.
- **Dev page:** in the browser console,
  `localStorage.setItem('planetilt.api', 'http://localhost:8787')`.

Render's free web services sleep after 15 minutes idle and take ~30-60 s to
wake. The game never waits on the server (saves stay on the device and sync
when it answers), so that is a delay on the leaderboard, not on play.

## Endpoints

| | |
| --- | --- |
| `GET /health` | `{ ok, store }` |
| `POST /v1/session {token?, crazyToken?}` | `{ token, player }`: the same player for a known token, a new guest otherwise; a CrazyGames token signs into that account and folds the device's guest into it |
| `GET /v1/save` | `{ save }` |
| `PUT /v1/save {save}` | `{ save }`: the server's copy merged with this one (`mergeProgress`) |
| `POST /v1/scores {board, ms}` | `{ best, rank, total }` |
| `POST /v1/scores/batch {scores}` | `{ accepted }`: best times already in a save, sent once |
| `GET /v1/leaderboard?board=&limit=` | `{ top: [{rank, name, ms, you}], you, total }`; no token needed |
| `POST /v1/link` | `{ code, expiresAt }`: 6 letters, 10 minutes, one use |
| `POST /v1/link/claim {code}` | `{ token, player, save }`: this device becomes that player |

Boards are `roll:<levelId>`, `walk:<levelId>` and `daily:<YYYY-MM-DD>:<dailyId>`.
A time under the level's `minMs` (3× for a walk), over an hour, or a daily
more than a day from today is refused. Tokens are stored only as SHA-256
hashes; player ids never leave the server.

## Tests

```
npm ci --prefix server
npm test --prefix server                       # API + the game's sync client, in memory
TEST_DATABASE_URL=postgres://... npm test --prefix server   # the same against Postgres (drops its tables first!)
```

## Not checked from the build machine

CrazyGames' developer docs could not be reached from here. The token check
follows their documented shape (RS256 JWT, key served as `{ "publicKey": "<PEM>" }`,
payload `userId` and `username`). If sign-in fails in production, check the
current key URL in their SDK docs and set `CRAZYGAMES_PUBLIC_KEY_URL` (or
paste the key itself as `CRAZYGAMES_PUBLIC_KEY_PEM`). Guests sync either way.
