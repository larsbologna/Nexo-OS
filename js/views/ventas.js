// POS: buscador (Enter agrega), chips de categoría, grilla, carrito. Cobrar => repo.createOperation (stock y caja los maneja el repo).
import * as repo from '../data/repo.js';
import * as M from '../data/metrics.js';
import cfgBase from '../../config.js';
import { getConfig } from '../store.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { esc, money, num, dateTime, METHODS } from '../ui/format.js';

export function ventasNav(active) {
  return `<nav class="subnav" aria-label="Ventas"><a class="chip" href="#/ventas"${active === 'pos' ? ' aria-current="page"' : ''}>Nueva venta</a><a class="chip" href="#/ventas/historial"${active === 'hist' ? ' aria-current="page"' : ''}>Historial</a></nav>`;
}

/** Cuerpo del modal del ticket (lo usan showTicket y el precalentamiento; `id` solo en el modal real). */
function ticketBody(op, id) {
  const b = getConfig().business;
  return `<div class="ticket"${id ? ` id="${id}"` : ''}><h3>${esc(b.name)}</h3><p class="c">${esc(b.address || '')}</p><p class="c">CUIT ${esc(b.taxId || '—')}</p><hr>
        <div class="tl"><span>Fecha</span><span>${esc(dateTime(op.date))}</span></div><div class="tl"><span>Ticket</span><span>#${esc(op.id.slice(0, 8))}</span></div>${op.sellerSnapshot ? `<div class="tl"><span>Vendedor</span><span>${esc(op.sellerSnapshot.name)}</span></div>` : ''}<hr>
        ${op.lines.map((l) => `<div>${esc(l.nameSnapshot)}</div><div class="tl"><span>${l.qty} x ${esc(money(l.unitPrice))}</span><span>${esc(money(l.qty * l.unitPrice))}</span></div>`).join('')}<hr>
        <div class="tl tot"><span>TOTAL</span><span>${esc(money(op.total))}</span></div>
        <div class="tl"><span>Pago</span><span>${esc(METHODS[op.paymentMethod] || op.paymentMethod)}</span></div><hr><p class="c">¡Gracias por su compra!</p></div>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" data-close>Cerrar</button><button type="button" class="btn btn-primary" data-print>${icon('printer', 16)} Imprimir</button></div>`;
}

/*
 * Precalentamiento del ticket (rendimiento): la 1ª vez que el navegador maqueta la fuente monoespaciada del ticket y los
 * textos del modal cuesta ~70 ms, que caían dentro de showModal() al cobrar. Se paga antes, en tiempo ocioso y una sola
 * vez por carga de página, con una copia invisible (visibility:hidden, aria-hidden, fuera de pantalla) que se mide y se
 * quita en la misma tarea: nunca se pinta, no recibe foco ni llega al árbol de accesibilidad. No cambia el modal real.
 */
let ticketWarmed = false;
function warmTicket(method) {
  if (ticketWarmed) return;
  ticketWarmed = true;
  const run = () => {
    const box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none';
    const op = { id: '00000000', date: new Date().toISOString(), lines: [{ nameSnapshot: 'Producto', qty: 1, unitPrice: 1000 }], total: 1000, paymentMethod: method };
    box.innerHTML = `<div class="modal modal-sm" style="display:block;position:static"><div class="modal-head"><h2>Ticket de venta</h2></div><div class="modal-body">${ticketBody(op)}</div></div>`;
    document.body.appendChild(box);
    void box.offsetHeight; // el layout de 1ª vez ocurre acá (en ocio) y no dentro de showModal
    box.remove();
  };
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 3000 }); else setTimeout(run, 300);
}

/* Vendedor (opcional): se recuerda el último elegido durante la sesión del navegador (pestaña). */
const SELLER_KEY = 'nexo:v1:pos:seller';
function readSeller() { try { return sessionStorage.getItem(SELLER_KEY) || ''; } catch (e) { return ''; } }
function saveSeller(id) { try { if (id) sessionStorage.setItem(SELLER_KEY, id); else sessionStorage.removeItem(SELLER_KEY); } catch (e) { /* sin storage: solo no se recuerda */ } }

/** Ticket imprimible (window.print con @media print: solo se imprime el diálogo). */
export function showTicket(op) {
  return openModal({
    title: 'Ticket de venta', size: 'sm',
    build(body, api) {
      body.innerHTML = ticketBody(op, 'ticket');
      body.querySelector('[data-close]').addEventListener('click', () => api.close());
      body.querySelector('[data-print]').addEventListener('click', () => window.print());
    },
  });
}

