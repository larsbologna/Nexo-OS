// Bootstrap: config, shell (sidebar / topbar / nav móvil de chips), router.
import { getConfig, applyBranding, setOverrides, on } from './store.js';
import { createRouter, navigate } from './router.js';
import * as repo from './data/repo.js';
import * as auth from './auth/auth.mock.js';
import * as M from './data/metrics.js';
import cfgBase from '../config.js';
import { icon } from './ui/icons.js';

const NAV = [
  { name: 'dashboard', label: 'Resumen', icon: 'dashboard' },
  { name: 'ventas', label: 'Ventas', icon: 'cart' },
  { name: 'productos', label: 'Productos', icon: 'tag' },
  { name: 'stock', label: 'Stock', icon: 'layers', badge: 'stock' },
  { name: 'gastos', label: 'Gastos', icon: 'receipt' },
  { name: 'finanzas', label: 'Finanzas', icon: 'trending' },
  { name: 'config', label: 'Configuración', icon: 'settings' },
];

const routes = {};
NAV.forEach((n) => { routes[n.name] = { title: n.label, load: () => import(`./views/${n.name}.js`) }; });
routes.notificaciones = { title: 'Notificaciones', load: () => import('./views/notificaciones.js') };
routes.login = { title: 'Ingresar', public: true, load: () => import('./views/login.js') };

const $ = (id) => document.getElementById(id);
const notFound = {
  render(el) {
    el.innerHTML = '<div class="empty"><h1>Página no encontrada</h1><p>La ruta que buscás no existe.</p><a class="btn btn-primary" href="#/dashboard">Ir al dashboard</a></div>';
  },
};

function navLink(n, cls) {
  const badge = n.badge ? `<span class="nav-badge" data-badge="${n.badge}" hidden></span>` : '';
  return `<li><a class="${cls}" href="#/${n.name}" data-route="${n.name}">${cls === 'nav-item' ? icon(n.icon) : ''}<span class="nav-label">${n.label}</span>${badge}</a></li>`;
}
function buildNav() {
  $('navList').innerHTML = NAV.map((n) => navLink(n, 'nav-item')).join('');
  $('chipList').innerHTML = NAV.map((n) => navLink(n, 'chip-link')).join('');
  $('topSale').innerHTML = `<span aria-hidden="true">+</span><span>Venta<span class="hide-sm">&nbsp;rápida</span></span>`;
  $('topExpense').innerHTML = '<span aria-hidden="true">+</span> Gasto';
  $('bell').innerHTML = icon('bell') + '<span class="bell-count" id="bellCount" hidden></span>';
  $('logoutBtn').innerHTML = icon('logout', 18);
}

function setActiveNav(name) {
  document.querySelectorAll('.nav-item, .chip-link').forEach((a) => {
    if (a.dataset.route === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const active = document.querySelector('.chip-link[aria-current="page"]');
  const bar = $('chipList');
  if (active && bar) { bar.scrollLeft = Math.max(0, active.parentElement.offsetLeft - (bar.clientWidth - active.offsetWidth) / 2); updateChipEdges(); }
}

function updateChipEdges() {
  const bar = $('chipList'), wrap = $('chipWrap');
  if (!bar || !wrap) return;
  wrap.classList.toggle('has-left', bar.scrollLeft > 4);
  wrap.classList.toggle('at-end', bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 4);
}

function initShell() {
  // El skip-link no puede cambiar el hash: el router lo tomaría como ruta (#view → 404)
  document.querySelector('.skip-link').addEventListener('click', (e) => { e.preventDefault(); $('view').focus(); });
  $('chipList').addEventListener('scroll', updateChipEdges, { passive: true });
  // Foco por teclado: el chip enfocado queda completo a la vista (con margen), incluso el último
  $('chipList').addEventListener('focusin', (e) => {
    const a = e.target.closest('a'); if (!a) return;
    const bar = $('chipList'), li = a.parentElement, pad = 16;
    if (li.offsetLeft - pad < bar.scrollLeft) bar.scrollLeft = Math.max(0, li.offsetLeft - pad);
    else if (li.offsetLeft + li.offsetWidth + pad > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = li.offsetLeft + li.offsetWidth + pad - bar.clientWidth;
  });
  window.addEventListener('resize', updateChipEdges);
  $('logoutBtn').addEventListener('click', () => { auth.logout(); navigate('/login'); });
  const tick = () => {
    const c = getConfig();
    $('topDate').textContent = new Intl.DateTimeFormat(c.locale, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: c.timezone }).format(new Date());
  };
  tick(); setInterval(tick, 30000);
}

/* Guard: sin sesión => #/login; con sesión, login => dashboard. Rutas inexistentes también exigen sesión. */
async function guard(route) {
  const user = await auth.currentUser();
  paintUser(user);
  if (route && route.public) return user ? '/dashboard' : null;
  return user ? null : '/login';
}

function paintUser(user) {
  $('userName').textContent = user ? user.name : '';
  $('userInitial').textContent = user ? user.name.charAt(0).toUpperCase() : '';
  $('userRole').textContent = user ? `${user.role === 'admin' ? 'Admin' : user.role} • ${getConfig().business.name}` : '';
}

async function paintBell() {
  const n = await repo.unreadCount();
  const b = $('bellCount');
  b.hidden = n === 0; b.textContent = n > 99 ? '99+' : String(n);
  $('bell').setAttribute('aria-label', n ? `Notificaciones, ${n} sin leer` : 'Notificaciones');
}

/* Badges de nav (siempre con texto). Se refrescan con repo.onChange. */
async function paintStatus() {
  const items = await repo.list('items');
  const crit = M.criticalProducts(items, cfgBase).length;
  document.querySelectorAll('[data-badge="stock"]').forEach((b) => { b.hidden = !crit; b.className = 'nav-badge is-alert'; b.textContent = `${crit} crítico${crit === 1 ? '' : 's'}`; });
}

async function boot() {
  buildNav();
  initShell();
  try {
    await repo.init();
    const s = await repo.getSettings();
    setOverrides({ branding: s.branding || {}, business: s.business || {}, paymentMethods: s.paymentMethods });
  } catch (e) { console.error(e); }
  applyBranding();
  on('config', () => { applyBranding(); auth.currentUser().then(paintUser).catch(() => {}); });
  const refresh = () => { paintBell().catch(() => {}); paintStatus().catch(() => {}); };
  repo.onChange(refresh);
  const router = createRouter({
    routes, container: $('view'), guard, notFound,
    onRendered(route, ctx) {
      const sub = { 'ventas/historial': 'Historial de ventas', 'stock/movimientos': 'Movimientos de stock' }[`${ctx.name}/${ctx.id}`];
      document.title = `${sub || route.title} · ${getConfig().appName}`;
      setActiveNav(ctx.name);
      $('app').classList.toggle('no-shell', !!route.public);
      refresh();
    },
  });
  router.start();
}

boot();
