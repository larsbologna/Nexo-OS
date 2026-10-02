// Toasts en la región role="status" de index.html.
export function toast(message, type = 'info', ms = type === 'error' ? 8000 : 4500) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  if (type === 'error') el.setAttribute('role', 'alert'); // errores se anuncian de inmediato, no "polite"
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
