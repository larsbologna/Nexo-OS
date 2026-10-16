// Única puerta de datos para las vistas. Todas las funciones devuelven Promise.
// Cambiar de backend = cambiar el import del adapter (misma interfaz).
import adapter from './local.adapter.js';
const buildSeed = async () => (await import('./seed.js')).buildSeed(); // lazy: solo al sembrar
import cfg from '../../config.js';
import { cashSummary, buildClosing, collectedAt, isTracked, minStockOf } from './metrics.js';

// Reloj inyectable (tests de caja, bordes de día). En la app siempre es la hora real.
let clock = () => new Date();
export function setClock(fn) { clock = fn || (() => new Date()); }
const now = () => clock().toISOString();
const cents = (n) => Math.round((Number(n) || 0) * 100);
const CASH_COLS = ['cashSessions', 'cashMovements'];
// Colecciones transaccionales: solo se escriben con las operaciones dedicadas de este módulo (nunca create/update/archive genéricos).
const TX_COLS = ['operations', 'stockMovements', 'expenses'];
const TX_MSG = { operations: 'Las operaciones son inmutables (solo se pueden anular o marcar pagadas).', stockMovements: 'Los movimientos de stock son inmutables (se corrigen con un ajuste).', expenses: 'Los gastos son inmutables (se corrigen anulando y registrando uno nuevo).' };
const isCashMethod = (m) => (cfg.cashMethods || []).includes(m);
// Con cashMethods vacío el módulo Caja queda apagado: no hay avisos ni movimientos de caja (los datos históricos no se tocan).
const cashEnabled = () => (cfg.cashMethods || []).length > 0;
// Serializa las escrituras críticas de caja: evita que dos llamadas concurrentes pasen el mismo chequeo (2 cajas, doble cierre).
let lock = Promise.resolve();
function exclusive(fn) { const p = lock.then(fn); lock = p.catch(() => {}); return p; }
const fmt = (n) => new Intl.NumberFormat(cfg.locale, { style: 'currency', currency: cfg.currency, maximumFractionDigits: 2 }).format(n);
const dayKey =(d) => new Intl.DateTimeFormat('en-CA', { timeZone: cfg.timezone }).format(new Date(d));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
const r2 = (n) => Math.round(n * 100) / 100;
const subs = new Set();
let actor = null;
let ready = null;

function changed(what) { subs.forEach((fn) => { try { fn(what); } catch (e) { console.error(e); } }); }
export function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
export function setActor(userId) { actor = userId; }

export function init() {
  if (!ready) ready = adapter.init(() => buildSeed()).then(() => refreshNotifications());
  return ready;
}
const ensure = async () => { await init(); };

async function audit(action, entity, entityId) {
  await adapter.insert('auditLog', { id: uid(), createdAt: now(), updatedAt: now(), archivedAt: null, action, entity, entityId, userId: actor, date: now() });
}
async function notify(type, message, refType, refId, key) {
  if (key) {
    const all = await adapter.list('notifications');
    if (all.some((n) => n.key === key)) return;
  }
  const t = now();
  await adapter.insert('notifications', { id: uid(), createdAt: t, updatedAt: t, archivedAt: null, type, message, refType, refId, key: key || null, read: false, date: t });
}

const EMP_STATUS = ['activo', 'inactivo'];
function validate(col, d) {
  if (col === 'employees') {
    if (!d.name || !String(d.name).trim()) throw new Error('El nombre es obligatorio.');
    if (!(cfg.employeePositions || []).includes(d.position)) throw new Error('Elegí un puesto.');
    if (!d.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(d.startDate) || Number.isNaN(new Date(`${d.startDate}T00:00:00`).getTime())) throw new Error('La fecha de ingreso es obligatoria.');
    if (!EMP_STATUS.includes(d.status)) throw new Error('Estado inválido.');
    if (d.baseSalary != null && d.baseSalary !== '' && !(Number(d.baseSalary) >= 0)) throw new Error('El sueldo base no puede ser negativo.');
  }
  if (col === 'items') {
    if (!d.name || !String(d.name).trim()) throw new Error('El nombre es obligatorio.');
    if (!(Number(d.price) > 0)) throw new Error('El precio debe ser mayor a 0.');
    if (d.cost != null && d.cost !== '' && !(Number(d.cost) >= 0)) throw new Error('El costo no puede ser negativo.');
    if (d.minStock != null && d.minStock !== '' && !(Number.isInteger(Number(d.minStock)) && Number(d.minStock) >= 0)) throw new Error('El stock mínimo debe ser un entero de 0 o más.');
  }
}
const numOrNull = (v) => (v == null || v === '' ? null : Number(v));

