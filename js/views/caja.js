// Caja diaria: estado (abrir/cerrar), movimientos manuales e historial. Los números salen de metrics.cashSummary (esperado calculado, nunca guardado).
import * as repo from '../data/repo.js';
import * as M from '../data/metrics.js';
import cfg from '../../config.js';
import { createTable } from '../ui/table.js';
import { buildForm } from '../ui/form.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { esc, money, dateTime, badge } from '../ui/format.js';
import { diffBadge, diffLabel, signedMoney } from './_cash.js';

const cents = (n) => Math.round((Number(n) || 0) * 100);
const KIND = { ingreso: ['success', 'Ingreso'], retiro: ['warning', 'Retiro'] };
const moveSigned = (m) => signedMoney(m.kind === 'ingreso' ? m.amount : -m.amount);
const lateBadge = (l) => (l.count ? `<span class="badge badge-warning">Anulada después del cierre: ${esc(money(l.total))}</span>` : '');

function movesTable(movs, caption) {
  if (!movs.length) return '<p class="muted small">Sin movimientos manuales.</p>';
  return `<div class="table-wrap"><table class="table"><caption class="sr-only">${esc(caption)}</caption><thead><tr><th scope="col">Hora</th><th scope="col">Tipo</th><th scope="col" class="num">Monto</th><th scope="col">Motivo</th></tr></thead><tbody>
    ${movs.map((m) => `<tr><td data-label="Hora">${esc(dateTime(m.date))}</td><td data-label="Tipo"><span class="badge badge-${KIND[m.kind][0]}">${KIND[m.kind][1]}</span></td><td class="num" data-label="Monto">${esc(moveSigned(m))}</td><td data-label="Motivo">${esc(m.reason)}</td></tr>`).join('')}</tbody></table></div>`;
}

function openCashModal() {
  return openModal({
    title: 'Abrir caja', size: 'sm',
    build(body, api) {
      const f = buildForm({
        fields: [{ name: 'openingAmount', label: 'Efectivo inicial en caja', type: 'number', required: true, min: 0, step: '0.01', hint: 'Contá el efectivo con el que empezás el turno.' }],
        submitLabel: 'Abrir caja', onCancel: () => api.close(false),
        async onSubmit(v) { await repo.openCashSession(v.openingAmount); toast('Caja abierta.', 'success'); api.close(true); },
      });
      body.appendChild(f.el);
    },
  });
}

function movementModal() {
  return openModal({
    title: 'Registrar movimiento', size: 'sm',
    build(body, api) {
      const f = buildForm({
        fields: [
          { name: 'kind', label: 'Tipo', type: 'select', required: true, options: [{ value: 'retiro', label: 'Retiro (sale efectivo)' }, { value: 'ingreso', label: 'Ingreso (entra efectivo)' }] },
          { name: 'amount', label: 'Monto', type: 'number', required: true, min: 0.01, step: '0.01' },
          { name: 'reason', label: 'Motivo', required: true, span: 2, hint: 'Obligatorio. Un movimiento no se edita: se corrige con otro inverso.' },
        ],
        values: { kind: 'retiro' }, submitLabel: 'Registrar', onCancel: () => api.close(false),
        async onSubmit(v) {
          const input = { kind: v.kind, amount: Number(v.amount), reason: v.reason };
          let res = await repo.addCashMovement(input);
          if (res.needsConfirmation) {
            const ok = await confirmDialog({ title: 'El esperado quedaría negativo', danger: true, confirmText: 'Registrar igualmente', message: `Este retiro deja el efectivo esperado en ${signedMoney(res.expectedAfter)}. ¿Confirmás el retiro?` });
            if (!ok) return;
            res = await repo.addCashMovement(input, { confirmNegative: true });
          }
          toast('Movimiento registrado.', 'success');
          api.close(true);
        },
      });
      body.appendChild(f.el);
    },
  });
}

