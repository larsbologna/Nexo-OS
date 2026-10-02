// Formularios accesibles: label visible, hint, error con aria-describedby + aria-invalid, foco al primer error.
import { esc } from './format.js';
import { required as vRequired } from './validators.js';

let seq = 0;
/**
 * buildForm({fields, values, submitLabel, cancelLabel, onSubmit(values), onCancel})
 * field: {name,label,type,required,hint,options,validators[],min,step,span,autocomplete,placeholder}
 * onSubmit puede ser async; si lanza, se muestra el mensaje en el formulario.
 */
export function buildForm({ fields, values = {}, submitLabel = 'Guardar', cancelLabel = 'Cancelar', onSubmit, onCancel, extra = '', submitClass = 'btn-primary' }) {
  const fid = `f${++seq}`;
  const form = document.createElement('form');
  form.noValidate = true;
  form.className = 'form';
  const control = (f) => {
    const id = `${fid}-${f.name}`;
    const v = values[f.name] ?? '';
    // El hint se enlaza desde el render inicial, no solo cuando aparece un error
    const attrs = `id="${id}" name="${f.name}" ${f.hint ? `aria-describedby="${id}-hint"` : ''} ${f.required ? 'aria-required="true"' : ''} ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}`;
    if (f.type === 'select') {
      return `<select class="input" ${attrs}>${(f.options || []).map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    }
    if (f.type === 'textarea') return `<textarea class="input" rows="3" ${attrs}>${esc(v)}</textarea>`;
    return `<input class="input" type="${f.type || 'text'}" ${attrs} value="${esc(v)}" ${f.min != null ? `min="${f.min}"` : ''} ${f.step ? `step="${f.step}"` : ''} ${f.type === 'number' ? 'inputmode="decimal"' : ''}>`;
  };
  form.innerHTML = `<div class="grid grid-form">${fields.map((f) => `
    <div class="field ${f.span === 2 ? 'field-wide' : ''}">
      <label for="${fid}-${f.name}">${esc(f.label)}${f.required ? ' <span class="req" aria-hidden="true">*</span><span class="sr-only"> (obligatorio)</span>' : ''}</label>
      ${control(f)}
      ${f.hint ? `<p class="hint" id="${fid}-${f.name}-hint">${esc(f.hint)}</p>` : ''}
      <p class="field-error" id="${fid}-${f.name}-err" hidden></p>
    </div>`).join('')}</div>
    ${extra}
    <p class="form-error" role="alert" hidden></p>
    <div class="modal-actions">
      ${onCancel ? `<button type="button" class="btn btn-secondary" data-cancel>${esc(cancelLabel)}</button>` : ''}
      <button type="submit" class="btn ${submitClass}">${esc(submitLabel)}</button>
    </div>`;

  const el = (f) => form.elements[f.name];
  function setFieldError(f, msg) {
    const input = el(f), err = form.querySelector(`#${fid}-${f.name}-err`);
    const ids = [f.hint ? `${fid}-${f.name}-hint` : '', msg ? err.id : ''].filter(Boolean).join(' ');
    err.textContent = msg; err.hidden = !msg;
    if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    if (ids) input.setAttribute('aria-describedby', ids); else input.removeAttribute('aria-describedby');
  }
  function getValues() {
    const o = {};
    fields.forEach((f) => { o[f.name] = el(f).value; });
    return o;
  }
  function validateField(f, all) {
    const vs = [...(f.required ? [vRequired()] : []), ...(f.validators || [])];
    for (const fn of vs) { const m = fn(el(f).value, all); if (m) return m; }
    return '';
  }
  function validate() {
    const all = getValues();
    let firstBad = null;
    fields.forEach((f) => { const m = validateField(f, all); setFieldError(f, m); if (m && !firstBad) firstBad = f; });
    if (firstBad) el(firstBad).focus();
    return !firstBad;
  }
  fields.forEach((f) => el(f).addEventListener('blur', () => setFieldError(f, validateField(f, getValues()))));

  const formErr = form.querySelector('.form-error');
  const submitBtn = form.querySelector('[type=submit]');
  function setError(msg) { formErr.textContent = msg || ''; formErr.hidden = !msg; }
  let busy = false; // guard anti doble submit (requestSubmit sintético / doble Enter)
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!validate()) return;
    busy = true;
    submitBtn.disabled = true; submitBtn.classList.add('is-loading'); submitBtn.setAttribute('aria-busy', 'true');
    try { await onSubmit(getValues()); }
    catch (err) { setError(err.message || 'No se pudo guardar.'); }
    finally { busy = false; submitBtn.disabled = false; submitBtn.classList.remove('is-loading'); submitBtn.removeAttribute('aria-busy'); }
  });
  const cancel = form.querySelector('[data-cancel]');
  if (cancel) cancel.addEventListener('click', onCancel);
  return { el: form, setError, getValues, validate };
}
