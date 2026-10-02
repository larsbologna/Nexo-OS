// Empleados (MVP): legajo mínimo, ventas por vendedor y pagos de sueldo. Un empleado NO es un usuario del sistema (no inicia sesión).
// Ventas y pagos salen de registros transaccionales con snapshot: editar o archivar un empleado no altera el pasado.
import * as repo from '../data/repo.js';
import * as M from '../data/metrics.js';
import cfgBase from '../../config.js';
import { getConfig } from '../store.js';
import { createTable } from '../ui/table.js';
import { buildForm } from '../ui/form.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { esc, money, num, date, dateTime, badge, METHODS } from '../ui/format.js';
import { showOperation } from './_opdetail.js';
import { newExpense } from './gastos.js';

const PERIODS = [['hoy', 'Hoy'], ['mes', 'Mes'], ['anio', 'Año']];
const P_TXT = { hoy: 'de hoy', mes: 'del mes', anio: 'del año' };
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** Fecha de ingreso (YYYY-MM-DD, sin hora): se muestra tal cual, sin corrimiento de zona horaria. */
const fmtDay = (s) => { if (!s) return '—'; const [y, m, d] = s.split('-').map(Number); return new Intl.DateTimeFormat(getConfig().locale, { dateStyle: 'medium' }).format(new Date(y, m - 1, d)); };
const share = (part, total) => (total > 0 ? `${new Intl.NumberFormat(getConfig().locale, { maximumFractionDigits: 1 }).format((part / total) * 100)}%` : '—');
const statusOf = (e) => (e.archivedAt ? 'archivado' : e.status);
const inRange = (d, r) => { const t = new Date(d).getTime(); return t >= r.from.getTime() && t < r.to.getTime(); };
const isSalaryPaid = (x, id) => x.employeeId === id && x.status !== 'anulado';

function editEmployee(emp) {
  const fields = [
    { name: 'name', label: 'Nombre y apellido', required: true, span: 2, autocomplete: 'off' },
    { name: 'position', label: 'Puesto', type: 'select', required: true, options: cfgBase.employeePositions.map((v) => ({ value: v, label: v })) },
    { name: 'phone', label: 'Teléfono', type: 'tel', autocomplete: 'off' },
    { name: 'startDate', label: 'Fecha de ingreso', type: 'date', required: true },
    { name: 'status', label: 'Estado', type: 'select', options: [{ value: 'activo', label: 'Activo' }, { value: 'inactivo', label: 'Inactivo' }], hint: 'Solo los activos aparecen como vendedores en Ventas.' },
    { name: 'baseSalary', label: 'Sueldo base', type: 'number', min: 0, step: '0.01', span: 2, hint: 'Referencia para registrar pagos. Cambiarlo no modifica pagos pasados.' },
  ];
  const values = emp ? { ...emp, phone: emp.phone || '', baseSalary: emp.baseSalary ?? '' } : { position: cfgBase.employeePositions[1] || cfgBase.employeePositions[0], startDate: today(), status: 'activo' };
  return openModal({
    title: emp ? 'Editar empleado' : 'Nuevo empleado',
    build(body, api) {
      const f = buildForm({
        fields, values, submitLabel: emp ? 'Guardar cambios' : 'Crear empleado', onCancel: () => api.close(false),
        async onSubmit(v) {
          const data = { name: v.name.trim(), position: v.position, phone: (v.phone || '').trim(), startDate: v.startDate, status: v.status, baseSalary: v.baseSalary === '' ? null : Number(v.baseSalary) };
          if (emp) await repo.update('employees', emp.id, data); else await repo.create('employees', data);
          toast(emp ? 'Empleado actualizado.' : 'Empleado creado.', 'success');
          api.close(true);
        },
      });
      body.appendChild(f.el);
    },
  });
}

/** Archivar/restaurar. Devuelve true si cambió. */
async function toggleArchive(emp) {
  if (emp.archivedAt) { await repo.restore('employees', emp.id); toast('Empleado restaurado.', 'success'); return true; }
  const ok = await confirmDialog({ title: 'Archivar empleado', message: `${emp.name} dejará de aparecer en el listado y como vendedor en Ventas. Sus ventas y pagos pasados se conservan. Podés restaurarlo cuando quieras.`, confirmText: 'Archivar', danger: true });
  if (!ok) return false;
  await repo.archive('employees', emp.id); toast('Empleado archivado.', 'success'); return true;
}

