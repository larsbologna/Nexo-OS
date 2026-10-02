import * as auth from '../auth/auth.mock.js';
import { buildForm } from '../ui/form.js';
import { email } from '../ui/validators.js';
import { navigate } from '../router.js';
import { getConfig } from '../store.js';
import { esc } from '../ui/format.js';

export async function render(el) {
  const c = getConfig();
  el.innerHTML = `<div class="login-wrap"><div class="card login-card">
    <div class="login-brand"><span class="brand-mark" aria-hidden="true">${esc(c.brandMark || 'NX')}</span><div><h1>${esc(c.appName)}</h1><p class="muted small">${esc(c.tagline || '')}</p></div></div>
    <div class="demo-banner"><strong>Modo demostración — no seguro.</strong> Datos de ejemplo guardados en este navegador.<br>Email: <code>admin@demo.local</code> · Clave: <code>Demo2026!</code></div>
    <div id="loginForm"></div></div></div>`;
  const f = buildForm({
    fields: [
      { name: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'username', validators: [email()] },
      { name: 'password', label: 'Contraseña', type: 'password', required: true, autocomplete: 'current-password' },
    ],
    submitLabel: 'Ingresar',
    async onSubmit(v) {
      await auth.login(v.email, v.password);
      navigate('/dashboard');
    },
  });
  el.querySelector('#loginForm').appendChild(f.el);
  f.el.elements.email.focus();
}
