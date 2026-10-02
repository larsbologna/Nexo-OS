// Productos y servicios (derivado de catalogo.js). El stock NO se edita acá: cambia solo con ventas, ingresos y ajustes (módulo Stock).
import * as repo from '../data/repo.js';
import * as M from '../data/metrics.js';
import cfgBase from '../../config.js';
import { createTable } from '../ui/table.js';
import { buildForm } from '../ui/form.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { positive, nonNegativeInt } from '../ui/validators.js';
import { esc, money, badge, num, pct } from '../ui/format.js';

const TABS = [['producto', 'Productos'], ['servicio', 'Servicios']];
const margin = (r) => (r.cost != null && r.price > 0 ? Math.round(((r.price - r.cost) / r.price) * 1000) / 10 : null);

function editItem(type, item) {
  const isProd = type === 'producto';
  const fields = [
    { name: 'name', label: 'Nombre', required: true, span: 2 },
    { name: 'sku', label: 'Código (SKU)' },
    { name: 'category', label: 'Categoría', hint: isProd ? 'Ej.: Remeras, Pantalones.' : 'Ej.: Servicios.' },
    { name: 'price', label: 'Precio', type: 'number', required: true, min: 0, step: '0.01', validators: [positive()], hint: 'Cambiar el precio no modifica ventas pasadas.' },
    ...(isProd ? [{ name: 'cost', label: 'Costo', type: 'number', min: 0, step: '0.01', hint: 'Cambiar el costo no modifica ventas ni Finanzas pasadas.' }] : []),
    ...(isProd ? [{ name: 'minStock', label: 'Stock mínimo', type: 'number', min: 0, step: '1', validators: [nonNegativeInt()], hint: 'Debajo o igual a este valor el producto figura como crítico.' }] : []),
    ...(isProd && !item ? [
      { name: 'trackStock', label: 'Controla stock', type: 'select', options: [{ value: 'true', label: 'Sí' }, { value: 'false', label: 'No' }], hint: 'No se puede cambiar después de crear el producto.' },
      { name: 'stock', label: 'Stock inicial', type: 'number', min: 0, step: '1', validators: [nonNegativeInt()], hint: 'Queda registrado como movimiento «inicial».' },
    ] : []),
    ...(isProd ? [{ name: 'supplier', label: 'Proveedor' }] : []),
    { name: 'active', label: 'Estado', type: 'select', options: [{ value: 'true', label: 'Activo' }, { value: 'false', label: 'Inactivo' }] },
  ];
  const values = item ? { ...item, cost: item.cost ?? '', minStock: item.minStock ?? '', category: item.category || '', supplier: item.supplier || '', active: String(item.active) } : { active: 'true', trackStock: 'true', stock: '0' };
  return openModal({
    title: `${item ? 'Editar' : 'Nuevo'} ${isProd ? 'producto' : 'servicio'}`,
    build(body, api) {
      const f = buildForm({
        fields, values, submitLabel: item ? 'Guardar cambios' : 'Crear', onCancel: () => api.close(false),
        extra: item && isProd ? '<p class="hint" style="margin-top:12px">El stock se modifica desde Stock (ingresos y ajustes), no desde acá.</p>' : '',
        async onSubmit(v) {
          const data = { name: v.name.trim(), sku: v.sku.trim(), category: (v.category || '').trim(), price: Number(v.price), active: v.active === 'true' };
          if (isProd) { data.cost = v.cost === '' ? null : Number(v.cost); data.minStock = v.minStock === '' ? null : Number(v.minStock); data.supplier = (v.supplier || '').trim() || null; }
          if (item) await repo.update('items', item.id, data);
          else await repo.create('items', { ...data, type, ...(isProd ? { trackStock: v.trackStock === 'true', stock: v.trackStock === 'true' && v.stock !== '' ? Number(v.stock) : 0 } : {}) });
          toast(item ? 'Guardado.' : 'Creado.', 'success');
          api.close(true);
        },
      });
      body.appendChild(f.el);
    },
  });
}

