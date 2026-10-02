// Router por hash: #/ruta/:id?query. Guard async: devuelve una ruta a la que redirigir o null.
export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [p, q = ''] = raw.split('?');
  const segs = p.split('/').filter(Boolean).map(decodeURIComponent);
  return { path: '/' + segs.join('/'), name: segs[0] || '', id: segs[1] || null, query: new URLSearchParams(q) };
}
export function navigate(path, { replace = false } = {}) {
  const target = '#' + path;
  if (replace) location.replace(target); else location.hash = target;
}

/**
 * routes: { nombre: { title, load: () => Promise<{render(container, ctx)}>, public?: bool } }
 * render(container, ctx) puede devolver una función de limpieza.
 */
export function createRouter({ routes, container, guard, notFound, onRendered, defaultRoute = '/dashboard' }) {
  let token = 0;
  let cleanup = null;
  let first = true;

  async function resolve() {
    const my = ++token;
    if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { console.error(e); } }
    cleanup = null;
    const ctx = parseHash();
    if (!ctx.name) return navigate(defaultRoute, { replace: true });
    const route = routes[ctx.name];
    try {
      const redirect = await guard(route, ctx);
      if (my !== token) return;
      if (redirect && redirect !== ctx.path) return navigate(redirect, { replace: true });
      container.innerHTML = '';
      const mod = route ? await route.load() : notFound;
      if (my !== token) return;
      cleanup = await mod.render(container, ctx);
      if (my !== token) { if (typeof cleanup === 'function') cleanup(); return; }
      if (onRendered) onRendered(route || { title: 'No encontrado' }, ctx);
      if (!first) container.focus({ preventScroll: true });
      first = false;
      window.scrollTo(0, 0);
    } catch (err) {
      console.error(err);
      if (my !== token) return;
      container.innerHTML = '<div class="empty" role="alert"><h1>Ocurrió un error</h1><p>No se pudo cargar la sección.</p><button type="button" class="btn btn-primary" id="retry">Reintentar</button></div>';
      container.querySelector('#retry').addEventListener('click', resolve);
    }
  }
  window.addEventListener('hashchange', resolve);
  return { start: resolve, resolve };
}