/** Pago de sueldo: reusa el alta de gastos (caja, Finanzas y anulación con las reglas de siempre). */
function payEmployee(emp) {
  return newExpense({ category: cfgBase.salaryCategory, employeeId: emp.id, description: `Sueldo ${emp.name}`, amount: emp.baseSalary ?? '' });
}

/* ---------------- Listado + ventas por vendedor ---------------- */
async function renderList(el, ctx) {
  let period = 'mes';
  el.innerHTML = `<div class="page-head"><div><h1>Empleados</h1><p class="sub">Legajo del personal, ventas por vendedor y pagos de sueldo.</p></div><button type="button" class="btn btn-primary" id="newEmp">Nuevo empleado</button></div>
    <section class="card" aria-labelledby="h-sbs" style="margin-bottom:24px"><div class="card-head"><h2 id="h-sbs">Ventas por vendedor</h2>
      <div class="seg" role="group" aria-label="Período">${PERIODS.map(([k, l]) => `<button type="button" data-p="${k}" aria-pressed="${k === period}">${l}</button>`).join('')}</div></div>
      <div id="sbs"></div></section>
    <h2 class="sr-only" id="h-leg">Legajo</h2><div id="tbl"></div>`;

  async function paintSales() {
    const [ops, emps] = await Promise.all([repo.list('operations'), repo.list('employees', { archived: 'all' })]);
    const r = M.periodRange(period);
    const rows = M.salesBySeller(ops, r.from, r.to);
    const total = rows.reduce((s, x) => s + Math.round(x.total * 100), 0) / 100;
    const known = new Set(emps.map((e) => e.id));
    el.querySelector('#sbs').innerHTML = rows.length
      ? `<div class="table-wrap"><table class="table"><caption class="sr-only">Ventas por vendedor ${esc(P_TXT[period])}</caption><thead><tr><th scope="col">Vendedor</th><th scope="col" class="num">Tickets</th><th scope="col" class="num">Total</th><th scope="col" class="num">Participación</th></tr></thead><tbody>
        ${rows.map((x) => `<tr><td data-label="Vendedor">${x.sellerId ? (known.has(x.sellerId) ? `<a class="link-strong" href="#/empleados/${esc(x.sellerId)}">${esc(x.name)}</a>` : esc(x.name)) : '<span class="muted">Sin vendedor</span>'}</td><td class="num" data-label="Tickets">${esc(num(x.count))}</td><td class="num" data-label="Total">${esc(money(x.total))}</td><td class="num" data-label="Participación">${esc(share(x.total, total))}</td></tr>`).join('')}
        </tbody></table></div><p class="muted small" style="margin-top:12px">Ventas no anuladas ${esc(P_TXT[period])}: ${esc(money(total))}. El vendedor se elige (opcional) al cobrar en Ventas.</p>`
      : `<div class="empty"><p>Sin ventas ${esc(P_TXT[period])}.</p></div>`;
  }

  const t = createTable({
    caption: 'Legajo de empleados', pageSize: 10, archivedToggle: true, initialSearch: ctx.query.get('q') || '', initialSort: { key: 'name', dir: 'asc' },
    empty: { title: 'Todavía no hay empleados', text: 'Cargá el primero con "Nuevo empleado".' },
    columns: [
      { key: 'name', label: 'Nombre', sortable: true, render: (r) => `<a class="link-strong" href="#/empleados/${esc(r.id)}">${esc(r.name)}</a>` },
      { key: 'position', label: 'Puesto', sortable: true },
      { key: 'phone', label: 'Teléfono', cls: 'col-lg', render: (r) => (r.phone ? esc(r.phone) : '<span class="muted">—</span>') },
      { key: 'startDate', label: 'Ingreso', sortable: true, render: (r) => esc(fmtDay(r.startDate)) },
      { key: 'baseSalary', label: 'Sueldo base', sortable: true, num: true, render: (r) => (r.baseSalary == null ? '<span class="muted">—</span>' : esc(money(r.baseSalary))) },
      { key: 'status', label: 'Estado', sortable: true, value: statusOf, render: (r) => badge(statusOf(r)) },
      { key: 'actions', label: 'Acciones', render: (r) => `<span class="row-actions"><button type="button" class="btn btn-secondary btn-sm" data-action="edit" aria-label="Editar ${esc(r.name)}">Editar</button><button type="button" class="btn btn-secondary btn-sm" data-action="archive" aria-label="${r.archivedAt ? 'Restaurar' : 'Archivar'} ${esc(r.name)}">${r.archivedAt ? 'Restaurar' : 'Archivar'}</button></span>` },
    ],
    filters: [
      { key: 'position', label: 'Puesto', options: cfgBase.employeePositions.map((v) => ({ value: v, label: v })), test: (r, v) => r.position === v },
      { key: 'status', label: 'Estado', options: [{ value: 'activo', label: 'Activo' }, { value: 'inactivo', label: 'Inactivo' }], test: (r, v) => r.status === v },
    ],
    search: (r) => `${r.name} ${r.position} ${r.phone || ''}`,
    load: ({ showArchived }) => repo.list('employees', { archived: showArchived ? 'all' : false }),
    async onAction(a, row) {
      try {
        if (a === 'edit' && await editEmployee(row)) t.refresh();
        if (a === 'archive' && await toggleArchive(row)) t.refresh();
      } catch (e) { toast(e.message, 'error'); }
    },
  });
  el.querySelector('#tbl').appendChild(t.el);
  el.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
    period = b.dataset.p;
    el.querySelectorAll('[data-p]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.p === period)));
    paintSales();
  }));
  el.querySelector('#newEmp').addEventListener('click', async () => { try { if (await editEmployee(null)) t.refresh(); } catch (e) { toast(e.message, 'error'); } });
  await Promise.all([paintSales(), t.refresh()]);
}

