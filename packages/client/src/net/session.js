// The sign-in, kept for this browser tab only (sessionStorage): a reload goes straight to the character list, and closing
// the tab signs out. It holds the session token and the account, never game state, which is the server's (DESIGN 17).
// Beside it, a notice for the title screen after the world was left (a refusal, a sign-out), read once.
const SESSION = 'astra-session';
const NOTICE = 'astra-notice';

/** The demo's localStorage save, under its two names (DESIGN 20.3 removes it). */
const LEGACY_SAVES = ['next-horizon-save-v2', 'astra-nullius-save-v2'];

/** The server holds characters now: a browser that still has the demo's save drops it, so none lingers. */
export function dropLegacySave() {
  for (const key of LEGACY_SAVES) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  }
}

function storage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** { token, accountId, username } or null. */
export function loadSession() {
  try {
    const s = JSON.parse(storage()?.getItem(SESSION) ?? 'null');
    return s && typeof s.token === 'string' && typeof s.accountId === 'string' ? s : null;
  } catch {
    return null;
  }
}

/** When a session token expires (ms since the epoch), from its `exp` claim; null when it has none or cannot be read. The
 * client only reads the claim to know when to ask for a new sign-in: the server verifies the token. */
export function tokenExpiry(token) {
  try {
    const part = String(token).split('.')[1];
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')));
    return typeof json.exp === 'number' && Number.isFinite(json.exp) ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Whether a session's token has run out, or will within a minute (sessions last 7 days, ARCHITECTURE §2: there is no
 * refresh, a new sign-in makes a new one). */
export function sessionExpired(session, now = Date.now()) {
  const exp = tokenExpiry(session.token);
  return exp !== null && exp - 60_000 <= now;
}

export function saveSession(session) {
  try {
    storage()?.setItem(SESSION, JSON.stringify({ token: session.token, accountId: session.accountId, username: session.username }));
  } catch {
    /* storage unavailable: the sign-in lasts as long as the page */
  }
}

export function clearSession() {
  try {
    storage()?.removeItem(SESSION);
  } catch {
    /* storage unavailable */
  }
}

export function setNotice(text) {
  try {
    storage()?.setItem(NOTICE, text);
  } catch {
    /* storage unavailable */
  }
}

/** The notice left for the title, once. */
export function takeNotice() {
  try {
    const s = storage();
    const text = s?.getItem(NOTICE) ?? null;
    s?.removeItem(NOTICE);
    return text;
  } catch {
    return null;
  }
}
