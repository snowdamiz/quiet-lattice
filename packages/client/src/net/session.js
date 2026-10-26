// The sign-in, kept for this browser tab only (sessionStorage): a reload goes straight to the character list, and closing
// the tab signs out. It holds the session token and the account, never game state, which is the server's (DESIGN 17).
// Beside it, a notice for the title screen after the world was left (a refusal, a sign-out), read once.
const SESSION = 'astra-session';
const NOTICE = 'astra-notice';

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