/* ---------------- Ficha ---------------- */
async function renderDetail(el, id) {
  const emp = await repo.get('employees', id);
  if (!emp) {
    el.innerHTML = '<div class="empty"><h1>Empleado no encontrado</h1><p>Puede que el enlace sea incorrecto.</p><a class="btn btn-primary" href="#/empleados">Volver a Empleados</a></div>';
    return;
  }
  const [ops, exps] = await Promise.all([repo.list('operations'), repo.list('expenses')]);
  const mine = ops.filter((o) => o.sellerId === id);
  const rMes = M.periodRange('mes'), rAnio = M.periodRange('anio');
  const sum = (list) => list.reduce((s, o) => s + Math.round(o.total * 100), 0) / 100;
  const live = mine.filter(M.isLive);
  const mes = live.filter((o) => inRange(o.date, rMes)), anio = live.filter((o) => inRange(o.date, rAnio));
  const pays = exps.filter((x) => isSalaryPaid(x, id));
  const paidYear = pays.filter((x) => inRange(x.date, rAnio)).reduce((s, x) => s + Math.round(x.amount * 100), 0) / 100;
  const lastPay = [...pays].sort((a, b) => b.date.localeCompare(a.date))[0];
  const kpi = (label, value, chip) => `<div class="card kpi"><div class="kpi-top"><span class="kpi-chip">${esc(chip)}</span></div><div class="kpi-label">${esc(label)}</div><div class="kpi-value num">${value}</div></div>`;

  el.innerHTML = `<div class="page-head"><div><p class="small"><a class="link-tap" href="#/empleados">← Empleados</a></p><h1>${esc(emp.name)} ${badge(statusOf(emp))}</h1><p class="sub">${esc(emp.position)}</p></div>
      <div class="row">${emp.archivedAt ? '' : '<button type="button" class="btn btn-primary" id="pay">Registrar pago de sueldo</button>'}<button type="button" class="btn btn-secondary" id="ed">Editar</button><button type="button" class="btn btn-secondary" id="ar">${emp.archivedAt ? 'Restaurar' : 'Archivar'}</button></div></div>
    <div class="grid grid-kpi">
      ${kpi('Ventas del mes', esc(money(sum(mes))), `${mes.length} ticket${mes.length === 1 ? '' : 's'}`)}
      ${kpi('Ventas del año', esc(money(sum(anio))), `${anio.length} ticket${anio.length === 1 ? '' : 's'}`)}
      ${kpi('Sueldo base', emp.baseSalary == null ? '—' : esc(money(emp.baseSalary)), 'Referencia')}
      ${kpi('Pagado en el año', esc(money(paidYear)), lastPay ? `Último: ${date(lastPay.date)}` : 'Sin pagos')}
    </div>
    <section class="card" aria-labelledby="h-datos" style="margin-top:16px"><div class="card-head"><h2 id="h-datos">Datos</h2></div>
      <dl class="kv"><dt>Puesto</dt><dd>${esc(emp.position)}</dd><dt>Teléfono</dt><dd>${emp.phone ? esc(emp.phone) : '—'}</dd><dt>Ingreso</dt><dd>${esc(fmtDay(emp.startDate))}</dd><dt>Estado</dt><dd>${badge(statusOf(emp))}</dd></dl></section>
    <section aria-labelledby="h-ventas" style="margin-top:24px"><h2 id="h-ventas" style="margin-bottom:12px">Ventas</h2><div id="tVentas"></div></section>
    <section aria-labelledby="h-pagos" style="margin-top:24px"><h2 id="h-pagos" style="margin-bottom:12px">Pagos de sueldo</h2><div id="tPagos"></div></section>`;

  const tv = createTable({
    caption: `Ventas de ${emp.name}`, pageSize: 10, dateField: 'date', initialSort: { key: 'date', dir: 'desc' },
    empty: { title: 'Sin ventas', text: 'Todavía no tiene ventas asignadas.' },
    columns: [
      { key: 'date', label: 'Fecha', sortable: true, render: (r) => esc(dateTime(r.date)) },
      { key: 'ticket', label: 'Ticket', render: (r) => `#${esc(r.id.slice(0, 8))}` },
      { key: 'total', label: 'Total', sortable: true, num: true, render: (r) => esc(money(r.total)) },
      { key: 'paymentMethod', label: 'Método', cls: 'col-lg', render: (r) => esc(METHODS[r.paymentMethod] || r.paymentMethod) },
      { key: 'status', label: 'Estado', sortable: true, render: (r) => badge(r.status) },
      { key: 'actions', label: 'Acciones', render: (r) => `<span class="row-actions"><button type="button" class="btn btn-secondary btn-sm" data-action="view" aria-label="Ver venta #${esc(r.id.slice(0, 8))} del ${esc(dateTime(r.date))}">Ver</button></span>` },
    ],
    search: (r) => `${r.id.slice(0, 8)} ${r.lines.map((l) => l.nameSnapshot).join(' ')}`,
    load: async () => (await repo.list('operations')).filter((o) => o.sellerId === id),
    onAction: (a, row) => showOperation(row, () => renderDetail(el, id)),
  });
  const tp = createTable({
    caption: `Pagos de sueldo de ${emp.name}`, pageSize: 10, initialSort: { key: 'date', dir: 'desc' },
    empty: { title: 'Sin pagos', text: emp.archivedAt ? 'No tiene pagos registrados.' : 'Registrá el primero con "Registrar pago de sueldo".' },
    rowClass: (r) => (r.status === 'anulado' ? 'row-archived' : ''),
    columns: [
      { key: 'date', label: 'Fecha', sortable: true, render: (r) => esc(dateTime(r.date)) },
      { key: 'description', label: 'Descripción', render: (r) => esc(r.description) },
      { key: 'paymentMethod', label: 'Método', cls: 'col-lg', render: (r) => esc(METHODS[r.paymentMethod] || r.paymentMethod) },
      { key: 'amount', label: 'Monto', sortable: true, num: true, render: (r) => (r.status === 'anulado' ? `<s>${esc(money(r.amount))}</s>` : esc(money(r.amount))) },
      { key: 'status', label: 'Estado', render: (r) => (r.status === 'anulado' ? '<span class="badge badge-danger">Anulado</span>' : '<span class="badge badge-success">Registrado</span>') },
    ],
    load: async () => (await repo.list('expenses')).filter((x) => x.employeeId === id),
  });
  el.querySelector('#tVentas').appendChild(tv.el);
  el.querySelector('#tPagos').appendChild(tp.el);
  const guard = (fn) => async () => { try { if (await fn()) renderDetail(el, id); } catch (e) { toast(e.message, 'error'); } };
  const payBtn = el.querySelector('#pay'); if (payBtn) payBtn.addEventListener('click', guard(() => payEmployee(emp)));
  el.querySelector('#ed').addEventListener('click', guard(() => editEmployee(emp)));
  el.querySelector('#ar').addEventListener('click', guard(() => toggleArchive(emp)));
  await Promise.all([tv.refresh(), tp.refresh()]);
}

export async function render(el, ctx) {
  if (ctx.id) return renderDetail(el, ctx.id);
  return renderList(el, ctx);
}
