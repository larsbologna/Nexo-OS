// Gastos: registro, listado y anulación. Efectivo con caja abierta => retiro en la caja (lo resuelve el repo). Corrección = anular + nuevo.
import * as repo from '../data/repo.js';
import * as M from '../data/metrics.js';
import cfgBase from '../../config.js';
import { getConfig } from '../store.js';
import { createTable } from '../ui/table.js';
import { buildForm } from '../ui/form.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { positive } from '../ui/validators.js';
import { esc, money, dateTime, METHODS } from '../ui/format.js';

const statusBadge = (e) => (e.status === 'anulado' ? '<span class="badge badge-danger">Anulado</span>' : '<span class="badge badge-success">Registrado</span>');

/** Alta de gasto. preset (opcional): valores iniciales, p. ej. desde la ficha de un empleado {category: Sueldos, employeeId, description, amount}. */
export async function newExpense(preset = {}) {
  const c = getConfig();
  const emps = (await repo.list('employees')).sort((a, b) => a.name.localeCompare(b.name));
  return openModal({
    title: preset.employeeId ? 'Registrar pago de sueldo' : 'Registrar gasto', size: 'sm',
    build(body, api) {
      const f = buildForm({
        fields: [
          { name: 'category', label: 'Categoría', type: 'select', required: true, options: cfgBase.expenseCategories.map((v) => ({ value: v, label: v })), span: 2, hint: `«${cfgBase.merchandiseCategory}» va al flujo de caja; su costo entra al resultado recién al vender.` },
          { name: 'employeeId', label: 'Empleado', type: 'select', span: 2, options: [{ value: '', label: 'Sin vincular' }, ...emps.map((e) => ({ value: e.id, label: e.status === 'activo' ? e.name : `${e.name} (inactivo)` }))], hint: 'Vinculá el pago de sueldo al legajo del empleado (opcional).' },
          { name: 'description', label: 'Descripción', required: true, span: 2 },
          { name: 'amount', label: 'Monto', type: 'number', required: true, min: 0.01, step: '0.01', validators: [positive('El monto debe ser mayor a 0.')] },
          { name: 'paymentMethod', label: 'Método de pago', type: 'select', options: c.paymentMethods.map((v) => ({ value: v, label: METHODS[v] || v })) },
          { name: 'supplier', label: 'Proveedor (opcional)', span: 2 },
        ],
        values: { category: 'Varios', paymentMethod: c.paymentMethods.includes('efectivo') ? 'efectivo' : c.paymentMethods[0], ...preset }, submitLabel: preset.employeeId ? 'Registrar pago' : 'Registrar gasto', onCancel: () => api.close(false),
        extra: '<p class="hint">Si pagás en efectivo con la caja abierta, se descuenta de la caja automáticamente.</p>',
        async onSubmit(v) {
          const input = { category: v.category, description: v.description, amount: Number(v.amount), paymentMethod: v.paymentMethod, supplier: v.supplier, employeeId: v.category === cfgBase.salaryCategory && v.employeeId ? v.employeeId : null };
          let res = await repo.createExpense(input);
          if (res.needsConfirmation) {
            const ok = await confirmDialog({ title: 'No hay caja abierta', confirmText: 'Registrar igualmente', message: 'Este gasto en efectivo no se descontará de ninguna caja porque no hay una abierta. ¿Registrarlo igualmente?' });
            if (!ok) return;
            res = await repo.createExpense(input, { confirmNoCash: true });
          }
          toast(res.expense.cashMovementId ? 'Gasto registrado y descontado de la caja.' : 'Gasto registrado.', 'success');
          api.close(true);
        },
      });
      body.appendChild(f.el);
      // El campo Empleado solo aplica a la categoría de sueldos
      const cat = f.el.elements.category, empField = f.el.elements.employeeId.closest('.field');
      const sync = () => { empField.hidden = cat.value !== cfgBase.salaryCategory; };
      cat.addEventListener('change', sync); sync();
    },
  });
}

async function voidExpenseFlow(e) {
  const reason = await openModal({
    title: 'Anular gasto', size: 'sm',
    build(body, api) {
      const f = buildForm({
        fields: [{ name: 'reason', label: 'Motivo de la anulación', type: 'textarea', required: true, span: 2, hint: `Se anulará «${e.description}» por ${money(e.amount)}. No se puede deshacer.` }],
        submitLabel: 'Anular gasto', onCancel: () => api.close(null), async onSubmit(v) { api.close(v.reason.trim()); },
      });
      body.appendChild(f.el);
    },
  });
  if (!reason) return false;
  const prompt = await repo.voidExpensePrompt(e.id);
  let refunded = false;
  if (prompt.askRefund) {
    const ans = await openModal({
      title: '¿Se reintegró el efectivo?', size: 'sm',
      build(body, api) {
        body.innerHTML = `<div class="modal-msg"><p>${prompt.hasOpenCash ? 'Si se reintegró, se registra un ingreso «Reintegro» en la caja abierta. ' : 'No hay caja abierta: si se reintegró, te avisaremos con una notificación para registrarlo al abrir la próxima caja. '}El cierre de la caja donde se pagó no cambia.</p></div>
          <div class="modal-actions"><button type="button" class="btn btn-secondary" data-no>No se reintegró</button><button type="button" class="btn btn-primary" data-yes>Sí, se reintegró</button></div>`;
        body.querySelector('[data-no]').addEventListener('click', () => api.close('no'));
        body.querySelector('[data-yes]').addEventListener('click', () => api.close('yes'));
      },
    });
    if (ans !== 'yes' && ans !== 'no') return false;
    refunded = ans === 'yes';
  }
  await repo.voidExpense(e.id, { reason, refunded });
  toast(e.cashMovementId && !prompt.askRefund ? 'Gasto anulado. El efectivo volvió a la caja.' : 'Gasto anulado.', 'success');
  return true;
}

