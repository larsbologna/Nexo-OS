// Stock: saldos con alertas, ingreso de mercadería, ajustes con motivo, pedido a proveedor y auditoría de movimientos.
import * as repo from '../data/repo.js';
import * as M from '../data/metrics.js';
import cfgBase from '../../config.js';
import { getConfig } from '../store.js';
import { createTable } from '../ui/table.js';
import { buildForm } from '../ui/form.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { positive } from '../ui/validators.js';
import { esc, money, num, dateTime, pct } from '../ui/format.js';

const KIND = { inicial: ['neutral', 'Inicial'], venta: ['info', 'Venta'], anulacion: ['warning', 'Anulación'], ingreso: ['success', 'Ingreso'], ajuste: ['brand', 'Ajuste'] };
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${num(Math.abs(n))}`;
const margin = (r) => (r.cost != null && r.price > 0 ? Math.round(((r.price - r.cost) / r.price) * 1000) / 10 : null);

function stockState(i) {
  if (i.stock < 0) return ['danger', 'Negativo'];
  if (i.stock === 0) return ['danger', 'Sin stock'];
  if (i.stock <= M.minStockOf(i, cfgBase)) return ['warning', 'Crítico'];
  return ['success', 'OK'];
}
const stateBadge = (i) => { const [t, l] = stockState(i); return `<span class="badge badge-${t}">${l}</span>`; };

function subnav(active) {
  return `<nav class="subnav" aria-label="Stock"><a class="chip" href="#/stock"${active === 'saldos' ? ' aria-current="page"' : ''}>Saldos</a><a class="chip" href="#/stock/movimientos"${active === 'mov' ? ' aria-current="page"' : ''}>Movimientos</a></nav>`;
}

function receiveModal(tracked, preset) {
  const opts = tracked.map((i) => ({ value: i.id, label: `${i.name} (${i.sku})` }));
  const first = tracked.find((i) => i.id === preset) || tracked[0];
  return openModal({
    title: 'Ingreso de mercadería', size: 'sm',
    build(body, api) {
      const f = buildForm({
        fields: [
          { name: 'itemId', label: 'Producto', type: 'select', required: true, options: opts, span: 2 },
          { name: 'qty', label: 'Cantidad', type: 'number', required: true, min: 1, step: '1', validators: [positive('Ingresá una cantidad mayor a 0.')] },
          { name: 'unitCost', label: 'Costo unitario', type: 'number', min: 0, step: '0.01', hint: 'Actualiza el costo del producto. Las ventas pasadas no cambian.' },
          { name: 'supplier', label: 'Proveedor', span: 2 },
        ],
        values: { itemId: first.id, qty: '', unitCost: first.cost ?? '', supplier: first.supplier || '' }, submitLabel: 'Registrar ingreso', onCancel: () => api.close(false),
        async onSubmit(v) {
          const m = await repo.receiveStock({ itemId: v.itemId, qty: Number(v.qty), unitCost: v.unitCost, supplier: v.supplier });
          toast(`Ingreso registrado: +${m.qty} ${m.nameSnapshot}.`, 'success');
          api.close(true);
        },
      });
      body.appendChild(f.el);
      f.el.elements.itemId.addEventListener('change', () => {
        const it = tracked.find((i) => i.id === f.el.elements.itemId.value);
        if (it) { f.el.elements.unitCost.value = it.cost ?? ''; f.el.elements.supplier.value = it.supplier || ''; }
      });
    },
  });
}

function adjustModal(item) {
  return openModal({
    title: `Ajustar stock: ${item.name}`, size: 'sm',
    build(body, api) {
      const f = buildForm({
        fields: [
          { name: 'delta', label: 'Ajuste (+ suma, − resta)', type: 'number', required: true, step: '1', hint: `Stock actual: ${num(item.stock)}. Ej.: -2 para una rotura, 3 para un sobrante.`, validators: [(v) => (Number.isInteger(Number(v)) && Number(v) !== 0 ? '' : 'Ingresá un entero distinto de 0.')] },
          { name: 'reason', label: 'Motivo', required: true, span: 2, hint: 'Obligatorio: queda en el historial de movimientos.' },
        ],
        submitLabel: 'Registrar ajuste', onCancel: () => api.close(false),
        async onSubmit(v) {
          await repo.adjustStock({ itemId: item.id, delta: Number(v.delta), reason: v.reason });
          toast('Ajuste registrado.', 'success');
          api.close(true);
        },
      });
      body.appendChild(f.el);
    },
  });
}

/** N6: texto de pedido por proveedor, copiado al portapapeles (sin salir del sitio). */
function orderText(critical, businessName) {
  const bySup = new Map();
  critical.forEach((i) => { const k = i.supplier || 'Sin proveedor asignado'; (bySup.get(k) || bySup.set(k, []).get(k)).push(i); });
  return [...bySup].map(([sup, list]) => `Pedido para ${sup} — ${businessName}\nHola, necesito reponer:\n${list.map((i) => `- ${i.name}: pedir ${Math.max(M.minStockOf(i, cfgBase) * 3 - i.stock, 1)} u. (stock ${i.stock}, mínimo ${M.minStockOf(i, cfgBase)})`).join('\n')}\nGracias.`).join('\n\n');
}
function orderModal(text) {
  return openModal({
    title: 'Pedido a proveedor', size: 'md',
    build(body, api) {
      body.innerHTML = `<div class="field"><label for="ordTxt">Texto del pedido</label><textarea class="input" id="ordTxt" rows="10" readonly>${esc(text)}</textarea></div>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" data-close>Cerrar</button><button type="button" class="btn btn-primary" data-copy>${icon('copy', 16)} Copiar pedido</button></div>`;
      body.querySelector('[data-close]').addEventListener('click', () => api.close());
      body.querySelector('[data-copy]').addEventListener('click', async () => {
        const ta = body.querySelector('#ordTxt');
        try { await navigator.clipboard.writeText(ta.value); toast('Pedido copiado al portapapeles.', 'success'); }
        catch (e) { ta.focus(); ta.select(); toast('Seleccioná el texto y copialo (Ctrl+C).', 'warning'); }
      });
    },
  });
}

