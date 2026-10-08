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
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | optional; email for account codes (port 465 by default). Without them, accounts are made with no emailed code and "Forgot password?" says it is not available |
| `ADMIN_TOKEN` | optional; a long random string of your choosing. Opens the stats page at `/admin`. Unset, the page is off |

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

## Accounts

On the web build, the Gear page's ACCOUNT card offers CREATE ACCOUNT and
SIGN IN (on CrazyGames, players sign in with CrazyGames instead):

- **Create:** username (3–16 letters, numbers, `_ . -`, unique, checked
  against a slur list), email (unique, never shown), password (8+). With
  email set up, a 6-digit code is emailed first (15 minutes, 5 guesses).
  The device's guest *becomes* the account, so nothing is lost.
- **Sign in:** username or email + password. The device's guest progress is
  added to the account (the account keeps its coins). 10 wrong passwords
  in 15 minutes and that login has to wait.
- **Forgot password** (needs email set up): a code to the account's email,
  then a new password; every other session is signed out.
- **Sign out** ends the session on the server; the device starts over as a
  new guest (the progress stays in the account).
- **Delete account:** password + typing DELETE; the account, its save and
  its leaderboard times are removed.

Passwords are salted scrypt hashes; codes and session tokens are stored
hashed. For email, any SMTP service works (e.g. a Gmail app password, Brevo,
Mailgun, SendGrid's SMTP).

## Stats page (play tracking)

Open `https://<your-service>.onrender.com/admin` and enter your `ADMIN_TOKEN`.

- **Retention:** players today (and how many are new), day-1 / day-7 /
  day-30 return rates, and a table of them by the day players started.
- **Activity:** players a day (new and returning), sessions and their
  average length, play time per player.
- **Funnel:** the share of players who have cleared 1, 2, 3, 5, 10 ... 50
  levels -- where the curve drops is where players leave.
- **Per maze level:** starts, clear rate, falls per attempt, quits, mean
  clear time against gold, the medal split (few golds = gold time too
  tight), coins found, what ends runs (holes, icicles, flares, molten gates,
  rails, crushers) and the deadliest hole, ad revives, and how many players
  **stopped there** (furthest clear is the level before, not seen for 7 days
  or whatever you pick). The row where most players stop is highlighted.
- **What players do:** purchases by item, power-ups and prizes used,
  rewards claimed (daily, missions, achievements), rewarded ads watched,
  level-ups, leaderboard opens, account sign-ups and sign-ins.
- Explore mode, daily mazes and the spread of player levels.

Tracking is anonymous: the server keeps daily totals (per level, and per
action), which days each player played (for return rates), and each
player's furthest level and player level (from their synced save). Nothing
is sent when the game is built without a server.

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
| `POST /v1/events {events}` | `{ accepted }`: play tracking -- runs `{type: start/clear/fall/quit/revive/shield, level, mode, ms?, tier?, coins?, coinsOf?, cause?, hole?}`, `{type: 'act', name}`, `{type: 'session', ms}` |
| `GET /v1/admin/stats?days=&idle=` | the stats page's data; `Authorization: Bearer <ADMIN_TOKEN>` |
| `GET /v1/account` | `{ player, account, email }` (email: whether codes can be sent) |
| `POST /v1/account/register {username, email, password}` | a session, or `{ verify: true, email }` when a code was emailed |
| `POST /v1/account/verify {email, code}` | a session |
| `POST /v1/account/login {login, password}` | a session (`login`: username or email) |
| `POST /v1/account/logout` | ends this token |
| `POST /v1/account/forgot {login}` | `{ ok }`, emails a reset code if the account exists |
| `POST /v1/account/reset {login, code, password}` | a session; other sessions end |
| `POST /v1/account/delete {password}` | deletes the account and everything of it |
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
