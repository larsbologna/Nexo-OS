// =====================================================================
// DEMO — NO SEGURO. Auth simulada en el cliente, SOLO para demostración.
// Reemplazar por un backend real (misma interfaz: login / logout / currentUser).
// Nunca guarda contraseñas: compara SHA-256(salt + clave) contra el hash del usuario.
// =====================================================================
import * as repo from '../data/repo.js';

const SESSION_KEY = 'nexo:v1:session';
const TTL_MS = 8 * 3600 * 1000;

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (!s || !s.userId || s.exp < Date.now()) return null;
    return s;
  } catch (e) { return null; }
}

export async function login(email, password) {
  const user = await repo.getUserByEmail(email);
  const generic = new Error('Email o contraseña incorrectos.');
  if (!user || !crypto.subtle) throw generic;
  const h = await sha256(user.salt + password);
  if (h !== user.passHash) throw generic;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id, exp: Date.now() + TTL_MS }));
  repo.setActor(user.id);
  const { passHash, salt, ...safe } = user;
  return safe;
}
export function logout() { sessionStorage.removeItem(SESSION_KEY); repo.setActor(null); }
export async function currentUser() {
  const s = readSession();
  if (!s) return null;
  const u = await repo.getUser(s.userId);
  if (!u || u.archivedAt) { logout(); return null; }
  repo.setActor(u.id);
  const { passHash, salt, ...safe } = u;
  return safe;
}
