// Historial de ventas (derivado de operaciones): listado, filtros y detalle con snapshots. Anular vive en _opdetail.
import * as repo from '../data/repo.js';
import { createTable } from '../ui/table.js';
import { esc, money, dateTime, badge, METHODS } from '../ui/format.js';
import { showOperation } from './_opdetail.js';
import { ventasNav } from './ventas.js';

export async function render(el, ctx) {
  el.innerHTML = `<div class="page-head"><div><h1>Historial de ventas</h1><p class="sub">Todas las ventas registradas, con su estado.</p></div>${ventasNav('hist')}</div><div id="tbl"></div>`;
  const methods = Object.keys(METHODS);
  const t = createTable({
    caption: 'Historial de ventas', pageSize: 10, initialSearch: ctx.query.get('q') || '', dateField: 'date', initialSort: { key: 'date', dir: 'desc' },
    empty: { title: 'Todavía no hay ventas', text: 'Registrá la primera desde "Nueva venta".' },
    columns: [
      { key: 'date', label: 'Fecha', sortable: true, render: (r) => esc(dateTime(r.date)) },
      { key: 'ticket', label: 'Ticket', sortable: true, value: (r) => r.id, render: (r) => `#${esc(r.id.slice(0, 8))}` },
      { key: 'items', label: 'Detalle', cls: 'col-lg', render: (r) => esc(r.lines.map((l) => `${l.qty}× ${l.nameSnapshot}`).join(', ')) },
      { key: 'total', label: 'Total', sortable: true, num: true, render: (r) => esc(money(r.total)) },
      { key: 'paymentMethod', label: 'Método', render: (r) => esc(METHODS[r.paymentMethod] || r.paymentMethod) },
      { key: 'status', label: 'Estado', sortable: true, render: (r) => badge(r.status) },
      { key: 'actions', label: 'Acciones', render: (r) => `<span class="row-actions"><button type="button" class="btn btn-secondary btn-sm" data-action="view" aria-label="Ver venta #${esc(r.id.slice(0, 8))} del ${esc(dateTime(r.date))}">Ver</button></span>` },
    ],
    filters: [
      { key: 'status', label: 'Estado', options: [{ value: 'pagada', label: 'Pagada' }, { value: 'anulada', label: 'Anulada' }], test: (r, v) => r.status === v },
      { key: 'paymentMethod', label: 'Método', options: methods.map((value) => ({ value, label: METHODS[value] })), test: (r, v) => r.paymentMethod === v },
    ],
    search: (r) => `${r.id.slice(0, 8)} ${r.lines.map((l) => l.nameSnapshot).join(' ')}`,
    load: () => repo.list('operations'),
    onAction: (a, row) => showOperation(row, () => t.refresh()),
  });
  el.querySelector('#tbl').appendChild(t.el);
  await t.refresh();
}
