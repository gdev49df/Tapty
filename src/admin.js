// Вход в модерацию: ключ ADMIN_KEY и, если задан секрет ADMIN_TOTP, код из приложения.
import { attempt, fail, json, readJson, safeEqual } from './util.js';
import { checkPass, issuePass, secretBytes, useCode } from './totp.js';

async function checkKey(request, env, who) {
  // Без секрета ADMIN_KEY админки не существует.
  if (!env.ADMIN_KEY) fail(404, 'not_found');
  let given = request.headers.get('x-admin-key') || '';
  try {
    given = decodeURIComponent(given);
  } catch {}
  // После 20 неверных ключей за час с адреса не принимается и верный.
  const passed = await attempt(env, `admin:${who.ip}`, 20, 3600);
  if (!(await safeEqual(given, env.ADMIN_KEY))) fail(403, 'forbidden');
  await passed();
}

// Обмен кода из приложения на пропуск.
export async function openAdmin(request, env, who) {
  await checkKey(request, env, who);
  if (!env.ADMIN_TOTP) fail(404, 'not_found');
  const key = secretBytes(env.ADMIN_TOTP);
  if (!key) fail(403, 'totp_config');
  const body = await readJson(request);
  // Общий предел на все адреса: знающий ключ не должен перебирать миллион кодов.
  const passed = await attempt(env, 'admin-code', 30, 3600);
  if (!(await useCode(env, key, String(body.code ?? '').replace(/\s/g, '')))) fail(403, 'bad_totp');
  await passed();
  return json({ pass: await issuePass(env) });
}

export async function requireAdmin(request, env, who) {
  await checkKey(request, env, who);
  if (env.ADMIN_TOTP && !(await checkPass(env, request.headers.get('x-admin-pass')))) fail(403, 'code_required');
}
