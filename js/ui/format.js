// Formato con Intl según config efectiva (locale/moneda/zona). Sin dependencias.
import { getConfig } from '../store.js';

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function money(n) {
  const c = getConfig();
  // Enteros sin decimales ($1.000); con centavos, todos los decimales ($111.649,50, nunca $111.649,5)
  const hasCents = Math.round((n || 0) * 100) % 100 !== 0;
  const digits = hasCents ? c.decimals : 0;
  return new Intl.NumberFormat(c.locale, { style: 'currency', currency: c.currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n || 0);
}
export function moneyCompact(n) {
  const c = getConfig();
  return new Intl.NumberFormat(c.locale, { style: 'currency', currency: c.currency, notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
}
/** Monto corto para etiquetas de gráfico: $539k, $1,2M (siempre angosto). */
export function moneyShort(n) {
  const c = getConfig();
  const sym = new Intl.NumberFormat(c.locale, { style: 'currency', currency: c.currency }).formatToParts(0).find((p) => p.type === 'currency').value;
  const a = Math.abs(n || 0);
  const f = (v, d) => new Intl.NumberFormat(c.locale, { maximumFractionDigits: d }).format(v);
  return `${n < 0 ? '−' : ''}${sym}${a >= 1e6 ? f(a / 1e6, 1) + 'M' : a >= 1e3 ? f(a / 1e3, 0) + 'k' : f(a, 0)}`;
}
export const num =(n) => new Intl.NumberFormat(getConfig().locale).format(n || 0);
export function pct(n) {
  if (n == null) return '—';
  return `${n > 0 ? '+' : ''}${new Intl.NumberFormat(getConfig().locale, { maximumFractionDigits: 1 }).format(n)}%`;
}
export function date(d) {
  const c = getConfig();
  return new Intl.DateTimeFormat(c.locale, { dateStyle: 'medium', timeZone: c.timezone }).format(new Date(d));
}
export function dateTime(d) {
  const c = getConfig();
  return new Intl.DateTimeFormat(c.locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: c.timezone }).format(new Date(d));
}
export function monthShort(d) {
  return new Intl.DateTimeFormat(getConfig().locale, { month: 'short' }).format(new Date(d));
}
export function monthYear(d) {
  return new Intl.DateTimeFormat(getConfig().locale, { month: 'long', year: 'numeric' }).format(new Date(d));
}
export function debounce(fn, ms = 250) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
const STATUS = {
  pagada: ['success', 'Pagada'], anulada: ['danger', 'Anulada'],
  activo: ['success', 'Activo'], inactivo: ['neutral', 'Inactivo'], archivado: ['neutral', 'Archivado'],
  producto: ['info', 'Producto'], servicio: ['info', 'Servicio'],
};
export function badge(key, label) {
  const [tone, text] = STATUS[key] || ['neutral', key];
  return `<span class="badge badge-${tone}">${esc(label || text)}</span>`;
}
export const METHODS = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', qr: 'Billetera / QR' };
