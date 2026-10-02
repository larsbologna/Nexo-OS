// Finanzas: resultado = ventas (no anuladas) − CMV (costo snapshot de cada venta) − gastos operativos.
// Todo se calcula con metrics.js desde operaciones y gastos (nunca desde el estado actual de productos). La compra de mercadería va al flujo de caja, no al resultado.
import * as repo from '../data/repo.js';
import * as M from '../data/metrics.js';
import cfgBase from '../../config.js';
import { getConfig } from '../store.js';
import { icon } from '../ui/icons.js';
import { esc, money, pct, METHODS } from '../ui/format.js';
import { signedMoney } from './_cash.js';

const PERIODS = [['hoy', 'Hoy'], ['mes', 'Mes'], ['trimestre', 'Trimestre'], ['anio', 'Año']];
const P_TXT = { hoy: 'hoy', mes: 'este mes', trimestre: 'este trimestre', anio: 'este año' };
const pctTxt = (v) => (v == null ? 'sin ventas' : pct(v).replace('+', ''));

export async function render(el) {
  let period = 'mes';
  el.innerHTML = `<div class="page-head"><div><h1>Finanzas</h1><p class="sub">Margen real: lo que vendés, lo que te cuesta y lo que gastás.</p></div>
    <div class="seg" role="group" aria-label="Período">${PERIODS.map(([k, l]) => `<button type="button" data-p="${k}" aria-pressed="${k === period}">${l}</button>`).join('')}</div></div>
    <div id="fBody"><div class="grid grid-kpi">${'<div class="skeleton" style="height:130px"></div>'.repeat(4)}</div></div>`;
  const [ops, exps] = await Promise.all([repo.list('operations'), repo.list('expenses')]);

  function paint() {
    const r = M.periodRange(period);
    const f = M.financeSummary({ ops, expenses: exps }, r.from, r.to, cfgBase);
    const mc = M.marginByCategory(ops, r.from, r.to);
    const ec = M.expensesByCategory(exps, r.from, r.to);
    const cf = M.cashflowByMethod(ops, exps, r.from, r.to, getConfig().paymentMethods);
    const maxSales = Math.max(...mc.map((x) => x.sales), 1), maxExp = Math.max(...ec.map((x) => x.total), 1);
    const profit = f.result >= 0;
    el.querySelector('#fBody').innerHTML = `
      <div class="grid grid-kpi">
        <div class="card kpi"><div class="kpi-top"><span class="kpi-ic">${icon('dollar', 18)}</span><span class="kpi-chip">${f.opsCount} venta${f.opsCount === 1 ? '' : 's'}</span></div><div class="kpi-label">Ventas ${P_TXT[period]}</div><div class="kpi-value num">${esc(money(f.sales))}</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-ic">${icon('box', 18)}</span><span class="kpi-chip">Costo al vender</span></div><div class="kpi-label">Costo de mercadería vendida</div><div class="kpi-value num">${esc(money(f.cmv))}</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-ic">${icon('trending', 18)}</span><span class="kpi-chip">${esc(pctTxt(f.grossPct))} de las ventas</span></div><div class="kpi-label">Margen bruto</div><div class="kpi-value num">${esc(signedMoney(f.gross).replace('+', ''))}</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-ic">${icon('receipt', 18)}</span><span class="kpi-chip">${f.expensesCount} gasto${f.expensesCount === 1 ? '' : 's'}</span></div><div class="kpi-label">Gastos operativos</div><div class="kpi-value num">${esc(money(f.opex))}</div></div>
      </div>
      <div style="margin-top:16px">
        <section class="card-invert" aria-labelledby="h-res"><h2 id="h-res" class="k" style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--invert-text-2)">Resultado ${P_TXT[period]}</h2>
          <p class="v num" style="font-size:36px">${esc(signedMoney(f.result).replace('+', ''))}</p>
          <p class="s"><strong>${profit ? 'Ganancia' : 'Pérdida'}</strong> · ${esc(pctTxt(f.resultPct))} de las ventas</p>
          <dl class="kv" style="margin-top:16px;color:#000"><dt>Ventas</dt><dd class="num">${esc(money(f.sales))}</dd><dt>− Costo de mercadería</dt><dd class="num">${esc(money(f.cmv))}</dd><dt>− Gastos operativos</dt><dd class="num">${esc(money(f.opex))}</dd><dt><strong>= Resultado</strong></dt><dd class="num"><strong>${esc(signedMoney(f.result).replace('+', ''))}</strong></dd></dl>
          <p class="s" style="margin-top:12px">Compras de mercadería del período: ${esc(money(f.purchases))} (flujo de caja; su costo ya entra por el costo de lo vendido).</p></section>
      </div>
      <div class="grid" style="margin-top:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))">
        <section class="card" aria-labelledby="h-mc"><div class="card-head"><h2 id="h-mc">Margen por categoría</h2></div>
          ${mc.length ? `<div class="stack" style="gap:16px">${mc.map((x) => `<div class="meter"><div class="meter-top"><span>${esc(x.category)}</span><span class="num">${esc(money(x.sales))} · margen ${esc(pctTxt(x.pct))}</span></div><div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${Math.max(2, Math.round((x.sales / maxSales) * 100))}%"></div></div></div>`).join('')}</div>` : '<div class="empty"><p>Sin ventas en el período.</p></div>'}</section>
        <section class="card" aria-labelledby="h-ec"><div class="card-head"><h2 id="h-ec">Gastos por categoría</h2></div>
          ${ec.length ? `<div class="stack" style="gap:16px">${ec.map((x) => `<div class="meter"><div class="meter-top"><span>${esc(x.category)}${x.category === cfgBase.merchandiseCategory ? ' <span class="badge badge-neutral">No entra al resultado</span>' : ''}</span><span class="num">${esc(money(x.total))}</span></div><div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${Math.max(2, Math.round((x.total / maxExp) * 100))}%"></div></div></div>`).join('')}</div>` : '<div class="empty"><p>Sin gastos en el período.</p></div>'}</section>
      </div>
      <section class="card" style="margin-top:16px" aria-labelledby="h-cf"><div class="card-head"><h2 id="h-cf">Flujo de caja por método</h2></div>
        <div class="table-wrap"><table class="table"><caption class="sr-only">Cobros y pagos por método de pago ${esc(P_TXT[period])}</caption><thead><tr><th scope="col">Método</th><th scope="col" class="num">Cobrado</th><th scope="col" class="num">Pagado (gastos)</th><th scope="col" class="num">Neto</th></tr></thead><tbody>
        ${cf.map((x) => `<tr><td data-label="Método">${esc(METHODS[x.method] || x.method)}</td><td class="num" data-label="Cobrado">${esc(money(x.in))}</td><td class="num" data-label="Pagado">${esc(money(x.out))}</td><td class="num" data-label="Neto"><strong>${esc(signedMoney(x.net).replace('+', ''))}</strong></td></tr>`).join('')}
        <tr><td data-label="Método"><strong>Total</strong></td><td class="num" data-label="Cobrado"><strong>${esc(money(cf.reduce((s, x) => s + Math.round(x.in * 100), 0) / 100))}</strong></td><td class="num" data-label="Pagado"><strong>${esc(money(cf.reduce((s, x) => s + Math.round(x.out * 100), 0) / 100))}</strong></td><td class="num" data-label="Neto"><strong>${esc(signedMoney(cf.reduce((s, x) => s + Math.round(x.net * 100), 0) / 100).replace('+', ''))}</strong></td></tr></tbody></table></div>
        <p class="muted small" style="margin-top:12px">Cobrado = ventas pagadas según su fecha de cobro. Pagado = gastos registrados (incluye compras de mercadería). Los gastos anulados y las ventas anuladas no cuentan.</p></section>`;
  }
  paint();
  el.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
    period = b.dataset.p;
    el.querySelectorAll('[data-p]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    paint();
  }));
}
