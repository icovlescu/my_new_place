const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64urlEncode = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const b64urlDecode = (str) => {
  const s = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Signed session value: base64url(json).base64url(hmac). */
export async function signSession(payload, secret) {
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifySession(value, secret, now = Date.now()) {
  if (!value || !secret) return null;
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlDecode(sig), enc.encode(body));
  if (!ok) return null;
  try {
    const p = JSON.parse(dec.decode(b64urlDecode(body)));
    return p.exp && p.exp > now ? p : null;
  } catch { return null; }
}

/**
 * Verify a Google Sign-In ID token (RS256 JWT) against Google's published keys.
 * jwks = { keys: [JWK, ...] } from https://www.googleapis.com/oauth2/v3/certs
 */
export async function verifyGoogleIdToken(idToken, { clientId, jwks, now = Date.now() }) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const header = JSON.parse(dec.decode(b64urlDecode(parts[0])));
  const claims = JSON.parse(dec.decode(b64urlDecode(parts[1])));
  if (header.alg !== 'RS256') throw new Error('unexpected alg');
  const jwk = (jwks.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown key id');
  const key = await crypto.subtle.importKey('jwk', { ...jwk, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new Error('bad signature');
  if (claims.aud !== clientId) throw new Error('wrong audience');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('wrong issuer');
  if (!claims.exp || claims.exp * 1000 < now) throw new Error('token expired');
  if (!claims.email || claims.email_verified !== true) throw new Error('email not verified');
  return { email: String(claims.email).toLowerCase(), name: claims.name || '' };
}

let jwksCache = { at: 0, jwks: null };
export async function getGoogleJwks(fetchFn = fetch, now = Date.now()) {
  if (jwksCache.jwks && now - jwksCache.at < 3600_000) return jwksCache.jwks;
  const r = await fetchFn('https://www.googleapis.com/oauth2/v3/certs');
  if (!r.ok) throw new Error('could not fetch Google keys');
  jwksCache = { at: now, jwks: await r.json() };
  return jwksCache.jwks;
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
