// Второй шаг входа в модерацию: шестизначный код из приложения-аутентификатора (TOTP, RFC 6238),
// после него выдаётся пропуск на 12 часов.
import { hit, now, safeEqual } from './util.js';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;
const PASS_SECONDS = 12 * 3600;
const text = new TextEncoder();

// Пробелы и «=» допускаются. Слишком короткий или с посторонними знаками секрет — null.
export function secretBytes(secret) {
  const clean = String(secret).toUpperCase().replace(/[\s=-]/g, '');
  if (!/^[A-Z2-7]{16,}$/.test(clean)) return null;
  const out = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    value = ((value << 5) | BASE32.indexOf(char)) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 255);
    }
  }
  return new Uint8Array(out);
}

async function hmac(hash, key, message) {
  const imported = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, message));
}

export async function codeAt(key, step) {
  const counter = new DataView(new ArrayBuffer(8));
  counter.setBigUint64(0, BigInt(step));
  const mac = await hmac('SHA-1', key, counter.buffer);
  const at = mac[mac.length - 1] & 15;
  const number = new DataView(mac.buffer).getUint32(at) & 0x7fffffff;
  return String(number % 1_000_000).padStart(6, '0');
}

// Годится код текущего и соседних отрезков (часы телефона могут расходиться), но только один раз.
export async function useCode(env, key, code) {
  const current = Math.floor(now() / STEP);
  for (const step of [current, current - 1, current + 1]) {
    if (await safeEqual(code, await codeAt(key, step))) return hit(env, `totp-used:${step}`, 1, STEP * 4);
  }
  return false;
}

// Пропуск подписан обоими секретами: замена любого из них отменяет все выданные.
async function signature(env, expires) {
  const key = text.encode(`${env.ADMIN_KEY}\n${env.ADMIN_TOTP}`);
  const mac = await hmac('SHA-256', key, text.encode(`admin-pass:${expires}`));
  return [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function issuePass(env) {
  const expires = now() + PASS_SECONDS;
  return `${expires}.${await signature(env, expires)}`;
}

export async function checkPass(env, pass) {
  const m = /^(\d{10})\.([a-f0-9]{64})$/.exec(pass || '');
  return Boolean(m && Number(m[1]) > now() && (await safeEqual(m[2], await signature(env, Number(m[1])))));
}