async function insertStockMovement(item, kind, qty, t, extra = {}) {
  const m = await adapter.insert('stockMovements', { id: uid(), createdAt: t, updatedAt: t, archivedAt: null, itemId: item.id, nameSnapshot: item.name, kind, qty, unitCost: null, reason: '', refType: null, refId: null, date: t, userId: actor, ...extra });
  changed('stockMovements');
  return m;
}

/* ---------- CRUD genérico ---------- */
/** opts.archived: false (default, solo activos) | true (solo archivados) | 'all' */
export async function list(col, { archived = false } = {}) {
  await ensure();
  const rows = await adapter.list(col);
  if (archived === 'all') return rows;
  return rows.filter((r) => (archived ? r.archivedAt : !r.archivedAt));
}
export async function get(col, id) { await ensure(); return adapter.get(col, id); }
export async function create(col, data) {
  await ensure();
  if (CASH_COLS.includes(col)) throw new Error('Las cajas y sus movimientos solo se modifican con las operaciones de caja.');
  if (TX_COLS.includes(col)) throw new Error(`${TX_MSG[col]} Usá la operación dedicada del repositorio.`);
  if (col === 'employees') data = { ...data, name: String(data.name || '').trim(), phone: String(data.phone || '').trim(), baseSalary: numOrNull(data.baseSalary) };
  validate(col, data);
  const t = now();
  let rec;
  if (col === 'items') {
    // El saldo inicial se registra como movimiento 'inicial': stock == Σ movimientos desde el alta.
    const type = data.type === 'servicio' ? 'servicio' : 'producto';
    const trackStock = type === 'producto' && !!data.trackStock;
    const initial = trackStock ? Number(data.stock) || 0 : null;
    if (trackStock && !(Number.isInteger(initial) && initial >= 0)) throw new Error('El stock inicial debe ser un entero de 0 o más.');
    rec = await adapter.insert(col, { ...data, type, trackStock, stock: initial, price: Number(data.price), cost: numOrNull(data.cost), minStock: numOrNull(data.minStock), id: uid(), createdAt: t, updatedAt: t, archivedAt: null });
    if (trackStock && initial > 0) await insertStockMovement(rec, 'inicial', initial, t, { reason: 'Stock inicial', refType: 'item', refId: rec.id });
  } else rec = await adapter.insert(col, { ...data, id: uid(), createdAt: t, updatedAt: t, archivedAt: null });
  await audit('create', col, rec.id);
  changed(col);
  return rec;
}
export async function update(col, id, patch) {
  await ensure();
  const cur = await adapter.get(col, id);
  if (!cur) throw new Error('Registro inexistente.');
  if (TX_COLS.includes(col)) throw new Error(TX_MSG[col]);
  if (CASH_COLS.includes(col)) throw new Error('Las cajas y sus movimientos son inmutables (un movimiento se corrige con otro inverso).');
  if (col === 'items') {
    // stock = saldo cacheado que solo cambia junto a su movimiento (venta, anulación, ingreso, ajuste). Tampoco se cambia el tipo ni el control de stock.
    if ('stock' in patch && patch.stock !== cur.stock) throw new Error('El stock solo cambia con ventas, ingresos de mercadería o ajustes.');
    if ('trackStock' in patch && patch.trackStock !== cur.trackStock) throw new Error('No se puede cambiar el control de stock de un producto existente.');
    if ('type' in patch && patch.type !== cur.type) throw new Error('No se puede cambiar el tipo de un ítem existente.');
    const { stock, trackStock, type, ...rest } = patch;
    patch = rest;
    if ('price' in patch) patch.price = Number(patch.price);
    if ('cost' in patch) patch.cost = numOrNull(patch.cost);
    if ('minStock' in patch) patch.minStock = numOrNull(patch.minStock);
  }
  if (col === 'employees' && 'baseSalary' in patch) patch = { ...patch, baseSalary: numOrNull(patch.baseSalary) };
  validate(col, { ...cur, ...patch });
  const rec = await adapter.update(col, id, { ...patch, updatedAt: now() });
  await audit('update', col, id);
  changed(col);
  return rec;
}
/** Archivar NO borra: las operaciones históricas quedan intactas (snapshots). */
export async function archive(col, id) {
  await ensure();
  if (CASH_COLS.includes(col)) throw new Error('Las cajas y sus movimientos no se archivan.');
  if (TX_COLS.includes(col)) throw new Error(TX_MSG[col]);
  const rec = await adapter.update(col, id, { archivedAt: now(), updatedAt: now() });
  await audit('archive', col, id);
  changed(col);
  return rec;
}
export async function restore(col, id) {
  await ensure();
  if (CASH_COLS.includes(col)) throw new Error('Las cajas y sus movimientos no se archivan.');
  if (TX_COLS.includes(col)) throw new Error(TX_MSG[col]);
  const rec = await adapter.update(col, id, { archivedAt: null, updatedAt: now() });
  await audit('restore', col, id);
  changed(col);
  return rec;
}

