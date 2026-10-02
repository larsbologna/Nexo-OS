// Validadores: (value, allValues) => string de error | ''
export const required = (msg = 'Este campo es obligatorio.') => (v) => (String(v ?? '').trim() ? '' : msg);
export const email = (msg = 'Ingresá un email válido.') => (v) => (!v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim()) ? '' : msg);
export const positive = (msg = 'Debe ser un número mayor a 0.') => (v) => (Number(v) > 0 ? '' : msg);
export const nonNegativeInt = (msg = 'Debe ser un entero de 0 o más.') => (v) => (v === '' || v == null || (Number.isInteger(Number(v)) && Number(v) >= 0) ? '' : msg);
export const minLen = (n) => (v) => (!v || String(v).trim().length >= n ? '' : `Mínimo ${n} caracteres.`);