export async function render(el, ctx) {
  el.innerHTML = `<div class="page-head"><div><h1>Gastos</h1><p class="sub">Registrá lo que gastás. Los gastos en efectivo salen de la caja abierta.</p></div><button type="button" class="btn btn-primary" id="newE">Registrar gasto</button></div>
    <div class="grid grid-kpi" id="kpis" style="margin-bottom:24px"></div><div id="tbl"></div>`;
  async function paintKpis() {
    const [ops, exps] = await Promise.all([repo.list('operations'), repo.list('expenses')]);
    const r = M.periodRange('mes');
    const f = M.financeSummary({ ops, expenses: exps }, r.from, r.to, cfgBase);
    const n = exps.filter((e) => e.status !== 'anulado' && new Date(e.date) >= r.from && new Date(e.date) < r.to).length;
    el.querySelector('#kpis').innerHTML = [['Gastos operativos del mes', f.opex, 'Entran al resultado'], ['Compras de mercadería del mes', f.purchases, 'Flujo de caja, no resultado'], ['Total pagado del mes', f.opex + f.purchases, `${n} gasto${n === 1 ? '' : 's'} registrado${n === 1 ? '' : 's'}`]]
      .map(([l, v, chip]) => `<div class="card kpi"><div class="kpi-top"><span class="kpi-chip">${esc(chip)}</span></div><div class="kpi-label">${esc(l)}</div><div class="kpi-value num">${esc(money(v))}</div></div>`).join('');
  }
  const t = createTable({
    caption: 'Listado de gastos', pageSize: 10, dateField: 'date', initialSort: { key: 'date', dir: 'desc' },
    empty: { title: 'Todavía no hay gastos', text: 'Registrá el primero con "Registrar gasto".' },
    rowClass: (r) => (r.status === 'anulado' ? 'row-archived' : ''),
    columns: [
      { key: 'date', label: 'Fecha', sortable: true, render: (r) => esc(dateTime(r.date)) },
      { key: 'category', label: 'Categoría', sortable: true, render: (r) => esc(r.category) },
      { key: 'description', label: 'Descripción', sortable: true, render: (r) => `${esc(r.description)}${r.employeeSnapshot ? `<br><span class="muted small">Empleado: ${esc(r.employeeSnapshot.name)}</span>` : ''}${r.supplier ? `<br><span class="muted small">${esc(r.supplier)}</span>` : ''}${r.status === 'anulado' ? `<br><span class="muted small">Motivo: ${esc(r.voidReason || '')}</span>` : ''}` },
      { key: 'paymentMethod', label: 'Método', cls: 'col-lg', render: (r) => esc(METHODS[r.paymentMethod] || r.paymentMethod) },
      { key: 'amount', label: 'Monto', sortable: true, num: true, render: (r) => (r.status === 'anulado' ? `<s>${esc(money(r.amount))}</s>` : esc(money(r.amount))) },
      { key: 'status', label: 'Estado', sortable: true, render: statusBadge },
      { key: 'actions', label: 'Acciones', render: (r) => (r.status === 'anulado' ? '' : `<span class="row-actions"><button type="button" class="btn btn-secondary btn-sm" data-action="void" aria-label="Anular gasto ${esc(r.description)}">Anular</button></span>`) },
    ],
    filters: [
      { key: 'category', label: 'Categoría', options: cfgBase.expenseCategories.map((v) => ({ value: v, label: v })), test: (r, v) => r.category === v },
      { key: 'status', label: 'Estado', options: [{ value: 'registrado', label: 'Registrado' }, { value: 'anulado', label: 'Anulado' }], test: (r, v) => r.status === v },
      { key: 'paymentMethod', label: 'Método', options: Object.entries(METHODS).map(([value, label]) => ({ value, label })), test: (r, v) => r.paymentMethod === v },
    ],
    search: (r) => `${r.description} ${r.category} ${r.supplier || ''} ${r.employeeSnapshot ? r.employeeSnapshot.name : ''}`,
    load: () => repo.list('expenses'),
    async onAction(a, row) {
      try { if (a === 'void' && await voidExpenseFlow(row)) { await paintKpis(); t.refresh(); } } catch (e) { toast(e.message, 'error'); }
    },
  });
  el.querySelector('#tbl').appendChild(t.el);
  const create = async () => { try { if (await newExpense()) { await paintKpis(); t.refresh(); } } catch (e) { toast(e.message, 'error'); } };
  el.querySelector('#newE').addEventListener('click', create);
  await Promise.all([paintKpis(), t.refresh()]);
  if (ctx.query.get('nuevo')) create();
}
