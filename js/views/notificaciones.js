import * as repo from '../data/repo.js';
import { esc, dateTime } from '../ui/format.js';
import { toast } from '../ui/toast.js';

const LINK = { operation: () => '#/ventas/historial', item: () => '#/stock', cashSession: () => '#/caja', expense: () => '#/gastos' };
const TYPE = { stock: 'Stock', caja: 'Caja' };

export async function render(el) {
  el.innerHTML = '<div class="page-head"><div><h1>Notificaciones</h1><p class="sub" id="nSub"></p></div><button type="button" class="btn btn-secondary" id="readAll">Marcar todas como leídas</button></div><section class="card" id="nBody"></section>';
  async function paint() {
    const all = (await repo.list('notifications')).sort((a, b) => b.date.localeCompare(a.date));
    const unread = all.filter((n) => !n.read).length;
    el.querySelector('#nSub').textContent = unread ? `${unread} sin leer` : 'Estás al día';
    el.querySelector('#readAll').disabled = !unread;
    el.querySelector('#nBody').innerHTML = all.length ? `<ul class="list">${all.map((n) => {
      const href = LINK[n.refType] ? LINK[n.refType](n.refId) : null;
      return `<li class="list-item ${n.read ? '' : 'unread'}"><div class="row" style="flex-wrap:nowrap;align-items:flex-start">${n.read ? '<span style="width:8px"></span>' : '<span class="dot-unread" aria-hidden="true"></span>'}<div><span class="badge badge-neutral">${esc(TYPE[n.type] || n.type)}</span> ${n.read ? '' : '<span class="sr-only">(sin leer)</span>'}<p>${esc(n.message)}</p><p class="muted small" style="font-weight:400">${esc(dateTime(n.date))}${href ? ` · <a class="link-tap" href="${href}" aria-label="Ver: ${esc(n.message)}">Ver</a>` : ''}</p></div></div>
      ${n.read ? '' : `<button type="button" class="btn btn-secondary btn-sm" data-read="${n.id}">Marcar leída</button>`}</li>`;
    }).join('')}</ul>` : '<div class="empty"><p>No hay notificaciones.</p></div>';
  }
  el.querySelector('#nBody').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-read]');
    if (b) { try { await repo.markRead(b.dataset.read); await paint(); } catch (err) { toast(err.message, 'error'); } }
  });
  el.querySelector('#readAll').addEventListener('click', async () => { await repo.markAllRead(); await paint(); toast('Todas marcadas como leídas.', 'success'); });
  await paint();
}