async function renderMovements(el) {
  el.innerHTML = `<div class="page-head"><div><h1>Movimientos de stock</h1><p class="sub">Historial inmutable: cada cambio de stock deja un registro.</p></div>${subnav('mov')}</div><div id="tbl"></div>`;
  const t = createTable({
    caption: 'Movimientos de stock', pageSize: 10, dateField: 'date', initialSort: { key: 'date', dir: 'desc' },
    empty: { title: 'Sin movimientos', text: 'Las ventas, ingresos y ajustes aparecerán acá.' },
    columns: [
      { key: 'date', label: 'Fecha', sortable: true, render: (r) => esc(dateTime(r.date)) },
      { key: 'nameSnapshot', label: 'Producto', sortable: true, render: (r) => esc(r.nameSnapshot) },
      { key: 'kind', label: 'Tipo', sortable: true, render: (r) => `<span class="badge badge-${KIND[r.kind][0]}">${KIND[r.kind][1]}</span>` },
      { key: 'qty', label: 'Cantidad', sortable: true, num: true, render: (r) => `<strong>${esc(signed(r.qty))}</strong>` },
      { key: 'unitCost', label: 'Costo unit.', num: true, render: (r) => (r.unitCost == null ? '<span class="muted">—</span>' : esc(money(r.unitCost))) },
      { key: 'reason', label: 'Motivo', render: (r) => esc(r.reason || '') },
    ],
    filters: [{ key: 'kind', label: 'Tipo', options: Object.entries(KIND).map(([value, [, label]]) => ({ value, label })), test: (r, v) => r.kind === v }],
    search: (r) => `${r.nameSnapshot} ${r.reason || ''}`,
    load: () => repo.list('stockMovements'),
  });
  el.querySelector('#tbl').appendChild(t.el);
  await t.refresh();
}

