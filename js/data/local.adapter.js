// Adapter localStorage. Interfaz async; para un backend real, crear otro adapter con las mismas funciones
// (init, list, get, insert, update, reset, dump) y cambiar el import en repo.js.
const PREFIX = 'nexo:v1:';
const SCHEMA_VERSION = 7; // v7: sin módulos Caja ni Empleados en la interfaz (re-siembra para limpiar avisos de caja) · v6: empleados (vendedor en ventas, sueldos por empleado) · v5: seed con caja abierta y ventas de hoy · v4: sin clientes ni fiado (v3: stockMovements, expenses; v2: cashSessions, cashMovements). Schema distinto => re-siembra.
const OBSOLETE = ['customers']; // colecciones de schemas anteriores: se borran al re-sembrar
export const COLLECTIONS = ['users', 'employees', 'items', 'operations', 'notifications', 'auditLog', 'settings', 'cashSessions', 'cashMovements', 'stockMovements', 'expenses'];

/*
 * Caché en memoria por colección: { raw, data }.
 * - raw: el último texto JSON leído o escrito en localStorage para esa colección.
 * - data: el array parseado, con registros congelados en profundidad (nadie de afuera puede alterar la caché:
 *   list/dump devuelven un array nuevo y cualquier intento de mutar un registro lanza un error en lugar de corromperla en silencio).
 * Coherencia: cada lectura compara el texto actual de localStorage con `raw` (comparar strings es mucho más barato que
 * JSON.parse). Si otra pestaña, una recarga o un cambio externo lo modificó, se vuelve a parsear: mismo comportamiento que sin caché.
 * Las escrituras van primero a localStorage y recién después a la caché (si setItem falla, la caché no cambia).
 */
const cache = new Map();

function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v).forEach(deepFreeze); }
  return v;
}
function read(col) {
  const raw = localStorage.getItem(PREFIX + col);
  if (raw === null) { cache.delete(col); throw new Error('missing:' + col); }
  const hit = cache.get(col);
  if (hit && hit.raw === raw) {
    if (!hit.data) hit.data = deepFreeze(JSON.parse(raw)); // escrito por reset: se parsea una sola vez, al primer uso
    return hit.data;
  }
  const v = JSON.parse(raw);
  if (!Array.isArray(v)) { cache.delete(col); throw new Error('corrupt:' + col); }
  cache.set(col, { raw, data: deepFreeze(v) });
  return v;
}
function store(col, raw, data) {
  try { localStorage.setItem(PREFIX + col, raw); }
  catch (e) { throw new Error('No se pudo guardar (almacenamiento lleno o no disponible).'); }
  cache.set(col, { raw, data: data && Object.freeze(data) });
}
function write(col, arr) { store(col, JSON.stringify(arr), null); }
/** Copia JSON (misma semántica que guardar y releer: descarta undefined, fechas como texto) congelada. */
const frozenCopy = (rec) => { const s = JSON.stringify(rec); return { s, rec: deepFreeze(JSON.parse(s)) }; };

export default {
  /** Verifica esquema/integridad; si falta o está corrupto, re-siembra. */
  async init(seedFn) {
    try {
      if (localStorage.getItem(PREFIX + 'schema') !== String(SCHEMA_VERSION)) throw new Error('schema');
      COLLECTIONS.forEach(read);
    } catch (e) {
      await this.reset(await seedFn());
    }
  },
  async list(col) { return read(col).slice(); },
  async get(col, id) { return read(col).find((r) => r.id === id) || null; },
  async insert(col, rec) {
    const a = read(col);
    const { s, rec: frozen } = frozenCopy(rec);
    const next = [...a, frozen];
    // Mismo texto que JSON.stringify(next) sin volver a serializar toda la colección (si el texto guardado no es
    // exactamente un array JSON compacto, p. ej. editado a mano, se serializa completo)
    const raw = cache.get(col).raw;
    const fast = !a.length ? `[${s}]` : raw.endsWith(']') && raw[raw.length - 2] !== ',' ? `${raw.slice(0, -1)},${s}]` : null;
    store(col, fast || JSON.stringify(next), next);
    return rec;
  },
  async update(col, id, patch) {
    const a = read(col);
    const i = a.findIndex((r) => r.id === id);
    if (i < 0) throw new Error(`No existe ${col}/${id}`);
    const { rec } = frozenCopy({ ...a[i], ...patch });
    const next = a.slice(); next[i] = rec;
    store(col, JSON.stringify(next), next);
    return rec;
  },
  async reset(seed) {
    COLLECTIONS.forEach((c) => write(c, seed[c] || []));
    OBSOLETE.forEach((c) => { localStorage.removeItem(PREFIX + c); cache.delete(c); });
    localStorage.setItem(PREFIX + 'schema', String(SCHEMA_VERSION));
  },
  async dump() { const o = {}; COLLECTIONS.forEach((c) => { o[c] = read(c).slice(); }); return o; },
};
