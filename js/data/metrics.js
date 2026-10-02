// Cálculos puros (sin DOM, sin storage). Entrada: arrays de operations/items/expenses.
// Regla: los ingresos salen SOLO de operations con status 'pagada' (las anuladas no cuentan).
const r2 = (n) => Math.round(n * 100) / 100;
const ts = (d) => (d instanceof Date ? d : new Date(d)).getTime();

export const isPaid = (o) => o.status === 'pagada';
export const isLive = (o) => o.status !== 'anulada';
export const inRange = (o, from, to) => { const t = ts(o.date); return t >= ts(from) && t < ts(to); };

/** period: 'mes' | 'trimestre' | 'anio'. Devuelve rangos [from,to) actual y anterior. */
export function periodRange(period, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth();
  let from, to, prevFrom;
  if (period === 'hoy') { const d = now.getDate(); from = new Date(y, m, d); to = new Date(y, m, d + 1); prevFrom = new Date(y, m, d - 1); }
  else if (period === 'anio') { from = new Date(y, 0, 1); to = new Date(y + 1, 0, 1); prevFrom = new Date(y - 1, 0, 1); }
  else if (period === 'trimestre') { const q = Math.floor(m / 3) * 3; from = new Date(y, q, 1); to = new Date(y, q + 3, 1); prevFrom = new Date(y, q - 3, 1); }
  else { from = new Date(y, m, 1); to = new Date(y, m + 1, 1); prevFrom = new Date(y, m - 1, 1); }
  return { from, to, prevFrom, prevTo: from };
}

export function revenue(ops, from, to) {
  return r2(ops.filter((o) => isPaid(o) && inRange(o, from, to)).reduce((s, o) => s + o.total, 0));
}
const delta = (cur, prev) => (prev > 0 ? r2(((cur - prev) / prev) * 100) : null);

export function kpis(ops, period, now = new Date()) {
  const r = periodRange(period, now);
  const cur = ops.filter((o) => inRange(o, r.from, r.to));
  const prv = ops.filter((o) => inRange(o, r.prevFrom, r.prevTo));
  const stats = (list) => {
    const paid = list.filter(isPaid);
    const rev = r2(paid.reduce((s, o) => s + o.total, 0));
    return { revenue: rev, count: list.filter(isLive).length, avg: paid.length ? r2(rev / paid.length) : 0 };
  };
  const c = stats(cur), p = stats(prv);
  return {
    range: r,
    revenue: c.revenue, revenuePrev: p.revenue, revenueDelta: delta(c.revenue, p.revenue),
    count: c.count, countPrev: p.count, countDelta: delta(c.count, p.count),
    avg: c.avg, avgPrev: p.avg, avgDelta: delta(c.avg, p.avg),
  };
}

/** Ingresos por mes de los últimos n meses (incluye el actual). */
export function monthlySeries(ops, months = 12, now = new Date()) {
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    out.push({ start, value: revenue(ops, start, end) });
  }
  return out;
}

/** Ingresos por tipo (producto/servicio) según snapshot de línea, sobre operaciones pagadas. */
export function splitByType(ops, from, to) {
  const res = { producto: 0, servicio: 0 };
  ops.filter((o) => isPaid(o) && inRange(o, from, to)).forEach((o) => o.lines.forEach((l) => {
    const k = l.typeSnapshot === 'servicio' ? 'servicio' : 'producto';
    res[k] += l.qty * l.unitPrice;
  }));
  res.producto = r2(res.producto); res.servicio = r2(res.servicio);
  return res;
}

export function topItems(ops, from, to, n = 5) {
  const m = new Map();
  ops.filter((o) => isPaid(o) && inRange(o, from, to)).forEach((o) => o.lines.forEach((l) => {
    const e = m.get(l.itemId) || { itemId: l.itemId, name: l.nameSnapshot, total: 0, qty: 0 };
    e.total += l.qty * l.unitPrice; e.qty += l.qty; m.set(l.itemId, e);
  }));
  return [...m.values()].map((e) => ({ ...e, total: r2(e.total) })).sort((a, b) => b.total - a.total).slice(0, n);
}

/* ---------- Caja diaria (puro) ---------- */
// Dinero en centavos enteros (sin errores de float). Fecha de cobro = paidAt (si se cobró después) o date.
const cents = (n) => Math.round((Number(n) || 0) * 100);
export const collectedAt = (o) => o.paidAt || o.date;

/**
 * Resumen de una caja. Ventana = [openedAt, closedAt ?? now] (extremos incluidos).
 * cashSales = Σ total de ops PAGADAS con método de caja cobradas dentro de la ventana.
 * expected = openingAmount + cashSales + movementsIn − movementsOut. Se recalcula siempre; nunca se guarda un saldo mutable.
 * Una venta anulada nunca suma; anular después del cierre no resta sola (D7): solo un retiro "Devolución" explícito.
 */