export async function render(el, ctx) {
  if (ctx.id === 'movimientos') return renderMovements(el);
  const st = { onlyCritical: false };
  el.innerHTML = `<div class="page-head"><div><h1>Stock</h1><p class="sub">Saldos, alertas de reposición y movimientos.</p></div><div class="row"><button type="button" class="btn btn-secondary" id="order">${icon('copy', 16)} Pedido a proveedor</button><button type="button" class="btn btn-primary" id="recv">${icon('plus', 16)} Ingreso de mercadería</button></div></div>
    ${subnav('saldos')}
    <div class="row" style="margin-bottom:16px"><button type="button" class="chip chip-alert" id="onlyCrit" aria-pressed="false">Solo críticos</button><span class="muted small" id="critInfo" role="status"></span></div>
    <div id="tbl"></div>`;
  let all = [];
  const load = async () => { all = (await repo.list('items')).filter((i) => M.isTracked(i)); return all; };
  const critical = () => all.filter((i) => M.isCriticalItem(i, cfgBase));
  const t = createTable({
    caption: 'Saldos de stock', pageSize: 10, initialSort: { key: 'name', dir: 'asc' }, initialSearch: ctx.query.get('q') || '',
    empty: { title: 'No hay productos con control de stock', text: 'Creá productos con control de stock en Productos.' },
    rowClass: (r) => (M.isCriticalItem(r, cfgBase) ? 'row-critical' : ''),
    columns: [
      { key: 'name', label: 'Producto', sortable: true, render: (r) => `${esc(r.name)}<br><span class="muted small">${esc(r.sku)}</span>` },
      { key: 'category', label: 'Categoría', sortable: true, cls: 'col-lg', render: (r) => esc(r.category || '—') },
      { key: 'stock', label: 'Stock', sortable: true, num: true, render: (r) => `<strong>${esc(num(r.stock))}</strong>` },
      { key: 'minStock', label: 'Mín.', sortable: true, num: true, value: (r) => M.minStockOf(r, cfgBase), render: (r) => esc(num(M.minStockOf(r, cfgBase))) },
      { key: 'cost', label: 'Costo', sortable: true, num: true, render: (r) => (r.cost == null ? '—' : esc(money(r.cost))) },
      { key: 'price', label: 'Precio', sortable: true, num: true, cls: 'col-lg', render: (r) => esc(money(r.price)) },
      { key: 'margin', label: 'Margen', sortable: true, num: true, cls: 'col-lg', value: margin, render: (r) => (margin(r) == null ? '—' : esc(pct(margin(r)).replace('+', ''))) },
      { key: 'supplier', label: 'Proveedor', sortable: true, cls: 'col-lg', render: (r) => esc(r.supplier || '—') },
      { key: 'state', label: 'Estado', sortable: true, value: (r) => r.stock - M.minStockOf(r, cfgBase), render: stateBadge },
      { key: 'actions', label: 'Acciones', render: (r) => `<span class="row-actions"><button type="button" class="btn btn-secondary btn-sm" data-action="in" aria-label="Ingreso de mercadería de ${esc(r.name)}">Ingreso</button><button type="button" class="btn btn-secondary btn-sm" data-action="adj" aria-label="Ajustar stock de ${esc(r.name)}">Ajuste</button></span>` },
    ],
    filters: [],
    search: (r) => `${r.name} ${r.sku} ${r.category || ''} ${r.supplier || ''}`,
    load: async () => { await load(); paintInfo(); return st.onlyCritical ? critical() : all; },
    async onAction(a, row) {
      try {
        const ok = a === 'in' ? await receiveModal(all, row.id) : await adjustModal(row);
        if (ok) t.refresh();
      } catch (e) { toast(e.message, 'error'); }
    },
  });
  function paintInfo() { const n = critical().length; el.querySelector('#critInfo').textContent = n ? `${n} producto${n === 1 ? '' : 's'} en nivel crítico` : 'No hay productos críticos.'; }
  el.querySelector('#tbl').appendChild(t.el);
  el.querySelector('#onlyCrit').addEventListener('click', (e) => { st.onlyCritical = !st.onlyCritical; e.currentTarget.setAttribute('aria-pressed', String(st.onlyCritical)); t.refresh(); });
  el.querySelector('#recv').addEventListener('click', async () => { if (!all.length) return toast('No hay productos con control de stock.', 'warning'); if (await receiveModal(all)) t.refresh(); });
  el.querySelector('#order').addEventListener('click', () => {
    const crit = critical();
    if (!crit.length) return toast('No hay productos críticos: nada para pedir.', 'info');
    orderModal(orderText(crit, getConfig().business.name));
  });
  await t.refresh();
}