/** Empleado vigente (existe, no archivado, estado activo) o error con el mensaje dado. */
async function activeEmployee(id, msg) {
  const e = await adapter.get('employees', id);
  if (!e || e.archivedAt || e.status !== 'activo') throw new Error(msg);
  return e;
}

/* ---------- Operaciones (transaccional) ---------- */
/**
 * input: {date?, lines:[{itemId, qty, unitPrice?}], paymentMethod, sellerId?}. Toda venta se registra cobrada (status 'pagada'), sin asociarse a un cliente.
 * sellerId (opcional): empleado activo que vendió; se guarda con sellerSnapshot {name} (editar/archivar el empleado no altera ventas pasadas).
 * D5: si deja stock < 0 y !confirmNegativeStock => {ok:false, needsConfirmation:true, negatives}
 */
export function createOperation(input, { confirmNegativeStock = false, confirmNoCash = false } = {}) {
  return exclusive(async () => {
    await ensure();
    const status = 'pagada';
    const seller = input.sellerId ? await activeEmployee(input.sellerId, 'El vendedor elegido no está disponible.') : null;
    if (!input.lines || !input.lines.length) throw new Error('Agregá al menos una línea.');
    const paymentMethod = input.paymentMethod || 'efectivo';
    if (!cfg.paymentMethods.includes(paymentMethod)) throw new Error('Método de pago inválido.');
    const items = await adapter.list('items');
    const lines = input.lines.map((l) => {
      const it = items.find((x) => x.id === l.itemId);
      if (!it) throw new Error('Producto o servicio inexistente.');
      if (it.archivedAt || it.active === false) throw new Error(`${it.name} no está disponible para la venta.`);
      const qty = Number(l.qty);
      if (!(qty > 0)) throw new Error('La cantidad debe ser mayor a 0.');
      const unitPrice = l.unitPrice != null && l.unitPrice !== '' ? Number(l.unitPrice) : it.price;
      if (!(unitPrice > 0)) throw new Error('El precio debe ser mayor a 0.');
      // Snapshots: costo y categoría del momento de la venta (cambiar el producto después no altera ventas ni Finanzas pasadas)
      return { itemId: it.id, nameSnapshot: it.name, typeSnapshot: it.type, categorySnapshot: it.category || null, costSnapshot: it.cost != null ? Number(it.cost) : 0, qty, unitPrice };
    });
    // stock por item (agregado)
    const need = new Map();
    lines.forEach((l) => { const it = items.find((x) => x.id === l.itemId); if (isTracked(it)) need.set(it.id, (need.get(it.id) || 0) + l.qty); });
    const negatives = [];
    need.forEach((qty, id) => { const it = items.find((x) => x.id === id); if (it.stock - qty < 0) negatives.push({ itemId: id, name: it.name, stock: it.stock, qty }); });
    // D1: venta cobrada en método de caja sin caja abierta => avisar y permitir con confirmación
    const noCash = status === 'pagada' && isCashMethod(paymentMethod) && !(await findOpenSession());
    if ((negatives.length && !confirmNegativeStock) || (noCash && !confirmNoCash)) return { ok: false, needsConfirmation: true, negatives, noCash };

    const t = now();
    const op = await adapter.insert('operations', {
      id: uid(), createdAt: t, updatedAt: t, archivedAt: null,
      date: input.date || t,
      sellerId: seller ? seller.id : null, sellerSnapshot: seller ? { name: seller.name } : null,
      lines, total: r2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)),
      status, paymentMethod,
    });
    for (const [id, qty] of need) {
      const it = items.find((x) => x.id === id);
      const stock = it.stock - qty;
      await adapter.update('items', id, { stock, updatedAt: t });
      const cs = lines.find((l) => l.itemId === id);
      await insertStockMovement(it, 'venta', -qty, t, { unitCost: cs.costSnapshot, refType: 'operation', refId: op.id, reason: 'Venta' });
      if (stock <= minStockOf(it, cfg)) await notify('stock', `Stock bajo: ${it.name} (${stock} u.)`, 'item', id, `stock:${id}:${stock}`);
    }
    await audit('create', 'operations', op.id);
    changed('operations'); if (need.size) changed('items');
    return { ok: true, operation: op };
  });
}