function closeModal(session, summary) {
  const expected = summary.expected;
  const tol = cfg.cashTolerance;
  const diffOf = (all) => (all.counted === '' || !Number.isFinite(Number(all.counted)) ? null : (cents(all.counted) - cents(expected)) / 100);
  return openModal({
    title: 'Cerrar caja', size: 'md',
    build(body, api) {
      const f = buildForm({
        fields: [
          { name: 'counted', label: 'Efectivo contado', type: 'number', required: true, min: 0, step: '0.01', hint: `Esperado según el sistema: ${money(expected)}.` },
          { name: 'note', label: 'Nota', type: 'textarea', span: 2, hint: `Obligatoria si la diferencia supera ${money(tol)}.`,
            validators: [(v, all) => { const d = diffOf(all); return d !== null && cents(Math.abs(d)) > cents(tol) && !String(v).trim() ? `Explicá la diferencia: supera la tolerancia de ${money(tol)}.` : ''; }] },
        ],
        submitLabel: 'Cerrar caja', submitClass: 'btn-accent', onCancel: () => api.close(false),
        // Visual en vivo por tecla; el anuncio al lector va en una región aparte con debounce (sin valores intermedios)
        extra: '<p class="cash-diff" id="cashDiff">Ingresá el efectivo contado para ver la diferencia.</p><p class="sr-only" id="cashDiffLive" role="status" aria-live="polite"></p>',
        async onSubmit(v) {
          const d = diffOf(v);
          const ok = await confirmDialog({ title: 'Confirmar cierre de caja', confirmText: 'Cerrar caja', message: `Contaste ${money(Number(v.counted))} y se esperaban ${money(expected)}: ${diffLabel(d)}. El cierre no se puede modificar.` });
          if (!ok) return;
          const rec = await repo.closeCashSession(session.id, { counted: Number(v.counted), note: v.note });
          toast(`Caja cerrada. ${diffLabel(rec.closing.difference)}.`, 'success');
          api.close(true);
        },
      });
      body.appendChild(f.el);
      const out = f.el.querySelector('#cashDiff'), live = f.el.querySelector('#cashDiffLive');
      let liveTimer = 0;
      f.el.elements.counted.addEventListener('input', () => {
        const d = diffOf(f.getValues());
        clearTimeout(liveTimer);
        if (d === null) { out.className = 'cash-diff'; out.textContent = 'Ingresá el efectivo contado para ver la diferencia.'; live.textContent = ''; return; }
        out.className = `cash-diff ${!d ? 'is-ok' : d > 0 ? 'is-over' : 'is-short'}`;
        out.textContent = `${diffLabel(d)}${cents(Math.abs(d)) > cents(tol) ? ` — supera la tolerancia (${money(tol)}): la nota es obligatoria` : ''}`;
        liveTimer = setTimeout(() => { live.textContent = out.textContent; }, 700);
      });
    },
  });
}

