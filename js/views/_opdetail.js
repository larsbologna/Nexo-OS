// Detalle de operación (modal) del Historial de ventas. Muestra SNAPSHOTS, no datos actuales.
import * as repo from '../data/repo.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { esc, money, dateTime, badge, METHODS } from '../ui/format.js';

export async function showOperation(op, onChanged) {
  const ticket = `#${op.id.slice(0, 8)}`;
  const act = await openModal({
    title: `Venta ${ticket}`, size: 'lg',
    build(body, api) {
      body.innerHTML = `<dl class="kv"><dt>Fecha</dt><dd>${esc(dateTime(op.date))}</dd><dt>Estado</dt><dd>${badge(op.status)}</dd><dt>Método de pago</dt><dd>${esc(METHODS[op.paymentMethod] || op.paymentMethod)}</dd></dl>
      <div class="table-wrap" style="margin-top:16px"><table class="table"><caption class="sr-only">Líneas de la operación</caption><thead><tr><th scope="col">Detalle</th><th scope="col" class="num">Cant.</th><th scope="col" class="num">Precio</th><th scope="col" class="num">Subtotal</th></tr></thead><tbody>
      ${op.lines.map((l) => `<tr><td data-label="Detalle">${esc(l.nameSnapshot)}</td><td class="num" data-label="Cant.">${l.qty}</td><td class="num" data-label="Precio">${esc(money(l.unitPrice))}</td><td class="num" data-label="Subtotal">${esc(money(l.qty * l.unitPrice))}</td></tr>`).join('')}
      </tbody></table></div><p class="total-line">Total: <span class="num">${esc(money(op.total))}</span></p>
      <div class="modal-actions"><button type="button" class="btn btn-secondary" data-close>Cerrar</button>
      ${op.status !== 'anulada' ? '<button type="button" class="btn btn-danger" data-void>Anular</button>' : ''}</div>`;
      body.querySelector('[data-close]').addEventListener('click', () => api.close(null));
      const v = body.querySelector('[data-void]'); if (v) v.addEventListener('click', () => api.close('void'));
    },
  });
  try {
    if (act === 'void') {
      const hasStock = op.lines.some((l) => l.typeSnapshot === 'producto');
      const ok = await confirmDialog({ title: 'Anular operación', message: `Se anulará la venta ${ticket} por ${money(op.total)}.${hasStock ? ' El stock de los productos se repondrá.' : ''} Esta acción no se puede deshacer.`, confirmText: 'Anular operación', danger: true });
      if (!ok) return;
      await repo.voidOperation(op.id);
      toast('Operación anulada.', 'success');
      onChanged && onChanged();
    }
  } catch (e) { toast(e.message, 'error'); }
}