/** Anular repone stock (D5). Idempotente. */
/**
 * D7: si la venta era pagada en método de caja y su cobro NO está en la caja abierta actual (cobrada en una caja ya cerrada),
 * `refunded:true` registra la devolución: retiro "Devolución" con refOpId en la caja abierta, o notificación si no hay caja abierta.
 * Si el cobro está dentro de la caja abierta, la venta anulada simplemente deja de sumar (no se genera retiro: sería doble descuento).
 * El closing de cajas cerradas nunca se toca.
 */
export function voidOperation(id, { refunded = false } = {}) {
  return exclusive(async () => {
    await ensure();
    const op = await adapter.get('operations', id);
    if (!op) throw new Error('Operación inexistente.');
    if (op.status === 'anulada') return op;
    const open = await findOpenSession();
    const wasPaid = op.status === 'pagada';
    const inOpenWindow = !!open && wasPaid && new Date(collectedAt(op)) >= new Date(open.openedAt);
    const t = now();
    const back = new Map();
    for (const l of op.lines) back.set(l.itemId, (back.get(l.itemId) || 0) + l.qty);
    for (const [itemId, qty] of back) {
      const it = await adapter.get('items', itemId);
      if (it && isTracked(it)) {
        await adapter.update('items', it.id, { stock: it.stock + qty, updatedAt: t });
        await insertStockMovement(it, 'anulacion', qty, t, { refType: 'operation', refId: id, reason: 'Anulación de venta' });
      }
    }
    const rec = await adapter.update('operations', id, { status: 'anulada', voidedAt: t, voidedFrom: op.status, updatedAt: t });
    await audit('void', 'operations', id);
    if (refunded && wasPaid && isCashMethod(op.paymentMethod) && !inOpenWindow) {
      if (open) await insertMovement(open.id, 'retiro', op.total, `Devolución: anulación de venta #${id.slice(0, 8)}`, id);
      else await notify('caja', `Registrar devolución de ${fmt(op.total)} al abrir la próxima caja: venta anulada #${id.slice(0, 8)}`, 'operation', id, `caja-anulacion:${id}`);
    }
    changed('operations'); changed('items');
    return rec;
  });
}
/** Para la UI: ¿hay que preguntar si se devolvió el efectivo? (venta en método de caja cobrada fuera de la caja abierta) */
export async function voidPrompt(id) {
  await ensure();
  const op = await adapter.get('operations', id);
  const open = await findOpenSession();
  if (!op || op.status !== 'pagada' || !isCashMethod(op.paymentMethod)) return { askRefund: false, hasOpenCash: !!open };
  const inOpenWindow = !!open && new Date(collectedAt(op)) >= new Date(open.openedAt);
  return { askRefund: !inOpenWindow, hasOpenCash: !!open };
}
/* ---------- Stock (ingresos y ajustes; venta/anulación viven en las operaciones) ---------- */
async function trackedItem(itemId) {
  const it = await adapter.get('items', itemId);
  if (!it) throw new Error('Producto inexistente.');
  if (!isTracked(it)) throw new Error(`${it.name} no controla stock.`);
  return it;
}
/** Ingreso de mercadería: suma stock + movimiento. N4: el último costo unitario informado actualiza items.cost (las ventas pasadas conservan su snapshot). */
export function receiveStock({ itemId, qty, unitCost, supplier }) {
  return exclusive(async () => {
    await ensure();
    const it = await trackedItem(itemId);
    const q = Number(qty);
    if (!(Number.isInteger(q) && q > 0)) throw new Error('La cantidad debe ser un entero mayor a 0.');
    const uc = unitCost === '' || unitCost == null ? null : Number(unitCost);
    if (uc != null && !(uc >= 0)) throw new Error('El costo unitario no puede ser negativo.');
    const t = now();
    const patch = { stock: it.stock + q, updatedAt: t };
    if (uc != null && uc > 0) patch.cost = uc;
    if (supplier && String(supplier).trim() && !it.supplier) patch.supplier = String(supplier).trim();
    await adapter.update('items', it.id, patch);
    const m = await insertStockMovement(it, 'ingreso', q, t, { unitCost: uc, supplier: supplier ? String(supplier).trim() : null, reason: 'Ingreso de mercadería', refType: 'item', refId: it.id });
    await audit('stock_in', 'items', it.id);
    changed('items');
    return m;
  });
}
/** Ajuste ±qty con motivo obligatorio (rotura, conteo, merma…). */
export function adjustStock({ itemId, delta, reason }) {
  return exclusive(async () => {
    await ensure();
    const it = await trackedItem(itemId);
    const d = Number(delta);
    if (!(Number.isInteger(d) && d !== 0)) throw new Error('El ajuste debe ser un entero distinto de 0.');
    if (!String(reason || '').trim()) throw new Error('El motivo del ajuste es obligatorio.');
    const t = now();
    await adapter.update('items', it.id, { stock: it.stock + d, updatedAt: t });
    const m = await insertStockMovement(it, 'ajuste', d, t, { reason: String(reason).trim(), refType: 'item', refId: it.id });
    await audit('stock_adjust', 'items', it.id);
    const stock = it.stock + d;
    if (stock <= minStockOf(it, cfg)) await notify('stock', `Stock bajo: ${it.name} (${stock} u.)`, 'item', it.id, `stock:${it.id}:${stock}`);
    changed('items');
    return m;
  });
}

