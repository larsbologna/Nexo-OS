// Helpers de presentación de caja (compartidos por Caja y Dashboard). Sin lógica de negocio: los números vienen de metrics/repo.
import { esc, money } from '../ui/format.js';

const MINUS = '−';
export const signedMoney = (n) => `${n > 0 ? '+' : n < 0 ? MINUS : ''}${money(Math.abs(n))}`;

/** La diferencia siempre se comunica con texto y signo (no solo con color). */
export function diffLabel(d) {
  if (!d) return 'Sin diferencia';
  return d > 0 ? `Sobrante ${signedMoney(d)}` : `Faltante ${signedMoney(d)}`;
}
export function diffBadge(d) {
  const tone = !d ? 'success' : d > 0 ? 'info' : 'danger';
  return `<span class="badge badge-${tone}">${esc(diffLabel(d))}</span>`;
}
