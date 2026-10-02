// Estado de UI (config efectiva) + pub/sub. No accede a datos de negocio. Solo tema oscuro: no hay estado de tema.
import baseConfig from '../config.js';

const listeners = new Map();
let overrides = {};
let config = merge(baseConfig, overrides);

function merge(base, o) {
  const b = (o && o.branding) || {};
  const biz = (o && o.business) || {};
  const pm = o && Array.isArray(o.paymentMethods) ? o.paymentMethods.filter((m) => base.paymentMethods.includes(m)) : null;
  return {
    ...base,
    appName: b.appName || base.appName,
    currency: b.currency || base.currency,
    locale: b.locale || base.locale,
    business: { ...base.business, ...Object.fromEntries(Object.entries(biz).filter(([, v]) => v != null && v !== '')) },
    paymentMethods: pm && pm.length ? pm : base.paymentMethods,
  };
}

export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}
export function emit(evt, payload) {
  (listeners.get(evt) || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });
}

export function getConfig() { return config; }
/** o: {branding:{appName,currency,locale}, business:{name,address,taxId}, paymentMethods:[...]} */
export function setOverrides(o) { overrides = o || {}; config = merge(baseConfig, overrides); emit('config', config); }

/** Aplica config al DOM: idioma, marca (nombre, subtítulo). */
export function applyBranding() {
  const c = config;
  document.documentElement.lang = String(c.locale).split('-')[0];
  const name = document.getElementById('brandName'); if (name) name.textContent = c.appName;
  const sub = document.getElementById('brandSub'); if (sub) sub.textContent = c.tagline || '';
}
