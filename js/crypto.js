// Cifrado de la copia de seguridad con WebCrypto: AES-GCM 256 + PBKDF2-SHA256.
// Todo ocurre en el navegador; la contraseña no se guarda en ningún sitio.
const ITER = 250000;

function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function fromB64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function deriveKey(pass, salt, iterations) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

export async function encryptText(text, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITER);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return JSON.stringify({
    format: 'agenda-encrypted', version: 1, cipher: 'AES-GCM', kdf: 'PBKDF2-SHA256',
    iterations: ITER, salt: toB64(salt), iv: toB64(iv), ciphertext: toB64(ct)
  }, null, 2);
}

export async function decryptText(envelopeText, passphrase) {
  let env;
  try { env = JSON.parse(envelopeText); } catch { throw new Error('el fichero no es válido'); }
  if (!env || env.format !== 'agenda-encrypted' || !env.ciphertext) throw new Error('no es un fichero cifrado de la agenda');
  const key = await deriveKey(passphrase, fromB64(env.salt), env.iterations || ITER);
  let pt;
  try {
    pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) }, key, fromB64(env.ciphertext));
  } catch {
    throw new Error('contraseña incorrecta');
  }
  return new TextDecoder().decode(pt);
}

export function isEncrypted(text) {
  try { const o = JSON.parse(text); return !!(o && o.format === 'agenda-encrypted'); }
  catch { return false; }
}
