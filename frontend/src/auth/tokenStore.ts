/**
 * The only place that knows where the access token lives.
 *
 * Decision: sessionStorage. The token survives a page reload but is dropped when the tab
 * closes and is not shared across tabs. Trade-off: any script running in the page (XSS) can
 * read it, exactly as with localStorage. In-memory storage would be safer against XSS but
 * would log the user out on every reload; an httpOnly cookie would be safer still but needs
 * backend changes (cookie issuing + CSRF protection). Mitigations: the token only lives for
 * 30 minutes of inactivity (sliding window), the app renders no raw HTML, and the backend
 * re-reads role/active flag on every request, so a stolen token cannot outlive a deactivation.
 */
const KEY = 'urpmp.accessToken';

export const tokenStore = {
  get(): string | null {
    return window.sessionStorage.getItem(KEY);
  },
  set(token: string): void {
    window.sessionStorage.setItem(KEY, token);
  },
  /**
   * Applies a token the server refreshed via X-Auth-Token. Ignored when there is no active
   * session, so a response that arrives after logout cannot resurrect it.
   */
  replaceIfPresent(token: string): void {
    if (this.get() !== null) this.set(token);
  },
  clear(): void {
    window.sessionStorage.removeItem(KEY);
  },
};
