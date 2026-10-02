// Componente único de tabla: búsqueda (debounce), filtros, rango de fechas, orden (aria-sort),
// paginación, estado vacío, "mostrar archivados". En <768px las filas se muestran como cards (CSS, data-label).
import { esc, debounce } from './format.js';
import { icon } from './icons.js';

let seq = 0;
/**
 * createTable({caption, columns, load({showArchived}), search(row)->string, filters[], dateField, pageSize,
 *   empty:{title,text}, initialSearch, initialSort:{key,dir}, archivedToggle, onAction(action,row)})
 * column: {key,label,sortable,num,value(row),render(row)->html}
 * filter: {key,label,options:[{value,label}],test(row,value)}
 */
export function createTable(opts) {
  const id = `t${++seq}`;
  const state = { rows: [], q: opts.initialSearch || '', f: {}, from: '', to: '', sort: opts.initialSort || null, page: 1, archived: false, view: [] };
  const pageSize = opts.pageSize || 10;
  const root = document.createElement('div');
  root.className = 'table-card';
  root.innerHTML = `
    <div class="table-toolbar">
      <div class="field-inline"><label class="sr-only" for="${id}-q">Buscar</label><input class="input" id="${id}-q" type="search" placeholder="Buscar…" value="${esc(state.q)}" autocomplete="off"></div>
      ${(opts.filters || []).map((f) => `<div class="field-inline"><label for="${id}-${f.key}">${esc(f.label)}</label><select class="input" id="${id}-${f.key}" data-filter="${f.key}"><option value="">Todos</option>${f.options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select></div>`).join('')}
      ${opts.dateField ? `<div class="field-inline"><label for="${id}-from">Desde</label><input class="input" type="date" id="${id}-from"></div><div class="field-inline"><label for="${id}-to">Hasta</label><input class="input" type="date" id="${id}-to"></div>` : ''}
      ${opts.archivedToggle ? `<label class="check"><input type="checkbox" id="${id}-arch"> Mostrar archivados</label>` : ''}
    </div>
    <p class="sr-only" role="status" aria-live="polite" id="${id}-live"></p>
    <div class="table-wrap"><table class="table"><caption class="sr-only">${esc(opts.caption || 'Tabla de datos')}</caption>
      <thead><tr>${opts.columns.map((c) => `<th scope="col" data-key="${c.key}" class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.sortable ? `<button type="button" class="th-sort" data-sort="${c.key}">${esc(c.label)}<span class="sort-ic" aria-hidden="true"></span></button>` : esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody></tbody></table></div>
    <div class="empty" hidden></div>
    <div class="pager"><span class="pager-info"></span><div class="row"><button type="button" class="btn btn-secondary" data-prev>Anterior</button><button type="button" class="btn btn-secondary" data-next>Siguiente</button></div></div>`;
  const $ = (s) => root.querySelector(s);
  const tbody = $('tbody'), emptyEl = $('.empty'), live = $(`#${id}-live`);

  function apply() {
    let rows = state.rows;
    const q = state.q.trim().toLowerCase();
    if (q && opts.search) rows = rows.filter((r) => opts.search(r).toLowerCase().includes(q));
    (opts.filters || []).forEach((f) => { const v = state.f[f.key]; if (v) rows = rows.filter((r) => f.test(r, v)); });
    if (opts.dateField) {
      const dv = (r) => new Date(r[opts.dateField]).getTime();
      if (state.from) rows = rows.filter((r) => dv(r) >= new Date(state.from + 'T00:00:00').getTime());
      if (state.to) rows = rows.filter((r) => dv(r) <= new Date(state.to + 'T23:59:59').getTime());
    }
    if (state.sort) {
      const c = opts.columns.find((x) => x.key === state.sort.key);
      const val = (r) => (c && c.value ? c.value(r) : r[state.sort.key]);
      const dir = state.sort.dir === 'desc' ? -1 : 1;
      rows = [...rows].sort((a, b) => {
        const x = val(a), y = val(b);
        if (x == null) return 1; if (y == null) return -1;
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir;
      });
    }
    state.view = rows;
  }

  function paint() {
    apply();
    const total = state.view.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    if (state.page > pages) state.page = pages;
    const slice = state.view.slice((state.page - 1) * pageSize, state.page * pageSize);
    tbody.innerHTML = slice.map((r, i) => `<tr data-i="${i}"${opts.rowClass && opts.rowClass(r) ? ` class="${opts.rowClass(r)}"` : ''}>${opts.columns.map((c) => `<td data-label="${esc(c.label)}" class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('');
    root._slice = slice;
    root.querySelectorAll('th[data-key]').forEach((th) => {
      const on = state.sort && state.sort.key === th.dataset.key;
      if (on) th.setAttribute('aria-sort', state.sort.dir === 'desc' ? 'descending' : 'ascending'); else if (th.querySelector('.th-sort')) th.setAttribute('aria-sort', 'none');
      const ic = th.querySelector('.sort-ic'); if (ic) ic.innerHTML = on ? icon(state.sort.dir === 'desc' ? 'chevronDown' : 'chevronUp', 14) : '';
    });
    const hasRows = total > 0;
    $('.table-wrap').hidden = !hasRows;
    emptyEl.hidden = hasRows;
    if (!hasRows) {
      const filtered = state.q || Object.values(state.f).some(Boolean) || state.from || state.to;
      const e = opts.empty || {};
      emptyEl.innerHTML = `<div class="empty-ic">${icon('inbox', 32)}</div><h2 class="empty-title">${esc(filtered ? 'Sin resultados' : (e.title || 'Todavía no hay datos'))}</h2><p>${esc(filtered ? 'Probá con otra búsqueda o quitá los filtros.' : (e.text || ''))}</p>`;
    }
    const from = total ? (state.page - 1) * pageSize + 1 : 0;
    $('.pager-info').textContent = total ? `${from}–${from + slice.length - 1} de ${total}` : '0 resultados';
    $('.pager').hidden = total <= pageSize;
    $('[data-prev]').disabled = state.page <= 1;
    $('[data-next]').disabled = state.page >= pages;
    live.textContent = `${total} resultado${total === 1 ? '' : 's'}`;
  }

  async function refresh() {
    try { state.rows = await opts.load({ showArchived: state.archived }); }
    catch (e) { console.error(e); state.rows = []; $('.table-wrap').hidden = true; $('.pager').hidden = true; emptyEl.hidden = false; emptyEl.innerHTML = '<h2 class="empty-title">No se pudieron cargar los datos</h2>'; return; }
    paint();
  }

  $(`#${id}-q`).addEventListener('input', debounce((e) => { state.q = e.target.value; state.page = 1; paint(); }, 250));
  root.querySelectorAll('[data-filter]').forEach((s) => s.addEventListener('change', () => { state.f[s.dataset.filter] = s.value; state.page = 1; paint(); }));
  if (opts.dateField) {
    $(`#${id}-from`).addEventListener('change', (e) => { state.from = e.target.value; state.page = 1; paint(); });
    $(`#${id}-to`).addEventListener('change', (e) => { state.to = e.target.value; state.page = 1; paint(); });
  }
  if (opts.archivedToggle) $(`#${id}-arch`).addEventListener('change', (e) => { state.archived = e.target.checked; state.page = 1; refresh(); });
  root.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.sort;
    state.sort = state.sort && state.sort.key === k ? { key: k, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' };
    paint();
  }));
  $('[data-prev]').addEventListener('click', () => { state.page--; paint(); });
  $('[data-next]').addEventListener('click', () => { state.page++; paint(); });
  tbody.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b || !opts.onAction) return;
    const row = root._slice[Number(b.closest('tr').dataset.i)];
    opts.onAction(b.dataset.action, row, b);
  });

  return { el: root, refresh, setSearch(q) { state.q = q; $(`#${id}-q`).value = q; paint(); } };
}
