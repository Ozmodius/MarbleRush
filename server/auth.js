// WHO IS CALLING. Two kinds of player:
//   guest       the server makes one up and hands back a random bearer token
//               the device keeps (web build, or CrazyGames when logged out);
//   crazygames  a CrazyGames account, proven by the user token the SDK gives
//               (platform.getPlatformUserToken): a JWT signed RS256 by
//               CrazyGames, checked here against their public key.
//
// Per CrazyGames' SDK docs the key is served as JSON { publicKey: "<PEM>" }
// and the token's payload carries userId and username. Both the URL and the
// key itself can be set by env (CRAZYGAMES_PUBLIC_KEY_URL / _PEM) in case
// they move; tests hand in their own key.

import crypto from 'node:crypto';
import { importSPKI, jwtVerify } from 'jose';

export const DEFAULT_KEY_URL = 'https://sdk.crazygames.com/publicKey.json';

export const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const newId = () => crypto.randomUUID();

// Link codes: no 0/O/1/I/L, so they survive being read off one screen and
// typed into another.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newLinkCode() {
    let s = '';
    for (const b of crypto.randomBytes(6)) s += CODE_CHARS[b % CODE_CHARS.length];
    return s;
}
export const cleanLinkCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

export function guestName() {
    const n = crypto.randomInt(0, 36 ** 4).toString(36).toUpperCase().padStart(4, '0');
    return `Guest-${n}`;
}

// Leaderboard names: printable, short, never empty.
export function cleanName(name, fallback = 'Player') {
    const s = String(name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 24);
    return s || fallback;
}

// createCrazyVerifier({ pem?, keyUrl?, fetchImpl? }) -> async verify(token)
// -> { userId, username }; throws on a bad token. The key is fetched once and
// kept (refetched after an hour, or after a failure).
export function createCrazyVerifier({ pem = null, keyUrl = DEFAULT_KEY_URL, fetchImpl = globalThis.fetch } = {}) {
    let key = null, keyAt = 0;
    const getKey = async () => {
        if (key && (pem || Date.now() - keyAt < 3600e3)) return key;
        let text = pem;
        if (!text) {
            const res = await fetchImpl(keyUrl);
            if (!res.ok) throw new Error(`public key fetch ${res.status}`);
            const body = await res.text();
            try { text = JSON.parse(body).publicKey; } catch (_) { text = body; }
        }
        if (!text || !/BEGIN PUBLIC KEY/.test(text)) throw new Error('no public key');
        key = await importSPKI(text.trim(), 'RS256');
        keyAt = Date.now();
        return key;
    };
    return async function verify(token) {
        let k;
        try { k = await getKey(); } catch (e) { key = null; throw e; }
        const { payload } = await jwtVerify(String(token), k, { algorithms: ['RS256'] });
        const userId = payload.userId ?? payload.sub;
        if (userId === undefined || userId === null || userId === '') throw new Error('token has no user');
        return { userId: String(userId), username: payload.username ? String(payload.username) : null };
    };
}