async function showCash(session, ops) {
  const [movs, opener] = await Promise.all([repo.list('cashMovements'), session.openedBy ? repo.getUser(session.openedBy) : null]);
  const s = M.cashSummary(session, ops, movs, cfg);
  const late = M.cashLateVoids(session, ops, cfg);
  const c = session.closing;
  const rows = [...s.ops.map((o) => ({ o, late: false })), ...late.ops.map((o) => ({ o, late: true }))].sort((a, b) => M.collectedAt(a.o).localeCompare(M.collectedAt(b.o)));
  await openModal({
    title: `Caja del ${dateTime(session.openedAt)}`, size: 'lg',
    build(body, api) {
      body.innerHTML = `<dl class="kv"><dt>Apertura</dt><dd>${esc(dateTime(session.openedAt))}${opener ? ` · ${esc(opener.name)}` : ''}</dd><dt>Cierre</dt><dd>${esc(dateTime(session.closedAt))}</dd>
        <dt>Efectivo inicial</dt><dd class="num">${esc(money(session.openingAmount))}</dd><dt>Ventas en efectivo</dt><dd class="num">${esc(money(c.cashSales))} (${c.opCount} venta${c.opCount === 1 ? '' : 's'})</dd>
        <dt>Ingresos</dt><dd class="num">${esc(money(c.movementsIn))}</dd><dt>Retiros</dt><dd class="num">${esc(money(c.movementsOut))}</dd>
        <dt>Esperado</dt><dd class="num">${esc(money(c.expected))}</dd><dt>Contado</dt><dd class="num">${esc(money(c.counted))}</dd>
        <dt>Diferencia</dt><dd>${diffBadge(c.difference)}</dd>${session.note ? `<dt>Nota</dt><dd>${esc(session.note)}</dd>` : ''}</dl>
        ${late.count ? `<p class="demo-banner" style="margin-top:16px">${lateBadge(late)} Este cierre no cambia. Si se devolvió el efectivo, se registra como retiro «Devolución» en la caja abierta.</p>` : ''}
        <h3 style="margin-top:20px;font-size:var(--fs-md)">Ventas en efectivo incluidas</h3>
        ${rows.length ? `<div class="table-wrap"><table class="table"><caption class="sr-only">Ventas en efectivo de esta caja</caption><thead><tr><th scope="col">Cobro</th><th scope="col">Ticket</th><th scope="col" class="num">Total</th><th scope="col">Estado</th></tr></thead><tbody>
        ${rows.map(({ o, late: l }) => `<tr><td data-label="Cobro">${esc(dateTime(M.collectedAt(o)))}</td><td data-label="Ticket">#${esc(o.id.slice(0, 8))}</td><td class="num" data-label="Total">${esc(money(o.total))}</td><td data-label="Estado">${l ? '<span class="badge badge-warning">Anulada después del cierre</span>' : badge(o.status)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Sin ventas en efectivo.</p>'}
        <h3 style="margin-top:20px;font-size:var(--fs-md)">Movimientos</h3>${movesTable(s.movements, 'Movimientos de esta caja')}
        <div class="modal-actions"><button type="button" class="btn btn-secondary" data-close>Cerrar</button></div>`;
      body.querySelector('[data-close]').addEventListener('click', () => api.close());
    },
  });
}

export async function render(el) {
  await repo.refreshNotifications().catch((e) => console.error(e));
  el.innerHTML = `<div class="page-head"><div><h1>Caja</h1><p class="sub">Apertura, movimientos, cierre y diferencia del efectivo.</p></div></div>
    <div class="stack">
      <section class="card" aria-labelledby="h-estado" id="cState"></section>
      <section class="card" aria-labelledby="h-movs" id="cMovs" hidden></section>
      <section aria-labelledby="h-hist"><h2 id="h-hist" class="section-title">Historial de cajas</h2><div id="cHist"></div></section>
    </div>`;
  let opsCache = [];

  const t = createTable({
    caption: 'Historial de cajas cerradas', pageSize: 10, dateField: 'openedAt', initialSort: { key: 'openedAt', dir: 'desc' },
    empty: { title: 'Todavía no hay cajas cerradas', text: 'Al cerrar la primera caja aparecerá acá.' },
    columns: [
      { key: 'openedAt', label: 'Apertura', sortable: true, render: (r) => esc(dateTime(r.openedAt)) },
      { key: 'expected', label: 'Esperado', sortable: true, num: true, value: (r) => r.closing.expected, render: (r) => esc(money(r.closing.expected)) },
      { key: 'counted', label: 'Contado', sortable: true, num: true, value: (r) => r.closing.counted, render: (r) => esc(money(r.closing.counted)) },
      { key: 'difference', label: 'Diferencia', sortable: true, num: true, value: (r) => r.closing.difference, render: (r) => diffBadge(r.closing.difference) },
      { key: 'avisos', label: 'Avisos', render: (r) => lateBadge(r._late) },
      { key: 'actions', label: 'Acciones', render: (r) => `<span class="row-actions"><button type="button" class="btn btn-secondary btn-sm" data-action="view" aria-label="Ver detalle de la caja del ${esc(dateTime(r.openedAt))}">Ver</button></span>` },
    ],
    filters: [{ key: 'dif', label: 'Diferencia', options: [{ value: 'con', label: 'Con diferencia' }, { value: 'sin', label: 'Sin diferencia' }], test: (r, v) => (v === 'con' ? r.closing.difference !== 0 : r.closing.difference === 0) }],
    search: (r) => `${dateTime(r.openedAt)} ${r.note || ''}`,
    load: async () => {
      const [sessions, ops] = await Promise.all([repo.list('cashSessions'), repo.list('operations')]);
      opsCache = ops;
      return sessions.filter((s) => s.status === 'cerrada').map((s) => ({ ...s, _late: M.cashLateVoids(s, ops, cfg) }));
    },
    onAction: (a, row) => showCash(row, opsCache),
  });
  el.querySelector('#cHist').appendChild(t.el);

  async function paint() {
    const { session, summary } = await repo.cashLive();
    const st = el.querySelector('#cState');
    if (!st || !el.isConnected) return; // se navegó a otra ruta mientras se esperaba el repo
    if (session) {
      st.innerHTML = `<div class="card-head"><h2 id="h-estado">Caja abierta</h2><span class="badge badge-success">Abierta</span></div>
        <p class="muted small" style="margin-bottom:16px">Abierta desde ${esc(dateTime(session.openedAt))} · efectivo inicial ${esc(money(session.openingAmount))}</p>
        <div class="cash-grid">
          <div class="card-invert"><div class="k">Efectivo esperado ahora</div><div class="v num" id="cashExpected">${esc(money(summary.expected))}</div><div class="s">Inicial + ventas en efectivo + ingresos − retiros</div></div>
          <div class="card kpi"><div class="kpi-label" style="margin-top:0">Ventas en efectivo</div><div class="kpi-value num">${esc(money(summary.cashSales))}</div><div class="kpi-delta">${summary.opCount} venta${summary.opCount === 1 ? '' : 's'}</div></div>
          <div class="card kpi"><div class="kpi-label" style="margin-top:0">Ingresos</div><div class="kpi-value num">${esc(money(summary.movementsIn))}</div></div>
          <div class="card kpi"><div class="kpi-label" style="margin-top:0">Retiros</div><div class="kpi-value num">${esc(money(summary.movementsOut))}</div></div>
        </div>
        <p class="muted small" style="margin-top:16px">Solo el efectivo suma a la caja; tarjeta, transferencia y QR no. Los gastos en efectivo salen de acá. El cierre queda guardado y no se modifica, aunque después se anule una venta o un gasto.</p>
        <div class="row" style="margin-top:12px"><button type="button" class="btn btn-secondary" id="addMove">Registrar movimiento</button><button type="button" class="btn btn-accent" id="closeCash">Cerrar caja</button></div>`;
      st.querySelector('#addMove').addEventListener('click', async () => { if (await movementModal()) await paint(); });
      st.querySelector('#closeCash').addEventListener('click', async () => {
        const live = await repo.cashLive();
        if (!live.session) return paint();
        if (await closeModal(live.session, live.summary)) { await paint(); }
      });
      const mv = el.querySelector('#cMovs');
      mv.hidden = false;
      mv.innerHTML = `<div class="card-head"><h2 id="h-movs">Movimientos de la caja abierta</h2></div>${movesTable(summary.movements, 'Movimientos de la caja abierta')}`;
    } else {
      const last = (await repo.list('cashSessions')).filter((s) => s.status === 'cerrada').sort((a, b) => b.closedAt.localeCompare(a.closedAt))[0];
      st.innerHTML = `<div class="card-head"><h2 id="h-estado">No hay caja abierta</h2><span class="badge badge-neutral">Cerrada</span></div>
        <p>${last ? `Último cierre: ${esc(dateTime(last.closedAt))} · esperado ${esc(money(last.closing.expected))}, contado ${esc(money(last.closing.counted))} · ${diffBadge(last.closing.difference)}` : 'Todavía no se abrió ninguna caja.'}</p>
        <p class="muted small">Abrí la caja con el efectivo inicial del turno. Solo el efectivo cuenta para la caja (tarjeta, transferencia y QR no).</p>
        <div class="row" style="margin-top:12px"><button type="button" class="btn btn-primary" id="openCash">Abrir caja</button></div>`;
      st.querySelector('#openCash').addEventListener('click', async () => { if (await openCashModal()) await paint(); });
      el.querySelector('#cMovs').hidden = true;
    }
    await t.refresh();
  }
  await paint();
}