export function cashSummary(session, ops, movements, cfg, now = new Date()) {
  const from = ts(session.openedAt);
  const to = session.closedAt ? ts(session.closedAt) : ts(now);
  const methods = (cfg && cfg.cashMethods) || ['efectivo'];
  const included = ops.filter((o) => {
    if (!isPaid(o) || !methods.includes(o.paymentMethod)) return false;
    const t = ts(collectedAt(o));
    return t >= from && t <= to;
  });
  const mine = movements.filter((m) => m.sessionId === session.id);
  const sum = (list) => list.reduce((s, x) => s + cents(x.amount), 0);
  const sales = included.reduce((s, o) => s + cents(o.total), 0);
  const inn = sum(mine.filter((m) => m.kind === 'ingreso'));
  const out = sum(mine.filter((m) => m.kind === 'retiro'));
  const expected = cents(session.openingAmount) + sales + inn - out;
  return { cashSales: sales / 100, movementsIn: inn / 100, movementsOut: out / 100, expected: expected / 100, opCount: included.length, ops: included, movements: mine };
}

/** Snapshot inmutable de cierre, con la misma función pura que el resumen en vivo. */
export function buildClosing(session, ops, movements, cfg, counted, closedAtIso) {
  const s = cashSummary({ ...session, closedAt: closedAtIso }, ops, movements, cfg, closedAtIso);
  return {
    cashSales: s.cashSales, movementsIn: s.movementsIn, movementsOut: s.movementsOut, expected: s.expected,
    counted: r2(counted), difference: (cents(counted) - cents(s.expected)) / 100, opCount: s.opCount, computedAt: closedAtIso,
  };
}

/** Derivado (no guardado): ventas de una caja cerrada anuladas DESPUÉS del cierre (voidedFrom 'pagada'). */
export function cashLateVoids(session, ops, cfg) {
  if (!session || session.status !== 'cerrada' || !session.closedAt) return { total: 0, count: 0, ops: [] };
  const from = ts(session.openedAt), to = ts(session.closedAt);
  const methods = (cfg && cfg.cashMethods) || ['efectivo'];
  const list = ops.filter((o) => o.status === 'anulada' && o.voidedFrom === 'pagada' && methods.includes(o.paymentMethod)
    && ts(collectedAt(o)) >= from && ts(collectedAt(o)) <= to && o.voidedAt && ts(o.voidedAt) > to);
  return { total: list.reduce((s, o) => s + cents(o.total), 0) / 100, count: list.length, ops: list };
}

export const recentOperations = (ops, n = 8) => [...ops].sort((a, b) => ts(b.date) - ts(a.date)).slice(0, n);

/* ---------- Nexo: inventario, gastos y finanzas (puro; nada de esto se guarda) ---------- */
const startOfDay = (d) => { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate()); };
export const localDayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const c100 = (n) => Math.round((Number(n) || 0) * 100);

/** Un producto "controla stock" si tiene saldo numérico (los servicios y productos sin control tienen stock null). */
export const isTracked = (it) => it.type === 'producto' && it.stock != null;
export const minStockOf = (it, cfg) => (it.minStock != null && it.minStock !== '' ? Number(it.minStock) : ((cfg && cfg.lowStockThreshold) || 0));
export const isCriticalItem = (it, cfg) => !it.archivedAt && it.active !== false && isTracked(it) && it.stock <= minStockOf(it, cfg);
export const criticalProducts = (items, cfg) => items.filter((i) => isCriticalItem(i, cfg));
/** Invariante: items.stock == Σ stockMovements.qty (el saldo cacheado se puede auditar con esta función). */
export const stockFromMovements = (movements, itemId) => movements.filter((m) => m.itemId === itemId).reduce((s, m) => s + m.qty, 0);

/** Ventas (no anuladas) por día local, de más antiguo a hoy. */
export function salesByDay(ops, days = 7, now = new Date()) {
  const today = startOfDay(now);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i + 1);
    const list = ops.filter((o) => isLive(o) && inRange(o, from, to));
    out.push({ day: localDayKey(from), date: from, value: list.reduce((s, o) => s + c100(o.total), 0) / 100, count: list.length });
  }
  return out;
}

/**
 * Resultado del rango [from,to): ventas (no anuladas) − CMV (Σ qty × costSnapshot) − gastos operativos.
 * Los gastos anulados no cuentan. La categoría de compra de mercadería NO va al resultado (su costo entra por CMV al vender): va a `purchases` (informativo) y al flujo de caja.
 */
