// Dashboard: héroe + acciones, KPIs del día, ventas de los últimos 7 días (barras ancladas a la base) y alertas. Todo sale de metrics.js.
import * as repo from '../data/repo.js';
import * as M from '../data/metrics.js';
import * as auth from '../auth/auth.mock.js';
import cfgBase from '../../config.js';
import { getConfig } from '../store.js';
import { seriesChart } from '../ui/chart.js';
import { icon } from '../ui/icons.js';
import { esc, money, num, date, badge } from '../ui/format.js';

const alertHtml = (text, sub, link, cls = '') => `<div class="alert ${cls}"><span class="alert-ic">${icon(cls === 'alert-ok' ? 'check' : 'alert')}</span><div>${text}${sub ? `<small>${sub}</small>` : ''}${link || ''}</div></div>`;

export async function render(el) {
  let chart = null;
  const c = getConfig();
  el.innerHTML = `<div class="hero"><div><h1 id="hTitle">Hola — tu local en un panel</h1><p class="sub" id="hSub"></p></div><div class="hero-actions" id="hActions"></div></div>
    <div class="grid grid-kpi" style="margin-top:24px">${'<div class="skeleton" style="height:130px"></div>'.repeat(4)}</div>`;
  const [user, ops, items] = await Promise.all([auth.currentUser(), repo.list('operations'), repo.list('items')]);
  const now = new Date();
  const k = M.kpisHoy(ops, items, now, cfgBase);
  const week = M.salesByDay(ops, 7, now);
  const weekTotal = week.reduce((s, d) => s + Math.round(d.value * 100), 0) / 100;
  const crit = M.criticalProducts(items, cfgBase).sort((a, b) => a.stock - b.stock);
  const recent = M.recentOperations(ops, 6);
  const from30 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30), to30 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const top = M.topItems(ops, from30, to30, 5);
  const first = user ? user.name.split(' ')[0] : '';

  el.querySelector('#hTitle').textContent = `Hola, ${first} — tu local en un panel`;
  el.querySelector('#hSub').textContent = `${new Intl.DateTimeFormat(c.locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: c.timezone }).format(now)} · ${c.business.name}`;
  el.querySelector('#hActions').innerHTML = `<a class="btn btn-secondary" href="#/gastos?nuevo=1">Nuevo gasto</a><a class="btn btn-brand" href="#/ventas">Registrar venta</a>`;

  const alerts = [];
  crit.slice(0, 4).forEach((i) => alerts.push(alertHtml(`<strong>${esc(i.name)}</strong> ${i.stock <= 0 ? 'sin stock' : 'por debajo del mínimo'} (${num(i.stock)} / ${num(M.minStockOf(i, cfgBase))})`, i.supplier ? esc(i.supplier) : '', '')));
  if (crit.length > 4) alerts.push(alertHtml(`Y ${crit.length - 4} producto${crit.length - 4 === 1 ? '' : 's'} crítico${crit.length - 4 === 1 ? '' : 's'} más.`, '', '<a class="link-tap" href="#/stock">Ver Stock</a>'));
  if (!alerts.length) alerts.push(alertHtml('<strong>Todo en orden.</strong> Sin alertas por ahora.', '', '', 'alert-ok'));

  const kpi = (ic, chip, label, value, sub) => `<div class="card kpi"><div class="kpi-top"><span class="kpi-ic">${icon(ic, 18)}</span><span class="kpi-chip">${esc(chip)}</span></div><div class="kpi-label">${esc(label)}</div><div class="kpi-value num">${value}</div>${sub ? `<div class="kpi-delta">${sub}</div>` : ''}</div>`;
  const grid = el.querySelector('.grid-kpi');
  grid.outerHTML = `<div class="grid grid-kpi" style="margin-top:24px" id="kpis">
      ${kpi('dollar', `${k.tickets} ticket${k.tickets === 1 ? '' : 's'}`, 'Ventas hoy', esc(money(k.sales)), `Ayer: ${esc(money(k.salesYesterday))} (${k.ticketsYesterday} ticket${k.ticketsYesterday === 1 ? '' : 's'})`)}
      ${kpi('cart', 'Ventas / tickets', 'Ticket promedio', esc(money(k.avgTicket)), '')}
      ${kpi('trending', 'Ventas − Costo', 'Margen bruto hoy', esc(money(k.grossMargin)), k.grossPct == null ? 'Sin ventas hoy' : `${esc(String(k.grossPct).replace('.', ','))}% de las ventas`)}
      ${kpi('alert', 'Stock bajo mínimo', 'Productos críticos', esc(num(k.critical)), '<a class="link-tap" href="#/stock">Ver Stock</a>')}
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <section class="card" aria-labelledby="h-7d"><div class="card-head"><h2 id="h-7d">Ventas últimos 7 días</h2><span class="muted small num">Total ${esc(money(weekTotal))}</span></div><div class="chart-box" id="chBar"></div></section>
      <section class="card" aria-labelledby="h-al"><div class="card-head"><h2 id="h-al">Alertas inteligentes</h2></div><div class="alerts">${alerts.join('')}</div></section>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <section class="card" aria-labelledby="h-rec"><div class="card-head"><h2 id="h-rec">Últimas ventas</h2><a href="#/ventas/historial" class="small link-tap">Ver historial</a></div>
        ${recent.length ? `<div class="table-wrap"><table class="table"><caption class="sr-only">Últimas ventas</caption><thead><tr><th scope="col">Fecha</th><th scope="col">Ticket</th><th scope="col" class="num">Total</th><th scope="col">Estado</th></tr></thead><tbody>
        ${recent.map((o) => `<tr><td data-label="Fecha">${esc(date(o.date))}</td><td data-label="Ticket">#${esc(o.id.slice(0, 8))}</td><td class="num" data-label="Total">${esc(money(o.total))}</td><td data-label="Estado">${badge(o.status)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><p>Todavía no hay ventas.</p></div>'}</section>
      <section class="card" aria-labelledby="h-top"><div class="card-head"><h2 id="h-top">Más vendidos (30 días)</h2></div>
        ${top.length ? `<ol class="list">${top.map((t) => `<li class="list-item"><span>${esc(t.name)}<br><span class="muted small">${num(t.qty)} unidad${t.qty === 1 ? '' : 'es'}</span></span><strong class="num">${esc(money(t.total))}</strong></li>`).join('')}</ol>` : '<div class="empty"><p>Sin ventas en el período.</p></div>'}</section>
    </div>`;
  const dayName = (d) => new Intl.DateTimeFormat(c.locale, { weekday: 'short' }).format(d.date).replace('.', '');
  chart = seriesChart(el.querySelector('#chBar'), week.map((d, i) => ({ label: i === week.length - 1 ? 'Hoy' : dayName(d), value: d.value })), { type: 'bar', valueLabels: true, height: 220, ariaLabel: 'Ventas de los últimos 7 días' });
  return () => chart && chart.destroy();
}
