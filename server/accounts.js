// PLAYER ACCOUNTS: the rules and tools behind the /v1/account routes (app.js).
// Modelled on 3dBallSmack's login (username or email + password, a 6-digit
// code emailed to confirm the address), without its Google sign-in, and with
// the gaps it has closed: passwords have a minimum, guesses are limited,
// codes expire, signing out ends the session on the server, usernames are
// checked, and a forgotten password can be reset by email.
//
// Passwords: scrypt (node:crypto; no extra dependency), a random 16-byte
// salt each, stored as "scrypt$N$r$p$salt$hash". Codes: 6 digits from the
// crypto RNG, stored hashed, 15 minutes, 5 guesses.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const PASSWORD_MIN = 8;
export const CODE_TTL_MS = 15 * 60 * 1000;
export const CODE_TRIES = 5;

const scrypt = (password, salt, { N, r, p, keylen }) => new Promise((resolve, reject) =>
    crypto.scrypt(String(password).normalize('NFKC'), salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))));

export async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const key = await scrypt(password, salt, SCRYPT);
    return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, N, r, p, salt, hash] = parts;
    const want = Buffer.from(hash, 'base64');
    const got = await scrypt(password, Buffer.from(salt, 'base64'), { N: +N, r: +r, p: +p, keylen: want.length });
    return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export const newCode = () => String(crypto.randomInt(0, 1e6)).padStart(6, '0');
export const hashCode = c => crypto.createHash('sha256').update('code:' + String(c)).digest('hex');

// --- names, emails, passwords ---------------------------------------------------
const here = path.dirname(fileURLToPath(import.meta.url));
const SLURS = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(here, 'profanity.json'), 'utf8')).slurs || []; } catch (_) { return []; }
})();
// Look-alike letters, so "sh1t"-style spellings are caught too.
const LEET = { a: 'a4@', e: 'e3', i: 'i1!', o: 'o0', s: 's$5', t: 't7', l: 'l1' };
const SLUR_RE = SLURS.length ? new RegExp(SLURS.map(w => [...w.toLowerCase()].map(ch => (LEET[ch] ? `[${LEET[ch].replace(/[$!@]/g, m => '\\' + m)}]` : ch.replace(/[^a-z0-9]/g, '\\$&'))).join('[^a-z0-9]*')).join('|'), 'i') : null;

export function usernameProblem(name) {
    const n = String(name || '').trim();
    if (n.length < 3) return 'username-short';
    if (n.length > 16) return 'username-long';
    if (!/^[A-Za-z0-9_.-]+$/.test(n)) return 'username-chars';
    if (/^guest[-_.]?/i.test(n)) return 'username-reserved';
    if (SLUR_RE && SLUR_RE.test(n)) return 'username-rude';
    return null;
}
export function emailProblem(email) {
    const e = String(email || '').trim();
    return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? null : 'email-bad';
}
export function passwordProblem(password) {
    const p = String(password || '');
    if (p.length < PASSWORD_MIN) return 'password-short';
    if (p.length > 200) return 'password-long';
    return null;
}

// --- email --------------------------------------------------------------------------
// createMailer(env) -> { enabled, send({ to, subject, text, html }) }. Needs
// SMTP_HOST, SMTP_USER and SMTP_PASS (SMTP_PORT 465 by default, SMTP_FROM
// optional). Without them `enabled` is false: accounts are made without an
// emailed code, and "forgot password" says it is not available.
export async function createMailer(env = {}) {
    if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return { enabled: false, async send() { throw new Error('email is not set up'); } };
    const nodemailer = (await import('nodemailer')).default;
    const port = Number(env.SMTP_PORT) || 465;
    const t = nodemailer.createTransport({ host: env.SMTP_HOST, port, secure: port === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } });
    const from = env.SMTP_FROM || `"PlaneTilt" <${env.SMTP_USER}>`;
    return { enabled: true, async send(msg) { await t.sendMail({ from, ...msg }); } };
}

export function codeEmail(code, purpose) {
    const what = purpose === 'reset' ? 'reset your PlaneTilt password' : 'finish creating your PlaneTilt account';
    return {
        subject: purpose === 'reset' ? `${code} is your PlaneTilt reset code` : `${code} is your PlaneTilt code`,
        text: `Your code to ${what} is: ${code}\n\nIt works for 15 minutes. If you did not ask for it, you can ignore this email.`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:420px">
<p>Your code to ${what} is:</p>
<p style="font-size:32px;font-weight:800;letter-spacing:8px;margin:16px 0">${code}</p>
<p style="color:#666">It works for 15 minutes. If you did not ask for it, you can ignore this email.</p></div>`
    };
}
