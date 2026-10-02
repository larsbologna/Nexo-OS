import * as repo from '../data/repo.js';
import * as auth from '../auth/auth.mock.js';
import baseConfig from '../../config.js';
import { getConfig, setOverrides } from '../store.js';
import { buildForm } from '../ui/form.js';
import { confirmDialog } from '../ui/modal.js';
import { navigate } from '../router.js';
import { toast } from '../ui/toast.js';
import { esc, METHODS } from '../ui/format.js';
import { showTicket } from './ventas.js';

const CURRENCIES = [['ARS', 'Peso argentino (ARS)'], ['USD', 'Dólar estadounidense (USD)'], ['EUR', 'Euro (EUR)'], ['MXN', 'Peso mexicano (MXN)'], ['CLP', 'Peso chileno (CLP)'], ['COP', 'Peso colombiano (COP)']];
const LOCALES = [['es-AR', 'Español (Argentina)'], ['es-MX', 'Español (México)'], ['es-ES', 'Español (España)'], ['en-US', 'English (US)']];

export async function render(el, ctx) {
  const c = getConfig();
  const user = await auth.currentUser();
  el.innerHTML = `<div class="page-head"><div><h1>Configuración</h1><p class="sub">Datos del local, métodos de pago y datos de la demo.</p></div></div>
    <div class="stack">
      <section class="card" aria-labelledby="h-neg"><div class="card-head"><h2 id="h-neg">Datos del local</h2></div><div id="bizForm"></div></section>
      <section class="card" aria-labelledby="h-pago"><div class="card-head"><h2 id="h-pago">Métodos de pago</h2></div>
        <p class="muted small" style="margin-bottom:8px">Los habilitados aparecen en Ventas y Gastos. Solo el efectivo suma a la caja diaria.</p>
        <div id="payBox" class="stack" style="gap:0">${baseConfig.paymentMethods.map((m) => `<label class="check"><input type="checkbox" name="pm" value="${m}" ${c.paymentMethods.includes(m) ? 'checked' : ''}> ${esc(METHODS[m] || m)}</label>`).join('')}</div>
        <p class="form-error" id="payErr" role="alert" hidden></p>
        <div class="row" style="margin-top:12px"><button type="button" class="btn btn-primary" id="savePay">Guardar métodos</button></div></section>
      <section class="card" aria-labelledby="h-imp"><div class="card-head"><h2 id="h-imp">Impresión de tickets</h2></div>
        <p class="muted small" style="margin-bottom:12px">El ticket usa los datos del local. Se imprime desde el navegador.</p>
        <button type="button" class="btn btn-secondary" id="testTicket">Probar impresión</button></section>
      <section class="card" aria-labelledby="h-datos"><div class="card-head"><h2 id="h-datos">Datos</h2></div>
        <p class="muted small" style="margin-bottom:12px">Los datos de ejemplo se guardan solo en este navegador.</p>
        <div class="row"><button type="button" class="btn btn-secondary" id="exp">Exportar JSON</button><button type="button" class="btn btn-danger" id="rst">Restablecer datos de demo</button></div></section>
      <section class="card" aria-labelledby="h-cta"><div class="card-head"><h2 id="h-cta">Cuenta</h2></div>
        <dl class="kv"><dt>Usuario</dt><dd>${esc(user ? user.name : '')}</dd><dt>Email</dt><dd>${esc(user ? user.email : '')}</dd><dt>Rol</dt><dd>${esc(user ? user.role : '')}</dd></dl>
        <p class="demo-banner" style="margin-top:12px">Autenticación de demostración — no segura. Reemplazala por un backend real antes de usar datos reales.</p>
        <button type="button" class="btn btn-secondary" id="logoutCfg">Cerrar sesión</button></section>
    </div>`;

  const save = async (patch) => {
    await repo.saveSettings(patch);
    const cur = await repo.getSettings();
    setOverrides({ branding: cur.branding || {}, business: cur.business || {}, paymentMethods: cur.paymentMethods });
    toast('Configuración guardada.', 'success');
    render(el, ctx);
  };

  const f = buildForm({
    fields: [
      { name: 'name', label: 'Nombre del local', required: true },
      { name: 'taxId', label: 'CUIT' },
      { name: 'address', label: 'Dirección', span: 2 },
      { name: 'appName', label: 'Nombre de la app', required: true },
      { name: 'currency', label: 'Moneda', type: 'select', options: CURRENCIES.map(([value, label]) => ({ value, label })) },
      { name: 'locale', label: 'Idioma / formato', type: 'select', options: LOCALES.map(([value, label]) => ({ value, label })) },
    ],
    values: { name: c.business.name, taxId: c.business.taxId, address: c.business.address, appName: c.appName, currency: c.currency, locale: c.locale },
    submitLabel: 'Guardar',
    extra: '<div class="row" style="margin-top:12px"><button type="button" class="btn btn-secondary" id="resetBrand">Restaurar valores de config.js</button></div>',
    async onSubmit(v) {
      await save({ business: { name: v.name.trim(), taxId: v.taxId.trim(), address: v.address.trim() }, branding: { appName: v.appName.trim(), currency: v.currency, locale: v.locale } });
    },
  });
  el.querySelector('#bizForm').appendChild(f.el);
  f.el.querySelector('#resetBrand').addEventListener('click', async () => { await save({ business: {}, branding: {} }); });

  el.querySelector('#savePay').addEventListener('click', async () => {
    const chosen = [...el.querySelectorAll('input[name=pm]:checked')].map((i) => i.value);
    const err = el.querySelector('#payErr');
    if (!chosen.length) { err.textContent = 'Dejá al menos un método de pago habilitado.'; err.hidden = false; return; }
    err.hidden = true;
    await save({ paymentMethods: chosen });
  });
  el.querySelector('#testTicket').addEventListener('click', () => {
    const t = new Date().toISOString();
    showTicket({ id: 'prueba00-0000', date: t, lines: [{ nameSnapshot: 'Producto de prueba', qty: 2, unitPrice: 1000 }], total: 2000, paymentMethod: 'efectivo', status: 'pagada' });
  });
  el.querySelector('#logoutCfg').addEventListener('click', () => { auth.logout(); navigate('/login'); });

  el.querySelector('#exp').addEventListener('click', async () => {
    try {
      const data = await repo.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `export-${new Date().toISOString().slice(0, 10)}.json`;
      // No hay evento de "descarga terminada": revocar con margen amplio (a 1 s una descarga lenta se cancelaba)
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      toast('Exportación lista (sin credenciales).', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });
  el.querySelector('#rst').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Restablecer datos de demo', message: 'Se reemplazarán TODOS los datos locales (productos, ventas, stock, gastos, cajas, notificaciones) por los datos de ejemplo. Esta acción no se puede deshacer.', confirmText: 'Restablecer', danger: true });
    if (!ok) return;
    try { await repo.resetDemo(); toast('Datos de demo restablecidos.', 'success'); setTimeout(() => location.reload(), 600); } catch (e) { toast(e.message, 'error'); }
  });
}
