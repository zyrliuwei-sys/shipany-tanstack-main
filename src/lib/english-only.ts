/** Canonicalize links saved before the Chinese edition was retired. */
export function englishPathname(pathname: string): string {
  if (pathname !== '/zh' && !pathname.startsWith('/zh/')) return pathname;
  return pathname.slice(3).replace(/^[/\\]+/, '/') || '/';
}

export function redirectChineseEdition(request: Request): Response | null {
  const target = new URL(request.url);
  const pathname = englishPathname(target.pathname);
  if (pathname === target.pathname) return null;
  target.pathname = pathname;
  return Response.redirect(target.href, 308);
}