/* ---------- Gastos (transaccional; corrección = anular + nuevo) ---------- */
/**
 * Gasto en efectivo con caja abierta => retiro "Gasto: …" (refType expense) en esa caja: baja el esperado.
 * Finanzas lo cuenta UNA vez, desde expenses (nunca desde cashMovements).
 * Sin caja abierta => {ok:false, needsConfirmation:true, noCash:true} (patrón D1); confirmado, no genera movimiento.
 */
export function createExpense(input, { confirmNoCash = false } = {}) {
  return exclusive(async () => {
    await ensure();
    const amount = Number(input.amount);
    if (!(cents(amount) > 0)) throw new Error('El monto debe ser mayor a 0.');
    const description = String(input.description || '').trim();
    if (!description) throw new Error('La descripción es obligatoria.');
    const category = String(input.category || '').trim();
    if (!cfg.expenseCategories.includes(category)) throw new Error('Elegí una categoría.');
    const paymentMethod = input.paymentMethod || 'efectivo';
    if (!cfg.paymentMethods.includes(paymentMethod)) throw new Error('Método de pago inválido.');
    // Pago de sueldo vinculado (opcional): solo en la categoría de sueldos y a un empleado no archivado (puede estar inactivo: se le paga lo adeudado)
    let employee = null;
    if (input.employeeId) {
      if (category !== cfg.salaryCategory) throw new Error(`Solo los gastos de «${cfg.salaryCategory}» se vinculan a un empleado.`);
      employee = await adapter.get('employees', input.employeeId);
      if (!employee || employee.archivedAt) throw new Error('El empleado elegido no está disponible.');
    }
    const open = isCashMethod(paymentMethod) ? await findOpenSession() : null;
    if (isCashMethod(paymentMethod) && !open && !confirmNoCash) return { ok: false, needsConfirmation: true, noCash: true };
    const t = now(), id = uid();
    let cashMovementId = null;
    if (open) cashMovementId = (await insertMovement(open.id, 'retiro', amount, `Gasto: ${description}`, null, { refType: 'expense', refId: id })).id;
    const rec = await adapter.insert('expenses', { id, createdAt: t, updatedAt: t, archivedAt: null, date: t, category, description, amount: cents(amount) / 100, paymentMethod, supplier: input.supplier && String(input.supplier).trim() ? String(input.supplier).trim() : null, status: 'registrado', voidedAt: null, voidReason: null, cashMovementId, employeeId: employee ? employee.id : null, employeeSnapshot: employee ? { name: employee.name } : null, userId: actor });
    await audit('create', 'expenses', id);
    changed('expenses');
    return { ok: true, expense: rec };
  });
}
async function expenseSession(e) {
  if (!e.cashMovementId) return null;
  const mv = await adapter.get('cashMovements', e.cashMovementId);
  return mv ? adapter.get('cashSessions', mv.sessionId) : null;
}
/** Para la UI: ¿hay que preguntar si se reintegró el efectivo? (gasto en efectivo descontado de una caja ya cerrada) */
export async function voidExpensePrompt(id) {
  await ensure();
  const e = await adapter.get('expenses', id);
  const s = e && cashEnabled() ? await expenseSession(e) : null;
  return { askRefund: !!s && s.status === 'cerrada', hasOpenCash: cashEnabled() && !!(await findOpenSession()) };
}
/**
 * Anular: reason obligatorio. Gasto en efectivo cuya caja sigue abierta => ingreso compensatorio (el esperado vuelve).
 * Caja ya cerrada => su closing NO cambia; refunded:true registra un ingreso "Reintegro" en la caja abierta (o notificación si no hay).
 */