export async function render(el, ctx) {
  if (ctx.id === 'historial') return (await import('./ventas-historial.js')).render(el, ctx);
  let items = [], sellers = [];
  const cart = new Map(); // itemId -> qty
  const st = { q: '', cat: '', method: 'efectivo', sellerId: readSeller() };
  const methods = getConfig().paymentMethods;
  if (!methods.includes(st.method)) st.method = methods[0];
  document.body.classList.add('has-cartbar');

  el.innerHTML = `<div class="page-head"><div><h1>Ventas</h1><p class="sub">Punto de venta: descuenta stock y registra en Caja y Finanzas.</p></div>${ventasNav('pos')}</div>
    <div class="pos">
      <section aria-labelledby="h-prod">
        <h2 class="sr-only" id="h-prod">Productos y servicios</h2>
        <div class="pos-tools">
          <div class="search-wrap">${icon('search', 18)}<input class="input" id="q" type="search" placeholder="Buscar producto…" autocomplete="off" aria-label="Buscar producto o código; Enter agrega el primer resultado"></div>
          <div class="chips" id="cats" role="group" aria-label="Categorías"></div>
        </div>
        <p class="sr-only" id="posLive" role="status" aria-live="polite"></p>
        <div class="pos-grid" id="grid"></div>
      </section>
      <aside class="cart" id="cart" aria-labelledby="h-cart">
        <div class="card-head" style="margin:0"><h2 id="h-cart">Carrito</h2><button type="button" class="btn btn-ghost btn-icon cart-close" id="cartClose" aria-label="Cerrar carrito">${icon('close')}</button></div>
        <div class="cart-lines" id="lines"></div>
        <div class="cart-opts"><div class="field"><label for="seller">Vendedor (opcional)</label><select class="input" id="seller"></select></div>
        <div class="field"><label for="meth">Método de pago</label><select class="input" id="meth">${methods.map((k) => `<option value="${k}">${esc(METHODS[k] || k)}</option>`).join('')}</select></div></div>
        <p class="form-error" id="posErr" role="alert" hidden></p>
        <div class="cart-foot">
          <div class="cart-total"><span>Total</span><span class="t num" id="total"></span></div>
          <button type="button" class="btn btn-accent btn-lg btn-block" id="pay">Cobrar</button>
          <p class="pos-note">Descuenta stock automático • Registra en Caja y Finanzas</p>
        </div>
      </aside>
    </div>
    <div class="cart-bar"><div class="sum"><span class="muted small" id="barCount">Carrito vacío</span><strong class="num" id="barTotal"></strong></div><button type="button" class="btn btn-secondary" id="cartToggle" aria-expanded="false" aria-controls="cart">${icon('cart', 18)} Ver carrito</button></div>`;
  const $ = (s) => el.querySelector(s);
  const live = (t) => { $('#posLive').textContent = t; };
  const byId = (id) => items.find((i) => i.id === id);
  const totalOf = () => [...cart].reduce((s, [id, q]) => s + q * (byId(id) ? byId(id).price : 0), 0);
  const countOf = () => [...cart.values()].reduce((s, q) => s + q, 0);

  async function load() {
    const [its, emps] = await Promise.all([repo.list('items'), repo.list('employees')]);
    items = its.filter((i) => i.active);
    sellers = emps.filter((e) => e.status === 'activo').sort((a, b) => a.name.localeCompare(b.name));
  }
  const matches = () => {
    const q = st.q.trim().toLowerCase();
    return items.filter((i) => (!st.cat || i.category === st.cat) && (!q || `${i.name} ${i.sku} ${i.category || ''}`.toLowerCase().includes(q)));
  };
  function stockMeta(i) {
    if (!M.isTracked(i)) return '<span class="p-meta">Servicio</span>';
    if (i.stock <= 0) return '<span class="p-meta low">Sin stock</span>';
    if (i.stock <= M.minStockOf(i, cfgBase)) return `<span class="p-meta low">Stock bajo: ${num(i.stock)}</span>`;
    return `<span class="p-meta">Stock ${num(i.stock)}</span>`;
  }
  function paintCats() {
    const cats = [...new Set(items.map((i) => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    $('#cats').innerHTML = [['', 'Todos'], ...cats.map((c) => [c, c])].map(([v, l]) => `<button type="button" class="chip" data-cat="${esc(v)}" aria-pressed="${st.cat === v}">${esc(l)}</button>`).join('');
  }
  function paintGrid() {
    const list = matches();
    $('#grid').innerHTML = list.length ? list.map((i) => `<button type="button" class="prod" data-id="${i.id}" aria-label="Agregar ${esc(i.name)}, ${esc(money(i.price))}${M.isTracked(i) ? (i.stock <= 0 ? ', Sin stock' : i.stock <= M.minStockOf(i, cfgBase) ? ', Stock bajo' : '') : ''}"><span class="p-name">${esc(i.name)}</span><span class="p-meta">${esc(i.sku)}</span>${stockMeta(i)}<span class="p-price num">${esc(money(i.price))}</span></button>`).join('')
      : '<div class="empty" style="grid-column:1/-1"><p>No hay productos que coincidan.</p></div>';
  }
  function paintCart() {
    const lines = [...cart].filter(([id]) => byId(id));
    $('#lines').innerHTML = lines.length ? lines.map(([id, q]) => {
      const i = byId(id); const short = M.isTracked(i) && q > i.stock;
      return `<div class="cart-line" data-id="${id}"><div><div class="c-name">${esc(i.name)}</div><div class="c-sub">${esc(money(i.price))} c/u${short ? ` · <strong style="color:var(--danger-text)">Stock insuficiente (${num(i.stock)})</strong>` : ''}</div></div>
        <div class="c-tot">${esc(money(q * i.price))}</div>
        <div class="qty"><button type="button" data-dec aria-label="Quitar una unidad de ${esc(i.name)}">${icon('minus', 16)}</button><output aria-label="Cantidad de ${esc(i.name)}">${q}</output><button type="button" data-inc aria-label="Agregar una unidad de ${esc(i.name)}">${icon('plus', 16)}</button></div>
        <button type="button" class="btn btn-ghost btn-sm" data-rm aria-label="Quitar ${esc(i.name)} del carrito">Quitar</button></div>`;
    }).join('') : '<p class="cart-empty">El carrito está vacío. Tocá un producto para agregarlo.</p>';
    const t = totalOf(), n = countOf();
    $('#total').textContent = money(t);
    $('#barTotal').textContent = money(t);
    $('#barCount').textContent = n ? `${n} ítem${n === 1 ? '' : 's'}` : 'Carrito vacío';
    $('#pay').disabled = !n;
    $('#pay').textContent = n ? `Cobrar ${money(t)}` : 'Cobrar';
  }
  function paintMethod() { $('#meth').value = st.method; }
  function paintSeller() {
    if (st.sellerId && !sellers.some((e) => e.id === st.sellerId)) { st.sellerId = ''; saveSeller(''); } // archivado/inactivo desde la última venta
    $('#seller').innerHTML = `<option value="">Sin asignar</option>${sellers.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}`;
    $('#seller').value = st.sellerId;
  }
  let liveT;
  const liveLater = (t) => { clearTimeout(liveT); liveT = setTimeout(() => { const p = $('#posLive'); if (p) p.textContent = t; }, 400); };
  const focusable = (root) => [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled && !n.hidden && n.offsetParent !== null);
  // Repinta el carrito y devuelve el foco al mismo control de la línea (o a la vecina / al buscador si ya no hay)
  function refocus(id, act, ids) {
    const idx = ids.indexOf(id);
    const q = (lid, a) => $(`#lines .cart-line[data-id="${CSS.escape(lid)}"] [data-${a}]`);
    let t = cart.has(id) ? q(id, act) : null;
    if (!t) {
      const nid = ids.slice(idx + 1).concat(ids.slice(0, idx).reverse()).find((x) => cart.has(x));
      t = nid ? (q(nid, act) || q(nid, 'rm')) : null;
    }
    if (!t) t = $('#cart').classList.contains('open') ? $('#cartClose') : $('#q');
    if (t) t.focus();
  }
  function add(id, by = 1, act) {
    const i = byId(id); if (!i) return;
    const ids = [...cart.keys()].filter(byId);
    cart.set(id, (cart.get(id) || 0) + by);
    if (cart.get(id) <= 0) cart.delete(id);
    paintCart();
    const q = cart.get(id);
    if (!act) live(`${i.name} agregado. Carrito: ${countOf()} ítem${countOf() === 1 ? '' : 's'}, ${money(totalOf())}.`);
    else {
      liveLater(q ? `${i.name}: ${q} unidad${q === 1 ? '' : 'es'}` : `${i.name} quitado del carrito${cart.size ? '' : '. Carrito vacío'}`);
      refocus(id, act, ids);
    }
  }
  function removeLine(id) {
    const i = byId(id); const ids = [...cart.keys()].filter(byId);
    cart.delete(id); paintCart();
    liveLater(`${i ? i.name : 'Producto'} quitado del carrito${cart.size ? '' : '. Carrito vacío'}`);
    refocus(id, 'rm', ids);
  }
  // Sheet móvil: dialog modal con fondo inert
  const inertEls = () => [document.querySelector('.sidebar'), document.querySelector('.topbar'), document.getElementById('chipWrap'), el.querySelector('.page-head'), el.querySelector('.pos > section'), el.querySelector('.cart-bar')].filter(Boolean);
  const setOpen = (open) => {
    const cart_ = $('#cart');
    cart_.classList.toggle('open', open);
    $('#cartToggle').setAttribute('aria-expanded', String(open));
    $('#cartToggle').lastChild.textContent = open ? ' Ocultar carrito' : ' Ver carrito';
    if (open) { cart_.setAttribute('role', 'dialog'); cart_.setAttribute('aria-modal', 'true'); }
    else { cart_.removeAttribute('role'); cart_.removeAttribute('aria-modal'); }
    inertEls().forEach((n) => { n.inert = open; });
  };
  const openSheet = () => { setOpen(true); const h = $('#h-cart'); h.tabIndex = -1; h.focus(); };
  const closeSheet = () => { setOpen(false); $('#cartToggle').focus(); };

  $('#grid').addEventListener('click', (e) => { const b = e.target.closest('.prod'); if (b) add(b.dataset.id); });
  $('#cats').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (!b) return; st.cat = b.dataset.cat; paintCats(); paintGrid(); });
  $('#q').addEventListener('input', (e) => { st.q = e.target.value; paintGrid(); });
  $('#q').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = st.q.trim().toLowerCase(); if (!q) return;
    const list = matches();
    const hit = list.find((i) => i.sku.toLowerCase() === q) || list[0];
    if (!hit) { live('Sin resultados.'); return; }
    add(hit.id); st.q = ''; $('#q').value = ''; paintGrid();
  });
  $('#lines').addEventListener('click', (e) => {
    const row = e.target.closest('.cart-line'); if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest('[data-inc]')) add(id, 1, 'inc');
    else if (e.target.closest('[data-dec]')) add(id, -1, 'dec');
    else if (e.target.closest('[data-rm]')) removeLine(id);
  });
  $('#meth').addEventListener('change', (e) => { st.method = e.target.value; });
  $('#seller').addEventListener('change', (e) => { st.sellerId = e.target.value; saveSeller(st.sellerId); });
  $('#cartToggle').addEventListener('click', () => { if ($('#cart').classList.contains('open')) closeSheet(); else openSheet(); });
  $('#cartClose').addEventListener('click', closeSheet);
  const onKey = (e) => {
    const open = $('#cart').classList.contains('open');
    if (!open || document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') closeSheet();
    else if (e.key === 'Tab') { // el foco no sale del sheet
      const f = focusable($('#cart')); if (!f.length) return;
      const a = document.activeElement, first = f[0], last = f[f.length - 1];
      if (!$('#cart').contains(a)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && (a === first || a === $('#h-cart'))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey);

  $('#pay').addEventListener('click', async () => {
    if (!cart.size) return;
    const err = (m) => { const p = $('#posErr'); p.textContent = m; p.hidden = !m; };
    err('');
    const input = { paymentMethod: st.method, sellerId: st.sellerId || null, lines: [...cart].map(([itemId, qty]) => ({ itemId, qty })) };
    const btn = $('#pay'); btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      let res = await repo.createOperation(input);
      if (res.needsConfirmation) {
        const parts = [];
        if (res.negatives.length) parts.push(`<p>Esta venta deja el stock en negativo:</p><ul>${res.negatives.map((n) => `<li>${esc(n.name)}: stock ${n.stock}, se venden ${n.qty}</li>`).join('')}</ul>`);
        if (res.noCash) parts.push('<p>No hay una caja abierta: este cobro en efectivo no se sumará a ninguna caja. Podés abrirla en Caja antes de cobrar.</p>');
        btn.disabled = false; btn.removeAttribute('aria-busy'); // que el retorno de foco de modal.js encuentre #pay habilitado
        const ok = await confirmDialog({ title: res.negatives.length ? 'Stock insuficiente' : 'No hay caja abierta', danger: true, confirmText: 'Cobrar igualmente', cancelText: 'Revisar', html: true, message: `${parts.join('')}<p style="margin-top:12px">¿Confirmás la venta igualmente?</p>` });
        if (!ok) return;
        btn.disabled = true; btn.setAttribute('aria-busy', 'true');
        res = await repo.createOperation(input, { confirmNegativeStock: true, confirmNoCash: true });
      }
      cart.clear(); setOpen(false);
      toast(`Venta registrada: ${money(res.operation.total)}.`, 'success');
      await load(); paintCats(); paintGrid(); paintMethod(); paintSeller(); paintCart();
      await showTicket(res.operation);
      const q = $('#q'); if (q) q.focus(); // la vista puede haberse cerrado mientras se mostraba el ticket
    } catch (e) { if ($('#posErr')) err(e.message); toast(e.message, 'error'); }
    finally { btn.removeAttribute('aria-busy'); if ($('#lines')) paintCart(); }
  });

  await load();
  paintCats(); paintGrid(); paintMethod(); paintSeller(); paintCart();
  warmTicket(st.method);
  return () => { inertEls().forEach((n) => { n.inert = false; }); clearTimeout(liveT); document.body.classList.remove('has-cartbar'); document.removeEventListener('keydown', onKey); };
}
