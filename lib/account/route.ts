/**
 * Turns a browser location into a route name for page statistics.
 *
 * Only the kind of page is kept. Course and section ids are replaced by
 * placeholders and query strings are dropped, so nothing that identifies a
 * student's material is ever sent.
 */
export function routeName(pathname: string, search = '', basePath = ''): string {
  let path = pathname;
  if (basePath && path.startsWith(basePath)) path = path.slice(basePath.length);
  path = path.replace(/\/+$/, '').toLowerCase() || '/';

  if (path === '/my') {
    const params = new URLSearchParams(search);
    if (!params.has('s')) return '/my';
    return params.get('v') === 'lesson' ? '/my/lesson' : '/my/section';
  }
  const demo = /^\/courses\/[^/]+(\/[^/]+)?(\/lesson)?$/.exec(path);
  if (demo) return `/courses/:course${demo[1] ? '/:section' : ''}${demo[2] ? '/lesson' : ''}`;
  return /^\/[a-z0-9/_-]{0,60}$/.test(path) ? path : '/other';
}

/** Routes where time counts as studying: a lesson or a review session. */
export const isStudyRoute = (route: string): boolean => route.endsWith('/lesson') || route === '/review';