export function voidExpense(id, { reason, refunded = false } = {}) {
  return exclusive(async () => {
    await ensure();
    const e = await adapter.get('expenses', id);
    if (!e) throw new Error('Gasto inexistente.');
    if (e.status === 'anulado') return e;
    if (!String(reason || '').trim()) throw new Error('El motivo de la anulación es obligatorio.');
    const s = cashEnabled() ? await expenseSession(e) : null;
    const t = now();
    if (s && s.status === 'abierta') await insertMovement(s.id, 'ingreso', e.amount, `Anulación de gasto: ${e.description}`, null, { refType: 'expense', refId: e.id });
    else if (s && refunded) {
      const open = await findOpenSession();
      if (open) await insertMovement(open.id, 'ingreso', e.amount, `Reintegro por gasto anulado: ${e.description}`, null, { refType: 'expense', refId: e.id });
      else await notify('caja', `Registrar el reintegro de ${fmt(e.amount)} al abrir la próxima caja: gasto anulado «${e.description}»`, 'expense', e.id, `caja-gasto:${e.id}`);
    }
    const rec = await adapter.update('expenses', id, { status: 'anulado', voidedAt: t, voidReason: String(reason).trim(), updatedAt: t });
    await audit('void', 'expenses', id);
    changed('expenses');
    return rec;
  });
}