export function financeSummary({ ops, expenses }, from, to, cfg) {
  const merch = (cfg && cfg.merchandiseCategory) || 'Compra de mercadería';
  const live = ops.filter((o) => isLive(o) && inRange(o, from, to));
  const sales = live.reduce((s, o) => s + c100(o.total), 0);
  const cmv = live.reduce((s, o) => s + o.lines.reduce((a, l) => a + c100(l.qty * (l.costSnapshot || 0)), 0), 0);
  const exps = expenses.filter((e) => e.status !== 'anulado' && inRange(e, from, to));
  const opex = exps.filter((e) => e.category !== merch).reduce((s, e) => s + c100(e.amount), 0);
  const purchases = exps.filter((e) => e.category === merch).reduce((s, e) => s + c100(e.amount), 0);
  const gross = sales - cmv, result = gross - opex;
  const pct = (n) => (sales > 0 ? Math.round((n / sales) * 1000) / 10 : null);
  return { sales: sales / 100, cmv: cmv / 100, gross: gross / 100, grossPct: pct(gross), opex: opex / 100, purchases: purchases / 100, result: result / 100, resultPct: pct(result), opsCount: live.length, expensesCount: exps.length };
}

/** Margen por categoría (snapshot de la línea, no la categoría actual del producto). */
export function marginByCategory(ops, from, to) {
  const m = new Map();
  ops.filter((o) => isLive(o) && inRange(o, from, to)).forEach((o) => o.lines.forEach((l) => {
    const k = l.categorySnapshot || 'Sin categoría';
    const e = m.get(k) || { category: k, sales: 0, cmv: 0 };
    e.sales += c100(l.qty * l.unitPrice); e.cmv += c100(l.qty * (l.costSnapshot || 0)); m.set(k, e);
  }));
  return [...m.values()].map((e) => ({ category: e.category, sales: e.sales / 100, cmv: e.cmv / 100, margin: (e.sales - e.cmv) / 100, pct: e.sales > 0 ? Math.round(((e.sales - e.cmv) / e.sales) * 1000) / 10 : null })).sort((a, b) => b.sales - a.sales);
}

/** Flujo de caja por método: cobros (ops pagadas por fecha de cobro) − gastos registrados (todas las categorías, incl. compra de mercadería). */
export function cashflowByMethod(ops, expenses, from, to, methods = []) {
  const acc = new Map(methods.map((k) => [k, { method: k, in: 0, out: 0 }]));
  const get = (k) => { if (!acc.has(k)) acc.set(k, { method: k, in: 0, out: 0 }); return acc.get(k); };
  ops.filter((o) => isPaid(o) && ts(collectedAt(o)) >= ts(from) && ts(collectedAt(o)) < ts(to)).forEach((o) => { get(o.paymentMethod).in += c100(o.total); });
  expenses.filter((e) => e.status !== 'anulado' && inRange(e, from, to)).forEach((e) => { get(e.paymentMethod).out += c100(e.amount); });
  return [...acc.values()].map((e) => ({ method: e.method, in: e.in / 100, out: e.out / 100, net: (e.in - e.out) / 100 }));
}

export function expensesByCategory(expenses, from, to) {
  const m = new Map();
  expenses.filter((e) => e.status !== 'anulado' && inRange(e, from, to)).forEach((e) => { const x = m.get(e.category) || { category: e.category, total: 0, count: 0 }; x.total += c100(e.amount); x.count++; m.set(e.category, x); });
  return [...m.values()].map((e) => ({ ...e, total: e.total / 100 })).sort((a, b) => b.total - a.total);
}

/**
 * Ventas por vendedor del rango [from,to) (no anuladas), desde el snapshot de cada venta: renombrar o archivar un empleado
 * no altera el pasado. Clave null = "Sin vendedor". Devuelve [{sellerId, name, total, count}] ordenado por total desc.
 */
export function salesBySeller(ops, from, to) {
  const m = new Map();
  ops.filter((o) => isLive(o) && inRange(o, from, to)).forEach((o) => {
    const k = o.sellerId || null;
    const e = m.get(k) || { sellerId: k, name: null, ts: -Infinity, total: 0, count: 0 };
    if (k && ts(o.date) >= e.ts) { e.ts = ts(o.date); e.name = (o.sellerSnapshot && o.sellerSnapshot.name) || 'Vendedor'; } // nombre de la venta más reciente
    e.total += c100(o.total); e.count++; m.set(k, e);
  });
  return [...m.values()].map(({ ts: _t, ...e }) => ({ ...e, total: e.total / 100 })).sort((a, b) => b.total - a.total);
}

/** KPIs del día: ventas, tickets, ticket promedio, margen bruto (ventas − CMV), críticos. */
export function kpisHoy(ops, items, now = new Date(), cfg) {
  const from = startOfDay(now), to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1), yFrom = new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1);
  const f = financeSummary({ ops, expenses: [] }, from, to, cfg);
  const y = financeSummary({ ops, expenses: [] }, yFrom, from, cfg);
  return { sales: f.sales, tickets: f.opsCount, avgTicket: f.opsCount ? Math.round((f.sales / f.opsCount) * 100) / 100 : 0, grossMargin: f.gross, grossPct: f.grossPct, salesYesterday: y.sales, ticketsYesterday: y.opsCount, critical: criticalProducts(items, cfg).length };
}
