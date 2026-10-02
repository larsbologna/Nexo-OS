// Datos demo de un local de indumentaria (re-sembrables). Determinista (PRNG con semilla) y relativo a "hoy".
// El usuario demo trae SOLO hash+salt (SHA-256(salt+clave)); la clave vive en README/banner de login, nunca acá ni en storage.
// Todo lo derivado sale de registros transaccionales: cada closing de caja se calcula con la MISMA función pura de metrics.js
// (buildClosing), y el stock de cada producto es exactamente la suma de sus movimientos (inicial + ingresos − ventas + anulaciones ± ajustes).
import cfg from '../../config.js';
import { buildClosing } from './metrics.js';

export const DEMO_EMAIL = 'admin@demo.local';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


export function buildSeed(now = new Date()) {
  const rnd = mulberry32(20260929);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const chance = (p) => rnd() < p;
  const uuid = () => {
    const h = () => Math.floor(rnd() * 65536).toString(16).padStart(4, '0');
    return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
  };
  const iso = (d) => d.toISOString();
  const nowIso = iso(now);
  const base = (created) => ({ id: uuid(), createdAt: created, updatedAt: created, archivedAt: null });
  const r2 = (n) => Math.round(n * 100) / 100;

  const users = [{
    ...base(nowIso), email: DEMO_EMAIL, name: 'Administrador Demo', role: 'admin',
    salt: '6f1d2c9a4b7e83d05a1c9e7b2f4d8a60',
    passHash: '76c6012a1dc4739f99e25c94674dd636e17fc12c17a917774a46499b38265e4e',
  }];
  const userId = users[0].id;

  const created0 = (i) => iso(new Date(now.getFullYear() - 1, now.getMonth(), 1 + (i % 27)));

  /* ---- Empleados (legajo mínimo). Uno dado de baja (inactivo + archivado): conserva ventas y sueldos de cuando trabajaba ---- */
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const leftAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 40);
  // [nombre, puesto, teléfono, ingreso, sueldo base, peso como vendedor, de baja]
  const E = [
    ['Carla Méndez', 'Encargado/a', '+54 9 11 5310-2045', new Date(now.getFullYear() - 3, 2, 1), 300000, 2, false],
    ['Julián Torres', 'Vendedor/a', '+54 9 11 5421-7783', new Date(now.getFullYear() - 2, 1, 15), 200000, 5, false],
    ['Sofía Ramírez', 'Vendedor/a', '+54 9 11 5532-1190', new Date(now.getFullYear() - 1, 7, 1), 190000, 5, false],
    ['Marcos Díaz', 'Cajero/a', '+54 9 11 5643-6620', new Date(now.getFullYear() - 1, 0, 10), 180000, 1, false],
    ['Lucas Pereyra', 'Vendedor/a', '+54 9 11 5754-3318', new Date(now.getFullYear() - 2, 9, 1), 190000, 4, true],
  ];
  const employees = E.map(([name, position, phone, start, baseSalary, , gone]) => ({ ...base(iso(start)), name, position, phone, startDate: ymd(start), status: gone ? 'inactivo' : 'activo', baseSalary, ...(gone ? { archivedAt: iso(leftAt), updatedAt: iso(leftAt) } : {}) }));
  const sellerWeight = new Map(E.map((e, i) => [employees[i].id, e[5]]));
  const workingAt = (date) => employees.filter((e) => new Date(`${e.startDate}T00:00:00`) <= date && (!e.archivedAt || date < new Date(e.archivedAt)));
  // ~12% de las ventas sin vendedor asignado (el vendedor es opcional); el resto, ponderado entre quienes trabajaban ese día
  const pickSeller = (date) => {
    if (chance(0.12)) return null;
    const list = workingAt(date);
    let r = rnd() * list.reduce((s, e) => s + sellerWeight.get(e.id), 0);
    for (const e of list) { r -= sellerWeight.get(e.id); if (r <= 0) return e; }
    return list[list.length - 1] || null;
  };
  const sellerFields = (e) => ({ sellerId: e ? e.id : null, sellerSnapshot: e ? { name: e.name } : null });

  /* ---- Productos (25 con stock) + servicios (3) ---- */
  // [sku, nombre, categoría, precio, costo, stock mínimo, proveedor, popularidad]
  const P = [
    ['R-001', 'Remera Oversize Negra', 'Remeras', 18500, 8200, 8, 'Textil Avenida', 5], ['R-002', 'Remera Básica Blanca', 'Remeras', 12900, 5400, 10, 'Textil Avenida', 4],
    ['R-003', 'Remera Estampada Rock', 'Remeras', 21000, 9300, 6, 'Textil Avenida', 2], ['R-004', 'Musculosa Deportiva', 'Remeras', 14500, 6100, 6, 'Textil Avenida', 2],
    ['R-005', 'Remera Lisa Gris Melange', 'Remeras', 13500, 5600, 8, 'Textil Avenida', 3], ['R-006', 'Camisa de Lino Beige', 'Remeras', 32000, 14500, 4, 'Lino Sur', 2],
    ['P-001', 'Jean Recto Azul', 'Pantalones', 45000, 20500, 6, 'Denim Norte', 4], ['P-002', 'Jean Mom Celeste', 'Pantalones', 47500, 21800, 5, 'Denim Norte', 3],
    ['P-003', 'Pantalón Cargo Verde', 'Pantalones', 52000, 23400, 4, 'Denim Norte', 2], ['P-004', 'Jogger de Frisa Gris', 'Pantalones', 38000, 16200, 6, 'Textil Avenida', 3],
    ['P-005', 'Bermuda de Gabardina', 'Pantalones', 33000, 14000, 4, 'Denim Norte', 2], ['P-006', 'Pollera Midi Plisada', 'Pantalones', 36000, 15500, 4, 'Lino Sur', 2],
    ['C-001', 'Campera Puffer', 'Camperas', 89000, 41000, 3, 'Proveedor Texar', 5], ['C-002', 'Campera de Jean', 'Camperas', 78000, 35500, 3, 'Denim Norte', 2],
    ['C-003', 'Buzo Canguro Negro', 'Camperas', 42000, 18700, 5, 'Textil Avenida', 4], ['C-004', 'Buzo Cuello Redondo', 'Camperas', 36500, 15900, 5, 'Textil Avenida', 3],
    ['C-005', 'Rompeviento Liviano', 'Camperas', 58000, 26000, 3, 'Proveedor Texar', 2],
    ['Z-001', 'Zapatilla Urbana Blanca', 'Calzado', 68000, 31500, 4, 'Calzados Sur', 3], ['Z-002', 'Zapatilla Running', 'Calzado', 74000, 35000, 4, 'Calzados Sur', 5],
    ['Z-003', 'Botita de Cuero Negra', 'Calzado', 82000, 38500, 3, 'Calzados Sur', 2],
    ['A-001', 'Gorra Trucker', 'Accesorios', 9800, 3700, 8, 'Accesorios Plaza', 5], ['A-002', 'Cinturón de Cuero', 'Accesorios', 15500, 6400, 5, 'Accesorios Plaza', 2],
    ['A-003', 'Medias Pack x3', 'Accesorios', 6500, 2400, 12, 'Accesorios Plaza', 4], ['A-004', 'Mochila Urbana', 'Accesorios', 39000, 17500, 3, 'Accesorios Plaza', 2],
    ['A-005', 'Bufanda de Lana', 'Accesorios', 14000, 5800, 6, 'Accesorios Plaza', 2],
  ];
  const S = [['S-001', 'Arreglo de ruedo', 6000], ['S-002', 'Estampado personalizado', 9500], ['S-003', 'Ajuste de cintura', 7500]];
  const held = new Set(['R-001', 'C-001', 'Z-002', 'A-001']); // sin reposición en las últimas semanas: quedan en nivel crítico
  const items = P.map(([sku, name, category, price, cost, minStock, supplier]) => ({ ...base(created0(0)), type: 'producto', sku, name, category, price, cost, minStock, trackStock: true, stock: 0, supplier, active: true }));
  S.forEach(([sku, name, price]) => items.push({ ...base(created0(0)), type: 'servicio', sku, name, category: 'Servicios', price, cost: null, minStock: null, trackStock: false, stock: null, supplier: null, active: true }));
  items.push({ ...base(created0(0)), type: 'producto', sku: 'Z-009', name: 'Zapatilla Descontinuada', category: 'Calzado', price: 50000, cost: 24000, minStock: 2, trackStock: true, stock: 0, supplier: 'Calzados Sur', active: false });
  const prods = items.filter((i) => i.type === 'producto' && i.active);
  const services = items.filter((i) => i.type === 'servicio');
  const weight = new Map(P.map((p, i) => [prods[i].id, p[7]]));

  /* ---- Simulación día por día: stock, ventas, gastos y cajas salen de los mismos registros ---- */
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const allDays = [];
  for (let back = 90; back >= 1; back--) allDays.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back));
  const days = allDays.filter((d) => d.getDay() !== 0); // el local cierra los domingos
  const at = (d, h, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);

  const stock = new Map();
  const stockMovements = [];
  const mv = (item, kind, qty, date, extra = {}) => {
    stock.set(item.id, (stock.get(item.id) || 0) + qty);
    stockMovements.push({ ...base(iso(date)), itemId: item.id, nameSnapshot: item.name, kind, qty, unitCost: null, reason: '', refType: null, refId: null, date: iso(date), userId, ...extra });
  };
  const operations = [];
  const expenses = [];
  const cashSessions = [];
  const cashMovements = [];
  const line = (it, qty) => ({ itemId: it.id, nameSnapshot: it.name, typeSnapshot: it.type, categorySnapshot: it.category, costSnapshot: it.cost != null ? it.cost : 0, qty, unitPrice: it.price });
  const totalOf = (lines) => r2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  const counterMethod = () => { const r = rnd(); return r < 0.35 ? 'efectivo' : r < 0.65 ? 'tarjeta' : r < 0.85 ? 'transferencia' : 'qr'; };
  const wsum = (list) => list.reduce((s, it) => s + weight.get(it.id), 0);
  const weighted = (list) => { let r = rnd() * wsum(list); for (const it of list) { r -= weight.get(it.id); if (r <= 0) return it; } return list[list.length - 1]; };
  // Líneas de un ticket: 1-3 productos con stock disponible (+ a veces un servicio)
  const ticketLines = () => {
    const lines = [];
    const nLines = chance(0.55) ? 1 : chance(0.75) ? 2 : 3;
    for (let k = 0; k < nLines; k++) {
      const avail = prods.filter((it) => stock.get(it.id) > 0 && !lines.some((l) => l.itemId === it.id));
      if (!avail.length) break;
      const it = weighted(avail);
      const qty = Math.min(stock.get(it.id), chance(0.14) ? (it.category === 'Accesorios' ? int(2, 3) : 2) : 1);
      lines.push(line(it, qty));
    }
    if (chance(0.07)) lines.push(line(pick(services), 1));
    return lines;
  };
  const saleMovements = (op, date) => op.lines.forEach((l) => {
    const it = items.find((x) => x.id === l.itemId);
    if (it.type === 'producto') mv(it, 'venta', -l.qty, date, { unitCost: l.costSnapshot, reason: 'Venta', refType: 'operation', refId: op.id });
  });
  const diffNotes = ['Vuelto mal dado en hora pico.', 'Faltante detectado al contar; se revisará mañana.', 'Sobrante: propina dejada en la caja.', 'Diferencia por redondeo de vueltos.'];
  const reasonsOut = ['Retiro para depósito bancario', 'Retiro para pago a proveedor', 'Retiro de ganancias'];
  const reasonsIn = ['Refuerzo de cambio', 'Cambio de billetes grandes'];
  const cashExp = [['Limpieza', 'Productos de limpieza del local', [3500, 6500, 9000]], ['Varios', 'Bolsas y packaging', [2500, 4200, 8000]], ['Varios', 'Flete y cadete', [3000, 5500]], ['Limpieza', 'Reparación de percha', [7000, 9000]]];
  const monthly = [[1, 'Alquiler', 'Alquiler del local', 'transferencia', 420000], [8, 'Servicios', 'Luz, gas e internet', 'transferencia', 74000], [12, 'Marketing', 'Publicidad en redes', 'tarjeta', 45000], [15, 'Impuestos', 'Impuestos y tasas municipales', 'transferencia', 78000]];
  const exp = (date, category, description, amount, paymentMethod, extra = {}) => {
    const e = { ...base(iso(date)), date: iso(date), category, description, amount, paymentMethod, supplier: null, status: 'registrado', voidedAt: null, voidReason: null, cashMovementId: null, employeeId: null, employeeSnapshot: null, userId, ...extra };
    expenses.push(e);
    return e;
  };
  const mvCash = (session, kind, amount, reason, date, extra = {}) => {
    const m = { ...base(iso(date)), sessionId: session.id, kind, amount, reason, date: iso(date), userId, ...extra };
    cashMovements.push(m);
    return m;
  };

  // Saldo inicial (día −90): un movimiento 'inicial' por producto
  const day0 = at(allDays[0], 8, 0);
  prods.forEach((it, i) => mv(it, 'inicial', it.minStock * 4 + int(0, 5), day0, { reason: 'Stock inicial', refType: 'item', refId: it.id }));
  items.filter((i) => i.type === 'producto' && !i.active).forEach((it) => { mv(it, 'inicial', 2, day0, { reason: 'Stock inicial', refType: 'item', refId: it.id }); mv(it, 'ajuste', -2, at(allDays[3], 11, 0), { reason: 'Baja por discontinuado', refType: 'item', refId: it.id }); });

  const monthlyDone = new Set();
  for (const d of allDays) {
    const daysBack = (startToday - d) / 86400000;
    // Gastos mensuales fijos (no efectivo): un día del mes, sin domingos forzados
    monthly.forEach(([dom, cat, desc, method, amount]) => {
      if (d.getDate() === dom && !monthlyDone.has(`${d.getMonth()}-${dom}`)) {
        monthlyDone.add(`${d.getMonth()}-${dom}`);
        const amt = r2(amount * (0.96 + rnd() * 0.1));
        exp(at(d, 10, int(0, 40)), cat, desc, Math.round(amt / 100) * 100, method, { supplier: cat === 'Alquiler' ? 'Inmobiliaria Palermo' : null });
      }
    });
    // Sueldos (día 5): un pago por empleado que trabajaba ese día, vinculado a su legajo
    if (d.getDate() === 5 && !monthlyDone.has(`${d.getMonth()}-sueldos`)) {
      monthlyDone.add(`${d.getMonth()}-sueldos`);
      workingAt(d).forEach((e) => exp(at(d, 11, int(0, 40)), cfg.salaryCategory, `Sueldo ${e.name}`, e.baseSalary, 'transferencia', { employeeId: e.id, employeeSnapshot: { name: e.name } }));
    }
    if (d.getDay() === 0) continue;

    // Reposición semanal (lunes): ingresos + una compra de mercadería por proveedor
    if (d.getDay() === 1 && d > allDays[0]) {
      const bySupplier = new Map();
      prods.forEach((it) => {
        if (held.has(it.sku) && daysBack < 26) return;
        if (stock.get(it.id) > it.minStock + 2) return;
        const qty = it.minStock * 4 - stock.get(it.id) + int(0, 3);
        if (chance(0.3)) it.cost = Math.round((it.cost * (1.05 + rnd() * 0.04)) / 100) * 100;
        const when = at(d, 9, int(10, 50));
        mv(it, 'ingreso', qty, when, { unitCost: it.cost, supplier: it.supplier, reason: 'Ingreso de mercadería', refType: 'item', refId: it.id });
        bySupplier.set(it.supplier, (bySupplier.get(it.supplier) || 0) + qty * it.cost);
      });
      [...bySupplier].forEach(([sup, amount]) => exp(at(d, 12, int(0, 30)), 'Compra de mercadería', `Reposición ${sup}`, r2(amount), 'transferencia', { supplier: sup }));
    }

    // Caja del día (abre 6:40-6:59, cierra 20:30-20:59; se cierra siempre)
    const openedAt = iso(at(d, 6, int(40, 59)));
    const closedAt = iso(at(d, 20, int(30, 59)));
    const s = { ...base(openedAt), status: 'cerrada', openedAt, openedBy: userId, openingAmount: pick([20000, 25000, 30000]), closedAt, closedBy: userId, note: '', closing: null };

    // Ventas del día
    const nTickets = d.getDay() === 6 ? int(7, 12) : int(4, 9);
    for (let n = 0; n < nTickets; n++) {
      const lines = ticketLines();
      if (!lines.length) continue;
      const date = at(d, int(10, 19), int(0, 59));
      let status = 'pagada', voidedAt, voidedFrom;
      if (rnd() > 0.98) {
        status = 'anulada'; voidedFrom = 'pagada'; voidedAt = iso(new Date(date.getTime() + int(2, 25) * 60000));
      }
      const op = {
        ...base(iso(date)), date: iso(date), ...sellerFields(pickSeller(date)),
        lines, total: totalOf(lines), status, paymentMethod: counterMethod(),
        ...(voidedAt ? { voidedAt, voidedFrom } : {}),
      };
      operations.push(op);
      lines.forEach((l) => {
        const it = items.find((x) => x.id === l.itemId);
        if (it.type !== 'producto') return;
        mv(it, 'venta', -l.qty, date, { unitCost: l.costSnapshot, reason: 'Venta', refType: 'operation', refId: op.id });
        if (status === 'anulada') mv(it, 'anulacion', l.qty, new Date(voidedAt), { reason: 'Anulación de venta', refType: 'operation', refId: op.id });
      });
    }

    // Movimientos manuales de caja + gastos en efectivo (con su retiro) + algún gasto anulado el mismo día
    if (chance(0.2)) {
      const k = chance(0.75) ? 'retiro' : 'ingreso';
      mvCash(s, k, k === 'retiro' ? pick([8000, 12000, 15000, 40000]) : pick([5000, 10000]), k === 'retiro' ? pick(reasonsOut) : pick(reasonsIn), at(d, int(9, 18), int(0, 59)));
    }
    if (chance(0.16)) {
      const [cat, desc, amts] = pick(cashExp);
      const when = at(d, int(10, 18), int(0, 49));
      const amount = pick(amts);
      const e = exp(when, cat, desc, amount, 'efectivo');
      const m = mvCash(s, 'retiro', amount, `Gasto: ${desc}`, when, { refType: 'expense', refId: e.id });
      e.cashMovementId = m.id;
      if (chance(0.15)) {
        const vt = new Date(when.getTime() + 12 * 60000);
        e.status = 'anulado'; e.voidedAt = iso(vt); e.voidReason = 'Cargado por error';
        mvCash(s, 'ingreso', amount, `Anulación de gasto: ${desc}`, vt, { refType: 'expense', refId: e.id });
      }
    }
    cashSessions.push(s);
  }
  // Un gasto no efectivo anulado (duplicado)
  const dup = expenses.find((e) => e.category === 'Marketing' && e.status === 'registrado');
  if (dup) { dup.status = 'anulado'; dup.voidedAt = iso(new Date(new Date(dup.date).getTime() + 3600000)); dup.voidReason = 'Cargado dos veces'; }

  // Cierres: misma función pura que usa la app (cashSummary), con diferencias de conteo pseudoaleatorias
  for (const s of cashSessions) {
    const exp0 = buildClosing(s, operations, cashMovements, cfg, 0, s.closedAt).expected;
    const r = rnd();
    let diff = 0;
    if (r > 0.6 && r <= 0.9) diff = pick([-300, -150, -50, 50, 100, 250]);
    else if (r > 0.9) diff = pick([-2500, -1200, 900, 1800]);
    s.closing = buildClosing(s, operations, cashMovements, cfg, r2(Math.max(0, exp0 + diff)), s.closedAt);
    if (Math.abs(s.closing.difference) > cfg.cashTolerance) s.note = pick(diffNotes);
  }

  /* ---- Hoy: caja abierta desde la mañana con ventas cobradas entre la apertura y "ahora" (nunca en el futuro) ---- */
  // Abre ~9:00; si todavía es temprano, abre como mucho 1 h antes de ahora (sin salir del día de hoy).
  const hour = 3600000, nowMs = now.getTime();
  const openMs = Math.max(startToday.getTime(), Math.min(at(startToday, 9, int(0, 15)).getTime(), nowMs - hour));
  const today = { ...base(iso(new Date(openMs))), status: 'abierta', openedAt: iso(new Date(openMs)), openedBy: userId, openingAmount: pick([20000, 25000, 30000]), closedAt: null, closedBy: null, note: '', closing: null };
  const span = nowMs - openMs, lo = openMs + Math.min(10 * 60000, span / 4), hi = nowMs - Math.min(2 * 60000, span / 4);
  const times = Array.from({ length: int(6, 9) }, () => Math.round(lo + rnd() * (hi - lo))).sort((a, b) => a - b);
  times.forEach((t, n) => {
    const lines = ticketLines();
    if (!lines.length) return;
    const date = new Date(t);
    // Métodos con la misma mezcla del mostrador; el primer ticket del día va en efectivo (entra a la caja abierta)
    const op = { ...base(iso(date)), date: iso(date), ...sellerFields(pickSeller(date)), lines, total: totalOf(lines), status: 'pagada', paymentMethod: n === 0 ? 'efectivo' : counterMethod() };
    operations.push(op);
    saleMovements(op, date);
  });
  cashSessions.push(today); // abierta: sin closing (el esperado se calcula en vivo con cashSummary)

  operations.sort((a, b) => a.date.localeCompare(b.date));
  expenses.sort((a, b) => a.date.localeCompare(b.date));
  stockMovements.sort((a, b) => a.date.localeCompare(b.date));
  items.forEach((it) => { if (it.type === 'producto') it.stock = stock.get(it.id) || 0; });

  return {
    users, employees, items, operations, cashSessions, cashMovements, stockMovements, expenses,
    notifications: [], auditLog: [],
    settings: [{ id: 'main', createdAt: nowIso, updatedAt: nowIso, archivedAt: null, branding: {}, business: { ...cfg.business }, paymentMethods: [...cfg.paymentMethods] }],
  };
}