/* ---------- Caja diaria ---------- */
async function findOpenSession() { return (await adapter.list('cashSessions')).find((s) => s.status === 'abierta') || null; }
async function insertMovement(sessionId, kind, amount, reason, refOpId, extra) {
  const t = now();
  const m = await adapter.insert('cashMovements', { id: uid(), createdAt: t, updatedAt: t, archivedAt: null, sessionId, kind, amount: cents(amount) / 100, reason, date: t, userId: actor, ...(refOpId ? { refOpId } : {}), ...(extra || {}) });
  await audit('cash_movement', 'cashMovements', m.id);
  changed('cashMovements');
  return m;
}
/** Estado en vivo: {session, summary} de la caja abierta (o session null). El esperado se calcula, no se guarda. */
export async function cashLive() {
  await ensure();
  const session = await findOpenSession();
  if (!session) return { session: null, summary: null };
  const [ops, movs] = await Promise.all([adapter.list('operations'), adapter.list('cashMovements')]);
  return { session, summary: cashSummary(session, ops, movs, cfg, clock()) };
}
/** Una sola caja abierta a la vez. */
export function openCashSession(openingAmount) {
  return exclusive(async () => {
    await ensure();
    const amount = Number(openingAmount);
    if (openingAmount === '' || openingAmount == null || !Number.isFinite(amount) || amount < 0) throw new Error('El monto inicial debe ser un número mayor o igual a 0.');
    if (await findOpenSession()) throw new Error('Ya hay una caja abierta. Cerrala antes de abrir otra.');
    const t = now();
    const s = await adapter.insert('cashSessions', { id: uid(), createdAt: t, updatedAt: t, archivedAt: null, status: 'abierta', openedAt: t, openedBy: actor, openingAmount: cents(amount) / 100, closedAt: null, closedBy: null, note: '', closing: null });
    await audit('cash_open', 'cashSessions', s.id);
    changed('cashSessions');
    return s;
  });
}
/** Movimiento manual (D2). Un retiro que deja el esperado negativo pide confirmación. */
export function addCashMovement({ kind, amount, reason }, { confirmNegative = false } = {}) {
  return exclusive(async () => {
    await ensure();
    const open = await findOpenSession();
    if (!open) throw new Error('No hay una caja abierta.');
    if (kind !== 'ingreso' && kind !== 'retiro') throw new Error('Elegí ingreso o retiro.');
    if (!(cents(amount) > 0)) throw new Error('El monto debe ser mayor a 0.');
    if (!String(reason || '').trim()) throw new Error('El motivo es obligatorio.');
    if (kind === 'retiro' && !confirmNegative) {
      const [ops, movs] = await Promise.all([adapter.list('operations'), adapter.list('cashMovements')]);
      const expectedAfter = (cents(cashSummary(open, ops, movs, cfg, clock()).expected) - cents(amount)) / 100;
      if (expectedAfter < 0) return { ok: false, needsConfirmation: true, expectedAfter };
    }
    return { ok: true, movement: await insertMovement(open.id, kind, amount, String(reason).trim()) };
  });
}
/** Cierre idempotente: solo si está abierta; recalcula con la función pura y guarda un snapshot inmutable. */
export function closeCashSession(sessionId, { counted, note = '' } = {}) {
  return exclusive(async () => {
    await ensure();
    const s = await adapter.get('cashSessions', sessionId);
    if (!s) throw new Error('Caja inexistente.');
    if (s.status !== 'abierta') throw new Error('Esta caja ya está cerrada.');
    const c = Number(counted);
    if (counted === '' || counted == null || !Number.isFinite(c) || c < 0) throw new Error('El efectivo contado debe ser un número mayor o igual a 0.');
    const [ops, movs] = await Promise.all([adapter.list('operations'), adapter.list('cashMovements')]);
    const t = now();
    const closing = buildClosing(s, ops, movs, cfg, c, t);
    if (cents(Math.abs(closing.difference)) > cents(cfg.cashTolerance) && !String(note).trim()) throw new Error('La diferencia supera la tolerancia: explicala en la nota.');
    const rec = await adapter.update('cashSessions', s.id, { status: 'cerrada', closedAt: t, closedBy: actor, note: String(note).trim(), closing, updatedAt: t });
    await audit('cash_close', 'cashSessions', s.id);
    if (cents(Math.abs(closing.difference)) > cents(cfg.cashTolerance)) await notify('caja', `Caja cerrada con ${closing.difference > 0 ? 'sobrante' : 'faltante'} de ${fmt(Math.abs(closing.difference))}`, 'cashSession', s.id, `caja-dif:${s.id}`);
    changed('cashSessions');
    return rec;
  });
}

