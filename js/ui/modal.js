// Modal con <dialog> nativo: foco atrapado y Esc por el navegador; foco inicial y retorno manejados acá.
import { esc } from './format.js';
import { icon } from './icons.js';

let seq = 0;
/**
 * openModal({title, size, build(body, api)}) -> Promise<resultado>
 * api.close(value) cierra y resuelve. Sin close => undefined.
 */
export function openModal({ title, size = 'md', build }) {
  return new Promise((resolve) => {
    const opener = document.activeElement;
    const id = `dlg${++seq}`;
    const dlg = document.createElement('dialog');
    dlg.className = `modal modal-${size}`;
    dlg.setAttribute('aria-labelledby', id + 't');
    dlg.innerHTML = `<div class="modal-head"><h2 id="${id}t">${esc(title)}</h2><button type="button" class="btn btn-ghost btn-icon" data-x aria-label="Cerrar">${icon('close')}</button></div><div class="modal-body"></div>`;
    document.body.appendChild(dlg);
    let result;
    const api = { close(v) { result = v; dlg.close(); }, dialog: dlg };
    dlg.querySelector('[data-x]').addEventListener('click', () => api.close(undefined));
    dlg.addEventListener('click', (e) => { if (e.target === dlg) api.close(undefined); }); // click en backdrop
    dlg.addEventListener('close', () => {
      dlg.remove();
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
      // opener deshabilitado/oculto: el foco no se movió -> fallback al contenido principal
      if (document.activeElement === document.body || document.activeElement === null) { const m = document.getElementById('view'); if (m) m.focus(); }
      resolve(result);
    });
    build(dlg.querySelector('.modal-body'), api);
    dlg.showModal();
    // foco inicial: primer campo, si no el primer botón del cuerpo
    const first = dlg.querySelector('.modal-body input:not([type=hidden]), .modal-body select, .modal-body textarea, .modal-body button');
    (first || dlg.querySelector('[data-x]')).focus();
  });
}

/** confirmDialog({title, message, confirmText, danger}) -> Promise<boolean> */
export function confirmDialog({ title, message, confirmText = 'Confirmar', cancelText = 'Cancelar', danger = false, html = false }) {
  return openModal({
    title, size: 'sm',
    build(body, api) {
      body.innerHTML = `<div class="modal-msg">${html ? message : `<p>${esc(message)}</p>`}</div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-no>${esc(cancelText)}</button><button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${esc(confirmText)}</button></div>`;
      body.querySelector('[data-no]').addEventListener('click', () => api.close(false));
      body.querySelector('[data-yes]').addEventListener('click', () => api.close(true));
    },
  }).then((v) => v === true);
}
