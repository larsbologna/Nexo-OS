// Gráficos SVG propios (sin librerías ni CDN). Colores desde tokens; re-render con ResizeObserver.
// Barras: SIEMPRE ancladas a la base (y = línea base), alto proporcional al valor (nada cuelga desde arriba).
import { esc, moneyCompact, moneyShort, money } from './format.js';

const SR_TABLE = (rows, cap) => `<table class="sr-only"><caption>${esc(cap)}</caption><tbody>${rows.map((r) => `<tr><th scope="row">${esc(r[0])}</th><td>${esc(r[1])}</td></tr>`).join('')}</tbody></table>`;
const GRAD = '<defs><linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent)"/><stop offset="1" style="stop-color:var(--primary)"/></linearGradient></defs>';

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** data: [{label, value}] · opts: {type:'line'|'bar', format, ariaLabel, height, valueLabels (barras: etiqueta de valor bajo el día)} */
export function seriesChart(container, data, opts = {}) {
  const fmt = opts.format || money;
  const fmtAxis = opts.axisFormat || moneyCompact;
  const H = opts.height || 240;
  const bar = opts.type === 'bar';
  const vl = bar && opts.valueLabels;
  function render(width) {
    const W = Math.max(width || 320, 240);
    const m = vl ? { t: 12, r: 6, b: 46, l: 6 } : { t: 12, r: 12, b: 28, l: W < 420 ? 52 : 64 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const max = niceMax(Math.max(...data.map((d) => d.value), 0));
    const x = (i) => m.l + (data.length === 1 ? iw / 2 : (i * iw) / (data.length - 1));
    const bw = iw / data.length;
    const bx = (i) => m.l + i * bw + bw / 2;
    const base = m.t + ih; // línea base (valor 0)
    const y = (v) => base - (v / max) * ih;
    const ticks = [0, 1, 2, 3, 4].map((i) => (max * i) / 4);
    let body = ticks.map((t) => `<line class="${t === 0 ? 'base-l' : 'grid-l'}" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>${vl ? '' : `<text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(fmtAxis(t))}</text>`}`).join('');
    const every = !vl && W < 420 ? 2 : 1;
    body += data.map((d, i) => (i % every === 0 ? `<text x="${bar ? bx(i) : x(i)}" y="${vl ? H - 28 : H - 8}" text-anchor="middle">${esc(d.label)}</text>` : '')).join('');
    if (vl) body += data.map((d, i) => `<text class="bar-val" x="${bx(i)}" y="${H - 10}" text-anchor="middle">${esc(moneyShort(d.value))}</text>`).join('');
    if (bar) {
      const w = Math.max(Math.min(bw * 0.6, 56), 6);
      body += GRAD + data.map((d, i) => { const h = Math.max(base - y(d.value), 0); return `<rect class="bar" data-label="${esc(d.label)}" data-value="${d.value}" x="${bx(i) - w / 2}" y="${base - h}" width="${w}" height="${h}" rx="6"><title>${esc(d.label)}: ${esc(fmt(d.value))}</title></rect>`; }).join('');
    } else {
      const pts = data.map((d, i) => `${x(i)},${y(d.value)}`);
      body += `<polygon class="area" points="${m.l + (data.length === 1 ? iw / 2 : 0)},${base} ${pts.join(' ')} ${x(data.length - 1)},${base}"/><polyline class="line" points="${pts.join(' ')}"/>`;
      body += data.map((d, i) => `<circle class="dot" cx="${x(i)}" cy="${y(d.value)}" r="4"><title>${esc(d.label)}: ${esc(fmt(d.value))}</title></circle>`).join('');
    }
    container.innerHTML = `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.ariaLabel || 'Gráfico')}">${body}</svg>` +
      SR_TABLE(data.map((d) => [d.label, fmt(d.value)]), opts.ariaLabel || 'Datos del gráfico');
  }
  // Sin lecturas de geometría al crear: la vista acaba de inyectar su HTML y leer clientWidth acá forzaba un layout
  // síncrono de toda la página. El primer render ocurre en la primera notificación del ResizeObserver (después del
  // layout del frame y antes de pintar: leer clientWidth ahí no fuerza nada). El alto se reserva (= alto final del SVG)
  // para que no se mueva nada al aparecer y para que insertar el SVG no vuelva a cambiar el tamaño observado.
  container.style.minHeight = `${H}px`;
  let last = null;
  const ro = new ResizeObserver(() => { const w = container.clientWidth; if (w !== last) { last = w; render(w); } });
  ro.observe(container);
  return { destroy: () => ro.disconnect(), update(d) { data = d; if (last !== null) render(last); } };
}

/** slices: [{label, value}] -> dona + leyenda con valores (no depende solo del color). */
export function donut(container, slices, opts = {}) {
  const fmt = opts.format || money;
  const total = slices.reduce((s, x) => s + x.value, 0);
  const R = 70, r = 46, C = 90;
  let acc = 0;
  const arcs = total > 0 ? slices.map((s, i) => {
    const a0 = (acc / total) * Math.PI * 2 - Math.PI / 2; acc += s.value;
    const a1 = (acc / total) * Math.PI * 2 - Math.PI / 2;
    if (s.value <= 0) return '';
    if (s.value === total) return `<circle cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" stroke="var(--chart-${(i % 5) + 1})" stroke-width="${R - r}"><title>${esc(s.label)}: ${esc(fmt(s.value))}</title></circle>`;
    const p = (a, rad) => `${C + rad * Math.cos(a)},${C + rad * Math.sin(a)}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `<path fill="var(--chart-${(i % 5) + 1})" d="M${p(a0, R)} A${R},${R} 0 ${large} 1 ${p(a1, R)} L${p(a1, r)} A${r},${r} 0 ${large} 0 ${p(a0, r)} Z"><title>${esc(s.label)}: ${esc(fmt(s.value))}</title></path>`;
  }).join('') : `<circle cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" stroke="var(--border)" stroke-width="${R - r}"/>`;
  container.innerHTML = `<div class="donut"><svg class="chart" width="180" height="180" viewBox="0 0 180 180" role="img" aria-label="${esc(opts.ariaLabel || 'Distribución')}">${arcs}<text class="donut-total" x="${C}" y="${C + 5}" text-anchor="middle">${esc(opts.centerLabel || '')}</text></svg>
    <ul class="legend">${slices.map((s, i) => `<li><span class="sw" style="background:var(--chart-${(i % 5) + 1})"></span><span>${esc(s.label)}</span><strong class="num">${esc(fmt(s.value))}</strong><span class="muted num">${total ? Math.round((s.value / total) * 100) : 0}%</span></li>`).join('')}</ul></div>`;
}