/* ---------- Notificaciones ---------- */
export async function unreadCount() { await ensure(); return (await adapter.list('notifications')).filter((n) => !n.read).length; }
export async function markRead(id) { await ensure(); await adapter.update('notifications', id, { read: true, updatedAt: now() }); changed('notifications'); }
export async function markAllRead() {
  await ensure();
  for (const n of await adapter.list('notifications')) if (!n.read) await adapter.update('notifications', n.id, { read: true });
  changed('notifications');
}
/** D6: caja abierta de un turno anterior y stock bajo. Dedupe por key. */
export async function refreshNotifications() {
  const items = await adapter.list('items');
  // Caja abierta de un día anterior o hace más de cashStaleHours (D5: sin cierre automático, solo aviso). Dedupe por key.
  const open = cashEnabled() ? await findOpenSession() : null;
  if (open && (dayKey(open.openedAt) !== dayKey(clock()) || clock().getTime() - new Date(open.openedAt).getTime() > cfg.cashStaleHours * 3600000)) {
    await notify('caja', 'Hay una caja abierta desde un turno anterior. Contá el efectivo y cerrala.', 'cashSession', open.id, `caja-abierta:${open.id}`);
  }
  for (const i of items) if (!i.archivedAt && i.active !== false && isTracked(i) && i.stock <= minStockOf(i, cfg)) await notify('stock', `Stock bajo: ${i.name} (${i.stock} u.)`, 'item', i.id, `stock:${i.id}:${i.stock}`);
}

/* ---------- Settings / usuarios / demo ---------- */
export async function getSettings() { await ensure(); return (await adapter.list('settings'))[0] || { id: 'main', branding: {}, business: {}, paymentMethods: null }; }
export async function saveSettings(patch) {
  await ensure();
  const cur = await adapter.get('settings', 'main');
  if (!cur) return adapter.insert('settings', { id: 'main', createdAt: now(), updatedAt: now(), archivedAt: null, branding: {}, business: {}, paymentMethods: null, ...patch });
  return adapter.update('settings', 'main', { ...patch, updatedAt: now() });
}
export async function getUserByEmail(email) {
  await ensure();
  return (await adapter.list('users')).find((u) => u.email.toLowerCase() === String(email).trim().toLowerCase() && !u.archivedAt) || null;
}
export async function getUser(id) { await ensure(); return adapter.get('users', id); }
export async function resetDemo() {
  await ensure();
  await adapter.reset(await buildSeed());
  await refreshNotifications();
  changed('reset');
}
/** Exporta todo salvo credenciales. */
export async function exportAll() {
  await ensure();
  const d = await adapter.dump();
  d.users = d.users.map(({ passHash, salt, ...u }) => u);
  return { exportedAt: now(), schema: 6, data: d };
}
