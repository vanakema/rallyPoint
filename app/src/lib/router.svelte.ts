/** Minimal history router — this app has exactly two routes. */

class Router {
  path = $state(window.location.pathname);

  navigate(to: string, replace = false): void {
    if (to === this.path) return;
    if (replace) {
      history.replaceState(null, '', to);
    } else {
      history.pushState(null, '', to);
    }
    this.path = to;
  }
}

export const router = new Router();

window.addEventListener('popstate', () => {
  router.path = window.location.pathname;
});

/** Returns the groupId when on /app/:groupId, else null. */
export function groupIdFromPath(path: string): string | null {
  const match = /^\/app\/([A-Za-z0-9_-]{1,64})$/.exec(path);
  return match ? match[1] : null;
}
