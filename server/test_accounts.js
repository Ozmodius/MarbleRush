// Player accounts (accounts.js, the /v1/account routes): registering with
// and without email, the code step, signing in by username or email, guest
// progress folding in, wrong-password limits, sign-out ending the session,
// password reset, deleting an account, and the name/password rules.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createMemoryStore, createPgStore } from './db.js';
import pg from 'pg';
import { freshProgress } from '../progressStore.js';
import { usernameProblem, passwordProblem, emailProblem, hashPassword, verifyPassword } from './accounts.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const levels = JSON.parse(fs.readFileSync(path.join(root, 'mazeLevels.json'), 'utf8')).levels;
let failed = 0, passed = 0;
const check = (cond, msg) => { if (cond) passed++; else { failed++; console.error('FAIL', msg); } };

// A mailer that keeps what it would have sent.
const outbox = [];
const mailer = { enabled: true, async send(m) { outbox.push(m); } };
const codeIn = m => (/(\d{6})/.exec(m.text) || [])[1];
let clock = Date.parse('2026-10-08T12:00:00Z');

// TEST_DATABASE_URL: the same against a real Postgres (its PlaneTilt tables
// are dropped first: point it at a throwaway database).
const pgUrl = process.env.TEST_DATABASE_URL;
async function freshStore() {
    if (!pgUrl) return createMemoryStore();
    const c = new pg.Client({ connectionString: pgUrl }); await c.connect();
    await c.query('DROP TABLE IF EXISTS codes, accounts, level_stats, links, scores, saves, tokens, players'); await c.end();
    return createPgStore(pgUrl);
}
const stores = [];
async function serve(opts) {
    const store = await freshStore();
    stores.push(store);
    const server = http.createServer(createApp({ store, levels, rateMax: 10000, now: () => clock, ...opts }));
    await new Promise(r => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (method, p, { token, body } = {}) => {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
        return { status: res.status, body: await res.json().catch(() => null) };
    };
    return { server, call };
}

// --- rules ---
check(usernameProblem('Marble_Fan') === null && usernameProblem('ab') === 'username-short' && usernameProblem('x'.repeat(17)) === 'username-long', 'usernames are 3-16 characters');
check(usernameProblem('bad name!') === 'username-chars' && usernameProblem('Guest-ABCD') === 'username-reserved', 'letters, numbers and _ . - only; Guest- names are the game\'s');
check(passwordProblem('short') === 'password-short' && passwordProblem('long enough') === null, 'passwords need 8 characters');
check(emailProblem('a@b.co') === null && emailProblem('nope') === 'email-bad', 'emails are checked');
const h = await hashPassword('correct horse');
check(/^scrypt\$/.test(h) && await verifyPassword('correct horse', h) && !(await verifyPassword('wrong horse', h)) && h !== await hashPassword('correct horse'), 'passwords are salted scrypt hashes that verify');

// --- with email ---
{
    const { server, call } = await serve({ mailer });
    // A guest with progress registers: the guest BECOMES the account.
    const g = (await call('POST', '/v1/session', { body: {} })).body;
    await call('PUT', '/v1/save', { token: g.token, body: { save: { ...freshProgress(), wallet: 300, highestIndex: 2, savedAt: 5, cleared: { w1_01: { bestMs: 9000, coins: 1 } } } } });
    await call('POST', '/v1/scores', { token: g.token, body: { board: `roll:${levels[0].id}`, ms: levels[0].minMs + 100 } });
    const bad = await call('POST', '/v1/account/register', { token: g.token, body: { username: 'x', email: 'a@b.co', password: 'longenough' } });
    check(bad.status === 400 && bad.body.error === 'username-short', 'a bad username is refused with its reason');
    const reg = await call('POST', '/v1/account/register', { token: g.token, body: { username: 'MarbleFan', email: 'Fan@Example.com', password: 'rolling-stone' } });
    check(reg.status === 200 && reg.body.verify && outbox.length === 1 && outbox[0].to === 'Fan@Example.com' && codeIn(outbox[0]), 'with email set up, registering sends a 6-digit code');
    check(!JSON.stringify(outbox[0]).includes('rolling-stone'), 'the password is never in the email');
    const wrong = await call('POST', '/v1/account/verify', { token: g.token, body: { email: 'fan@example.com', code: '000000' === codeIn(outbox[0]) ? '111111' : '000000' } });
    check(wrong.status === 400 && wrong.body.error === 'code-wrong', 'a wrong code is refused');
    const ver = await call('POST', '/v1/account/verify', { token: g.token, body: { email: 'fan@example.com', code: codeIn(outbox[0]) } });
    check(ver.status === 200 && ver.body.player.id === g.player.id && ver.body.player.kind === 'account' && ver.body.player.name === 'MarbleFan', 'the right code makes the account, and the guest is it');
    check(ver.body.save && ver.body.save.wallet === 300 && ver.body.save.cleared.w1_01 && ver.body.account.verified, 'the guest\'s save is the account\'s, email confirmed');
    check((await call('POST', '/v1/account/verify', { body: { email: 'fan@example.com', code: codeIn(outbox[0]) } })).status === 400, 'a code works once');
    const lb = await call('GET', `/v1/leaderboard?board=roll:${levels[0].id}`);
    check(lb.body.top[0].name === 'MarbleFan', 'its leaderboard times now show the username');
    const dupe = await call('POST', '/v1/account/register', { body: { username: 'marblefan', email: 'other@example.com', password: 'longenough' } });
    const dupe2 = await call('POST', '/v1/account/register', { body: { username: 'Another', email: 'FAN@example.com', password: 'longenough' } });
    check(dupe.body.error === 'username-taken' && dupe2.body.error === 'email-taken', 'usernames and emails are unique, whatever the case');

    // Codes: five guesses, then gone; and they expire.
    await call('POST', '/v1/account/register', { body: { username: 'Second', email: 'second@example.com', password: 'longenough' } });
    const sCode = codeIn(outbox[outbox.length - 1]), notIt = sCode === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) await call('POST', '/v1/account/verify', { body: { email: 'second@example.com', code: notIt } });
    check((await call('POST', '/v1/account/verify', { body: { email: 'second@example.com', code: sCode } })).body.error === 'code-tries', 'after five wrong guesses the code is dead');
    await call('POST', '/v1/account/register', { body: { username: 'Second', email: 'second@example.com', password: 'longenough' } });
    clock += 16 * 60e3;
    check((await call('POST', '/v1/account/verify', { body: { email: 'second@example.com', code: codeIn(outbox[outbox.length - 1]) } })).body.error === 'code-expired', 'a code expires after 15 minutes');
    clock -= 16 * 60e3;

    // Signing in on another device, by username or email: its guest folds in.
    const g2 = (await call('POST', '/v1/session', { body: {} })).body;
    await call('PUT', '/v1/save', { token: g2.token, body: { save: { ...freshProgress(), wallet: 5, savedAt: 9e12, cleared: { w1_02: { bestMs: 8000, coins: 0 } } } } });
    const no = await call('POST', '/v1/account/login', { token: g2.token, body: { login: 'MarbleFan', password: 'wrong-password' } });
    check(no.status === 401 && no.body.error === 'login-wrong', 'a wrong password is refused');
    const nouser = await call('POST', '/v1/account/login', { body: { login: 'nobody', password: 'whatever1' } });
    check(nouser.status === 401 && nouser.body.error === 'login-wrong', 'an unknown name gets the same answer (nothing given away)');
    const inn = await call('POST', '/v1/account/login', { token: g2.token, body: { login: 'FAN@EXAMPLE.COM', password: 'rolling-stone' } });
    check(inn.status === 200 && inn.body.player.id === g.player.id && inn.body.joined, 'signing in by email, any case, becomes the account');
    check(inn.body.save.cleared.w1_01 && inn.body.save.cleared.w1_02 && inn.body.save.wallet === 300, 'the device\'s clears join the account, the account keeps its coins');
    const byName = await call('POST', '/v1/account/login', { body: { login: 'marblefan', password: 'rolling-stone' } });
    check(byName.status === 200 && byName.body.player.id === g.player.id, 'and by username');
    const me = await call('GET', '/v1/account', { token: byName.body.token });
    check(me.body.account.username === 'MarbleFan' && me.body.account.email === 'Fan@Example.com' && me.body.email === true, 'the owner sees their account');

    // Sign out ends that session only.
    check((await call('POST', '/v1/account/logout', { token: byName.body.token })).status === 200, 'signing out works');
    check((await call('GET', '/v1/save', { token: byName.body.token })).status === 401 && (await call('GET', '/v1/save', { token: inn.body.token })).status === 200,
        'the signed-out token is dead on the server; other devices stay signed in');

    // Wrong-password limit.
    let last;
    for (let i = 0; i < 11; i++) last = await call('POST', '/v1/account/login', { body: { login: 'MarbleFan', password: 'guess-' + i } });
    check(last.status === 429 && last.body.error === 'too-many-tries', 'ten wrong passwords in 15 minutes and that login waits');
    clock += 16 * 60e3;
    check((await call('POST', '/v1/account/login', { body: { login: 'MarbleFan', password: 'rolling-stone' } })).status === 200, '15 minutes later it can try again');

    // Forgot password: a code, a new password, every old session ended.
    const before = outbox.length;
    const fq = await call('POST', '/v1/account/forgot', { body: { login: 'marblefan' } });
    const fqNone = await call('POST', '/v1/account/forgot', { body: { login: 'nobody@example.com' } });
    check(fq.body.ok && fqNone.body.ok && outbox.length === before + 1 && outbox[before].to === 'Fan@Example.com', 'forgot sends a code to the account\'s email, and says the same for unknown ones');
    const rs = await call('POST', '/v1/account/reset', { body: { login: 'marblefan', code: codeIn(outbox[before]), password: 'new-password-1' } });
    check(rs.status === 200 && rs.body.player.id === g.player.id, 'the code and a new password sign in');
    check((await call('GET', '/v1/save', { token: inn.body.token })).status === 401, 'resetting ends every other session');
    check((await call('POST', '/v1/account/login', { body: { login: 'marblefan', password: 'rolling-stone' } })).status === 401
        && (await call('POST', '/v1/account/login', { body: { login: 'marblefan', password: 'new-password-1' } })).status === 200, 'only the new password works');

    // Delete: needs the password; then everything is gone.
    check((await call('POST', '/v1/account/delete', { token: rs.body.token, body: { password: 'nope-nope' } })).status === 401, 'deleting needs the password');
    check((await call('POST', '/v1/account/delete', { token: rs.body.token, body: { password: 'new-password-1' } })).status === 200, 'deleting with it works');
    check((await call('POST', '/v1/account/login', { body: { login: 'marblefan', password: 'new-password-1' } })).status === 401
        && (await call('GET', `/v1/leaderboard?board=roll:${levels[0].id}`)).body.top.every(r => r.name !== 'MarbleFan')
        && (await call('POST', '/v1/account/register', { body: { username: 'MarbleFan', email: 'fan@example.com', password: 'longenough' } })).status === 200,
        'a deleted account is gone: no sign-in, off the boards, name and email free again');
    server.close();
}

// --- without email: made at once, no reset ---
{
    const { server, call } = await serve({});
    const reg = await call('POST', '/v1/account/register', { body: { username: 'NoMail', email: 'nomail@example.com', password: 'longenough' } });
    check(reg.status === 200 && reg.body.token && reg.body.player.kind === 'account' && reg.body.account.verified === false && reg.body.created, 'without email set up, the account is made at once');
    check((await call('POST', '/v1/account/forgot', { body: { login: 'NoMail' } })).body.error === 'email-off', 'and forgot-password says it is not available');
    // From a signed-in (account) device, registering makes a new player.
    const reg2 = await call('POST', '/v1/account/register', { token: reg.body.token, body: { username: 'Other1', email: 'o@example.com', password: 'longenough' } });
    check(reg2.status === 200 && reg2.body.player.id !== reg.body.player.id, 'an account is never turned into another account');
    server.close();
}

for (const st of stores) await st.close();
console.log(`accounts (${pgUrl ? 'postgres' : 'memory'}): ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
