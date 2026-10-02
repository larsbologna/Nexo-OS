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
      body.innerHTML = `<dl class="kv"><dt>Fecha</dt><dd>${esc(dateTime(op.date))}</dd><dt>Estado</dt><dd>${badge(op.status)}</dd><dt>Vendedor</dt><dd>${op.sellerSnapshot ? esc(op.sellerSnapshot.name) : 'Sin asignar'}</dd><dt>Método de pago</dt><dd>${esc(METHODS[op.paymentMethod] || op.paymentMethod)}</dd></dl>
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
      // D7: venta en efectivo cobrada en una caja ya cerrada => preguntar si se devolvió el efectivo
      const prompt = await repo.voidPrompt(op.id);
      let refunded = false;
      if (prompt.askRefund) {
        const ans = await openModal({
          title: '¿Se devolvió el efectivo?', size: 'sm',
          build(body, api) {
            body.innerHTML = `<div class="modal-msg"><p>${prompt.hasOpenCash ? 'Si se devolvió, se registra un retiro «Devolución» en la caja abierta. ' : 'No hay caja abierta: si se devolvió, te avisaremos con una notificación para registrar la devolución al abrir la próxima caja. '}El cierre de la caja donde se cobró no cambia.</p></div>
              <div class="modal-actions"><button type="button" class="btn btn-secondary" data-no>No se devolvió</button><button type="button" class="btn btn-primary" data-yes>Sí, se devolvió</button></div>`;
            body.querySelector('[data-no]').addEventListener('click', () => api.close('no'));
            body.querySelector('[data-yes]').addEventListener('click', () => api.close('yes'));
          },
        });
        if (ans !== 'yes' && ans !== 'no') return; // cerró el diálogo sin decidir: no se anula
        refunded = ans === 'yes';
      }
      await repo.voidOperation(op.id, { refunded });
      toast(refunded ? (prompt.hasOpenCash ? 'Operación anulada. Devolución registrada como retiro en la caja.' : 'Operación anulada. Registrá la devolución al abrir la próxima caja.') : 'Operación anulada.', 'success');
      onChanged && onChanged();
    }
  } catch (e) { toast(e.message, 'error'); }
}