export async function render(el, ctx) {
  let tab = ctx.query.get('tab') === 'servicio' ? 'servicio' : 'producto';
  el.innerHTML = `<div class="page-head"><div><h1>Productos</h1><p class="sub">Lo que vendés: precios, costos y datos de cada producto o servicio.</p></div><button type="button" class="btn btn-primary" id="newI"></button></div>
    <div class="tabs" role="tablist" aria-label="Tipo de ítem">${TABS.map(([k, l]) => `<button type="button" class="tab" role="tab" id="tab-${k}" data-tab="${k}" aria-controls="panel">${l}</button>`).join('')}</div>
    <div id="panel" role="tabpanel" tabindex="-1"></div>`;
  const panel = el.querySelector('#panel');
  let table = null;

  async function mount() {
    const isProd = tab === 'producto';
    el.querySelector('#newI').textContent = isProd ? 'Nuevo producto' : 'Nuevo servicio';
    el.querySelectorAll('[data-tab]').forEach((b) => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    panel.setAttribute('aria-labelledby', `tab-${tab}`);
    panel.innerHTML = '';
    const cats = [...new Set((await repo.list('items', { archived: 'all' })).filter((i) => i.type === tab && i.category).map((i) => i.category))].sort((a, b) => a.localeCompare(b));
    table = createTable({
      caption: isProd ? 'Listado de productos' : 'Listado de servicios', pageSize: 10, archivedToggle: true, initialSearch: ctx.query.get('q') || '',
      initialSort: { key: 'name', dir: 'asc' },
      empty: { title: isProd ? 'Todavía no hay productos' : 'Todavía no hay servicios', text: 'Creá el primero con el botón de arriba.' },
      rowClass: (r) => (!r.archivedAt && M.isCriticalItem(r, cfgBase) ? 'row-critical' : ''),
      columns: [
        { key: 'sku', label: 'Código', sortable: true, cls: 'col-lg' },
        { key: 'name', label: 'Nombre', sortable: true },
        { key: 'category', label: 'Categoría', sortable: true, cls: 'col-lg', render: (r) => esc(r.category || '—') },
        { key: 'price', label: 'Precio', sortable: true, num: true, render: (r) => esc(money(r.price)) },
        ...(isProd ? [
          { key: 'cost', label: 'Costo', sortable: true, num: true, cls: 'col-lg', render: (r) => (r.cost == null ? '<span class="muted">—</span>' : esc(money(r.cost))) },
          { key: 'margin', label: 'Margen', sortable: true, num: true, value: margin, render: (r) => (margin(r) == null ? '<span class="muted">—</span>' : esc(pct(margin(r)).replace('+', ''))) },
          { key: 'stock', label: 'Stock', sortable: true, num: true, render: (r) => (r.stock == null ? '<span class="muted">—</span>' : `${esc(num(r.stock))}${M.isCriticalItem(r, cfgBase) ? ' <span class="badge badge-danger">Crítico</span>' : ''}`) },
        ] : []),
        { key: 'active', label: 'Estado', sortable: true, value: (r) => (r.archivedAt ? 'archivado' : r.active ? 'activo' : 'inactivo'), render: (r) => badge(r.archivedAt ? 'archivado' : r.active ? 'activo' : 'inactivo') },
        { key: 'actions', label: 'Acciones', render: (r) => `<span class="row-actions"><button type="button" class="btn btn-secondary btn-sm" data-action="edit" aria-label="Editar ${esc(r.name)}">Editar</button><button type="button" class="btn btn-secondary btn-sm" data-action="archive" aria-label="${r.archivedAt ? 'Restaurar' : 'Archivar'} ${esc(r.name)}">${r.archivedAt ? 'Restaurar' : 'Archivar'}</button></span>` },
      ],
      filters: [
        { key: 'active', label: 'Estado', options: [{ value: 'true', label: 'Activo' }, { value: 'false', label: 'Inactivo' }], test: (r, v) => String(r.active) === v },
        { key: 'category', label: 'Categoría', options: cats.map((c) => ({ value: c, label: c })), test: (r, v) => r.category === v },
      ],
      search: (r) => `${r.name} ${r.sku} ${r.category || ''}`,
      load: async ({ showArchived }) => (await repo.list('items', { archived: showArchived ? 'all' : false })).filter((i) => i.type === tab),
      async onAction(a, row) {
        try {
          if (a === 'edit' && await editItem(tab, row)) table.refresh();
          if (a === 'archive') {
            if (row.archivedAt) { await repo.restore('items', row.id); toast('Restaurado.', 'success'); table.refresh(); }
            else if (await confirmDialog({ title: 'Archivar', message: `${row.name} dejará de estar disponible para nuevas ventas. Las ventas pasadas y su historial de stock se conservan.`, confirmText: 'Archivar', danger: true })) { await repo.archive('items', row.id); toast('Archivado.', 'success'); table.refresh(); }
          }
        } catch (e) { toast(e.message, 'error'); }
      },
    });
    panel.appendChild(table.el);
    return table.refresh();
  }
  el.querySelectorAll('[data-tab]').forEach((b) => {
    b.addEventListener('click', () => { tab = b.dataset.tab; mount(); });
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      tab = tab === 'producto' ? 'servicio' : 'producto';
      mount().then(() => el.querySelector(`#tab-${tab}`).focus());
    });
  });
  el.querySelector('#newI').addEventListener('click', async () => { if (await editItem(tab, null)) table.refresh(); });
  await mount();
}
