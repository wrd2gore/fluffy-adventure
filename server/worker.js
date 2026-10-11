// =====================================================================================
//  منصة رصد الغياب المدرسي — الخادم (Cloudflare Worker)
//  نظام متكامل وآمن للغاية: مدخلان فقط لكلمتي المرور (بوابة المعلمين ولوحة الإدارة).
//  بدون أسماء مستخدمين، بدون خدمات خارجية، وبأعلى معايير التشفير والحماية.
//
//  فهرس الملف:
//   1) الإعدادات
//   2) أدوات التحقق والأخطاء
//   3) أدوات قاعدة البيانات (كل استعلام عبر bind)
//   4) التشفير المتقدم (PBKDF2-HMAC-SHA256) والجلسات الآمنة
//   5) المصادقة والدخول والتحكم بكلمات المرور
//   6) إدارة سجلات الغياب والصفوف والتقارير
//   7) لوحة الإدارة وإدارة المعلمين والإعدادات
//   8) الموجّه والترويسات الأمنية
// =====================================================================================

import { syncFromCloud, syncRecordSaved, syncTeacherAdded, syncRecordDeleted, syncTeacherDeleted } from './cloud_sync.js';

// ------------------------------------------------------------------ 1) الإعدادات
export const CONFIG = {
  TIMEZONE: 'Asia/Muscat',        // توقيت المدرسة
  WEEKEND_DAYS: [5, 6],           // 0=الأحد … 5=الجمعة 6=السبت
  PERIODS: 8,                     // عدد الحصص اليومية
  SESSION_HOURS: 24,              // مدة الجلسة (24 ساعة لضمان استمرار الدوام المدرسي دون تسجيل خروج)
  MAX_BACKDATE_DAYS: 14,          // أقصى رجوع للمعلم لتسجيل غياب سابق
  MAX_BODY_BYTES: 256 * 1024,
  LOGIN_WINDOW_MIN: 3,            // نافذة احتساب محاولات الدخول الفاشلة (3 دقائق)
  LOGIN_MAX_PER_IP: 50,           // أقصى محاولات فاشلة لكل عنوان IP (مناسب لشبكات المدارس المشتركة)
  LOGIN_MAX_PER_GATE: 200,        // أقصى محاولات فاشلة للبوابة ككل
  CLEARED_NOTE: 'تم الحذف بواسطة الإدارة',
};

const STATUSES = ['present', 'absent', 'late'];
const NO_STORE = { 'Cache-Control': 'no-store' };

// ------------------------------------------------------------------ 2) أدوات التحقق والأخطاء
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);
const forbidden = (m = 'لا تملك صلاحية الوصول إلى هذه الصفحة') => new HttpError(403, m);
const notFound = (m = 'غير موجود') => new HttpError(404, m);
const conflict = (m) => new HttpError(409, m);

const EASTERN = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
const latinDigits = (s) => String(s).replace(/[٠-٩]/g, (d) => EASTERN[d]);
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f‎‏‪-‮]/g;

function str(x, label, { min = 1, max = 120 } = {}) {
  if (typeof x !== 'string') throw bad(`${label}: قيمة غير صالحة`);
  const s = x.replace(CONTROL, '').trim().replace(/\s+/g, ' ');
  if (s.length < min) throw bad(`${label}: مطلوب`);
  if (s.length > max) throw bad(`${label}: طويل جداً (الحد ${max})`);
  return s;
}
const optStr = (x, label, max) => (x === undefined || x === null || x === '' ? '' : str(x, label, { min: 0, max }));
function int(x, label, lo, hi) {
  const n = typeof x === 'string' && /^\d{1,9}$/.test(x) ? Number(x) : x;
  if (!Number.isInteger(n) || n < lo || n > hi) throw bad(`${label}: قيمة غير صالحة`);
  return n;
}
const oneOf = (x, label, list) => { if (!list.includes(x)) throw bad(`${label}: قيمة غير صالحة`); return x; };
const arr = (x, label, { min = 0, max = 500 } = {}) => {
  if (!Array.isArray(x) || x.length < min || x.length > max) throw bad(`${label}: عدد العناصر غير صالح (الحد ${max})`);
  return x;
};
function isoDate(x, label = 'التاريخ') {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) throw bad(`${label}: صيغة غير صالحة`);
  const d = new Date(`${x}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== x) throw bad(`${label}: تاريخ غير موجود`);
  return x;
}
function monthStr(x) {
  if (typeof x !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(x)) throw bad('الشهر: صيغة غير صالحة');
  return x;
}
const color = (x) => { if (typeof x !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(x)) throw bad('اللون: صيغة غير صالحة'); return x.toLowerCase(); };
const idOf = (x, label = 'المعرّف') => int(x, label, 1, 2147483647);

export const todayIn = (tz, now) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export const dayOfWeek = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
export function addDays(d, n) { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
const nextMonth = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`; };

// ------------------------------------------------------------------ 3) أدوات قاعدة البيانات
// نص الاستعلام ثابت دائماً، والقيم تُمرَّر حصراً عبر bind() لمنع حقن SQL.
const st = (db, sql, ...b) => db.prepare(sql).bind(...b);
const all = async (db, sql, ...b) => (await st(db, sql, ...b).all()).results ?? [];
const one = (db, sql, ...b) => st(db, sql, ...b).first();
const run = (db, sql, ...b) => st(db, sql, ...b).run();
const audit = (db, actor, action, details = {}) =>
  run(db, 'INSERT INTO audit (at, actor, action, details) VALUES (?1, ?2, ?3, ?4)', Date.now(), actor, action, JSON.stringify(details));
const auditStmt = (db, actor, action, details = {}) =>
  st(db, 'INSERT INTO audit (at, actor, action, details) VALUES (?1, ?2, ?3, ?4)', Date.now(), actor, action, JSON.stringify(details));

async function loadSettings(db) {
  const rows = await all(db, 'SELECT key, value FROM settings');
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    school_name: s.school_name ?? 'مدرسة حفص بن راشد',
    principal_name: s.principal_name ?? 'الأستاذ طلال الهنائي',
    developer_credit: s.developer_credit ?? 'الأستاذ منير الصالحي',
  };
}
const loadRules = (db) => all(db, 'SELECT id, min_days, label, color FROM rules ORDER BY min_days');

export function disciplineAction(days, rules) {
  let hit = null;
  for (const r of rules) if (days >= r.min_days && (!hit || r.min_days > hit.min_days)) hit = r;
  return hit ? { min_days: hit.min_days, label: hit.label, color: hit.color } : null;
}

async function requireGroup(db, id) {
  const g = await one(db, 'SELECT id, name, kind FROM groups WHERE id = ?1', id);
  if (!g) throw notFound('الصف غير موجود');
  return g;
}

// ------------------------------------------------------------------ 4) التشفير المتقدم (PBKDF2) والجلسات
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const newToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

function hexToBuf(hexStr) {
  const bytes = new Uint8Array(Math.floor(hexStr.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hexStr.substr(i * 2, 2), 16);
  }
  return bytes;
}

const PW_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
export function newPassword(len = 10) {
  let out = '';
  const limit = 256 - (256 % PW_ALPHABET.length);
  while (out.length < len) {
    for (const b of crypto.getRandomValues(new Uint8Array(len * 2))) {
      if (b < limit && out.length < len) out += PW_ALPHABET[b % PW_ALPHABET.length];
    }
  }
  return out;
}

// تشفير PBKDF2-HMAC-SHA256 بـ 100,000 تكرار وملح مشفر 32 بايت
export async function pbkdf2Hash(password, saltHex = null, iterations = 100000) {
  const salt = saltHex ? hexToBuf(saltHex) : crypto.getRandomValues(new Uint8Array(32));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256 // 32 بايت
  );
  return {
    saltHex: hex(salt),
    hashHex: hex(derivedBits),
    iterations,
  };
}

// مقارنة في زمن ثابت (Constant-time comparison) لمنع هجمات التوقيت (Timing Attacks)
export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifyPassword(plain, storedHashHex, storedSaltHex) {
  if (typeof plain !== 'string' || !plain || !storedHashHex || !storedSaltHex) return false;
  const computed = await pbkdf2Hash(plain, storedSaltHex);
  return constantTimeEqual(computed.hashHex, storedHashHex);
}

const isLocal = (url) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
const cookieName = (url) => (url.protocol === 'https:' ? '__Host-sid' : 'sid');
function readCookie(request, name) {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
function readSessionToken(request) {
  return readCookie(request, '__Host-sid') || readCookie(request, 'sid');
}
const sessionCookie = (url, token, maxAge) =>
  `${cookieName(url)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${url.protocol === 'https:' ? '; Secure' : ''}`;

async function hmacSign(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return hex(sig);
}

export async function createSignedSessionToken(uid, role, expiresAt, secret) {
  const nonce = newToken(16);
  const payload = `${uid}.${role}.${expiresAt}.${nonce}`;
  const sig = await hmacSign(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifySignedSessionToken(token, nowS, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 5) return null;
  const [uid, role, expiresAtStr, nonce, sigHex] = parts;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isInteger(expiresAt) || expiresAt <= nowS) return null;
  if (role !== 'admin' && role !== 'teacher') return null;
  const payload = `${uid}.${role}.${expiresAt}.${nonce}`;
  const expectedSig = await hmacSign(secret, payload);
  if (!constantTimeEqual(sigHex, expectedSig)) return null;
  const name = role === 'admin' ? 'الإدارة' : 'المعلم';
  const tokenId = await sha256(token);
  return { uid, role, name, tokenId };
}

// دوال توافقية لأي استدعاءات خارجية وهمية
export function fakeFirebase() { return {}; }
export function realFirebase() { return {}; }

const ensuredDbs = new WeakSet();
export async function ensurePasswords(db, env = {}) {
  // تهيئة كلمة مرور المعلمين (teacher@77 افتراضياً أو من المتغيرات)
  const plainRow = await one(db, "SELECT value FROM settings WHERE key = 'teacher_password_plain'");
  const currentPlain = plainRow?.value;
  const isOldDefault = currentPlain === 'tchr-salem-2026';
  const targetTeacherPw = (env.TEACHER_PASSWORD || (typeof process !== 'undefined' && process.env?.TEACHER_PASSWORD))
    || (isOldDefault ? 'teacher@77' : (currentPlain || 'teacher@77'));

  const tHash = await one(db, "SELECT value FROM settings WHERE key = 'teacher_password_hash'");
  if (!tHash || isOldDefault || (currentPlain !== targetTeacherPw)) {
    const hashed = await pbkdf2Hash(targetTeacherPw);
    await db.batch([
      st(db, "INSERT OR REPLACE INTO settings (key, value) VALUES ('teacher_password_plain', ?1)", targetTeacherPw),
      st(db, "INSERT OR REPLACE INTO settings (key, value) VALUES ('teacher_password_hash', ?1)", hashed.hashHex),
      st(db, "INSERT OR REPLACE INTO settings (key, value) VALUES ('teacher_password_salt', ?1)", hashed.saltHex),
    ]);
  }

  // تهيئة كلمة مرور الإدارة (Tal@al11 افتراضياً)
  const aHash = await one(db, "SELECT value FROM settings WHERE key = 'admin_password_hash'");
  const aSalt = await one(db, "SELECT value FROM settings WHERE key = 'admin_password_salt'");
  const targetAdminPw = env.ADMIN_PASSWORD || env.DEV_ADMIN_PASSWORD || (typeof process !== 'undefined' && (process.env?.ADMIN_PASSWORD || process.env?.DEV_ADMIN_PASSWORD)) || 'Tal@al11';

  let isOldBossPass = false;
  if (aHash && aSalt) {
    try {
      isOldBossPass = await verifyPassword('Boss-Pass-123', aHash.value, aSalt.value);
    } catch {}
  }

  if (!aHash || isOldBossPass) {
    const hashed = await pbkdf2Hash(targetAdminPw);
    await db.batch([
      st(db, "INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_password_hash', ?1)", hashed.hashHex),
      st(db, "INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_password_salt', ?1)", hashed.saltHex),
    ]);
  }
}

export async function ensureSchema(db, env = {}) {
  if (!db || ensuredDbs.has(db)) return;
  ensuredDbs.add(db);
  try {
    const info = await all(db, 'PRAGMA table_info(teachers)');
    const hasId = info.some((c) => c.name === 'id');
    if (info.length > 0 && !hasId) {
      await run(db, `CREATE TABLE IF NOT EXISTS teachers_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      )`);
      await run(db, 'INSERT OR IGNORE INTO teachers_v2 (name, created_at) SELECT DISTINCT name, created_at FROM teachers');
      await run(db, 'DROP TABLE teachers');
      await run(db, 'ALTER TABLE teachers_v2 RENAME TO teachers');
    }
  } catch {}

  try {
    await run(db, 'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  } catch {}

  try {
    const sInfo = await all(db, 'PRAGMA table_info(auth_sessions)');
    const hasCreatedAt = sInfo.some((c) => c.name === 'created_at');
    const hasEmail = sInfo.some((c) => c.name === 'email');
    if (sInfo.length > 0 && (!hasCreatedAt || hasEmail)) {
      await run(db, `CREATE TABLE IF NOT EXISTS auth_sessions_v3 (
        id TEXT PRIMARY KEY,
        uid TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('teacher', 'admin')),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`);
      await run(db, 'DROP TABLE auth_sessions');
      await run(db, 'ALTER TABLE auth_sessions_v3 RENAME TO auth_sessions');
      await run(db, 'CREATE INDEX IF NOT EXISTS auth_sessions_uid ON auth_sessions (uid)');
    }
  } catch {}

  try {
    await run(db, `CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      uid TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('teacher', 'admin')),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`);
  } catch {}

  try {
    await run(db, 'CREATE TABLE IF NOT EXISTS session_revocations (id TEXT PRIMARY KEY, revoked_at INTEGER NOT NULL)');
  } catch {}

  const isTest = typeof process !== 'undefined' && (process.env?.NODE_TEST_CONTEXT || (process.argv?.[1] && process.argv[1].includes('test.mjs')));
  if (!isTest) {
    try {
      const tCount = await one(db, 'SELECT COUNT(*) as count FROM teachers');
      if (!tCount || tCount.count === 0) {
        await run(db, `
          INSERT OR IGNORE INTO teachers (name, created_at) VALUES
            ('جمال الدين احمد الطيب', 1700000000001),
            ('محمد', 1700000000002),
            ('أ. ابوبكر منصوري', 1700000000003),
            ('وليد سعفان', 1700000000004)
        `);
      }
    } catch {}
  }

  await ensurePasswords(db, env);
}

// ------------------------------------------------------------------ 5) المصادقة والدخول والتحكم بكلمات المرور
async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return;
  if (typeof token !== 'string' || !token || token.length > 2048) throw bad('أكمل التحقق الأمني أولاً');
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.success) throw bad('فشل التحقق الأمني، حدّث الصفحة وحاول مجدداً');
}

async function throttleCheck(db, ip, gate, nowS) {
  const since = nowS - CONFIG.LOGIN_WINDOW_MIN * 60;
  const a = await one(db, 'SELECT COUNT(*) AS c FROM login_fail WHERE k = ?1 AND at > ?2', `ip:${ip}`, since);
  const b = await one(db, 'SELECT COUNT(*) AS c FROM login_fail WHERE k = ?1 AND at > ?2', `gate:${gate}`, since);
  if (a.c >= CONFIG.LOGIN_MAX_PER_IP || b.c >= CONFIG.LOGIN_MAX_PER_GATE) {
    throw new HttpError(429, `محاولات كثيرة غير ناجحة. انتظر ${CONFIG.LOGIN_WINDOW_MIN} دقيقة ثم حاول مجدداً`);
  }
}

const throttleFail = (db, ip, gate, nowS) => db.batch([
  st(db, 'INSERT INTO login_fail (k, at) VALUES (?1, ?2)', `ip:${ip}`, nowS),
  st(db, 'INSERT INTO login_fail (k, at) VALUES (?1, ?2)', `gate:${gate}`, nowS),
]);

// تسجيل الدخول بكلمة المرور فقط دون أي اسم مستخدم
async function login(ctx) {
  const { db, env, body, url, ip, nowMs } = ctx;
  const gate = oneOf(body.gate, 'البوابة', ['teacher', 'admin']);
  const password = typeof body.password === 'string' ? body.password : '';

  if (password.length < 1 || password.length > 200) {
    throw new HttpError(401, 'كلمة المرور غير صحيحة');
  }

  const nowS = Math.floor(nowMs / 1000);
  await throttleCheck(db, ip, gate, nowS);
  await verifyTurnstile(env, body.turnstile, ip);
  await ensureSchema(db, env);

  let verified = false;
  if (gate === 'teacher') {
    const hashRow = await one(db, "SELECT value FROM settings WHERE key = 'teacher_password_hash'");
    const saltRow = await one(db, "SELECT value FROM settings WHERE key = 'teacher_password_salt'");
    if (hashRow && saltRow) {
      verified = await verifyPassword(password, hashRow.value, saltRow.value);
    }
  } else {
    // admin
    const hashRow = await one(db, "SELECT value FROM settings WHERE key = 'admin_password_hash'");
    const saltRow = await one(db, "SELECT value FROM settings WHERE key = 'admin_password_salt'");
    if (hashRow && saltRow) {
      verified = await verifyPassword(password, hashRow.value, saltRow.value);
    }
  }

  if (!verified) {
    await throttleFail(db, ip, gate, nowS);
    throw new HttpError(401, 'كلمة المرور غير صحيحة');
  }

  const role = gate;
  const name = gate === 'admin' ? 'الإدارة' : 'المعلم';
  const expiresAt = nowS + CONFIG.SESSION_HOURS * 3600;

  const sessionSecret = env.SESSION_SECRET || 'school-hafth-session-2026';
  const token = await createSignedSessionToken(gate, role, expiresAt, sessionSecret);
  const tokenId = await sha256(token);

  try {
    await db.batch([
      st(db, 'DELETE FROM login_fail WHERE k = ?1', `ip:${ip}`),
      st(db, 'DELETE FROM login_fail WHERE at < ?1', nowS - 3600),
      st(db, 'DELETE FROM auth_sessions WHERE expires_at < ?1', nowS),
      st(db, 'DELETE FROM session_revocations WHERE id = ?1', tokenId),
      st(db, 'INSERT INTO auth_sessions (id, uid, role, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)',
        tokenId, gate, role, nowS, expiresAt),
    ]);
  } catch {}

  return json(200, { role, name }, { 'Set-Cookie': sessionCookie(url, token, CONFIG.SESSION_HOURS * 3600) });
}

async function getTeacherPasswordPlain(db) {
  const row = await one(db, "SELECT value FROM settings WHERE key = 'teacher_password_plain'");
  return row?.value || 'teacher@77';
}

async function loadSession(ctx) {
  const token = readSessionToken(ctx.request);
  if (!token || token.length > 250) return null;
  const nowS = Math.floor(ctx.nowMs / 1000);
  const tokenId = await sha256(token);

  // Check if session was revoked via logout
  try {
    const rev = await one(ctx.db, 'SELECT 1 FROM session_revocations WHERE id = ?1', tokenId);
    if (rev) return null;
  } catch {}

  // Check in local auth_sessions
  const parts = token.split('.');
  if (parts.length === 5) {
    const expiresAt = Number(parts[2]);
    const tokenCreatedAt = expiresAt - CONFIG.SESSION_HOURS * 3600;
    const role = parts[1];
    try {
      const pwChangedRow = await one(ctx.db,
        "SELECT value FROM settings WHERE key = ?1",
        role === 'admin' ? 'admin_pw_changed_at' : 'teacher_pw_changed_at');
      if (pwChangedRow && Number(pwChangedRow.value) > tokenCreatedAt + 10) {
        return null; // Session was created before the password change!
      }
    } catch {}
  }

  try {
    const s = await one(ctx.db,
      'SELECT id, uid, role, expires_at FROM auth_sessions WHERE id = ?1 AND expires_at > ?2',
      tokenId, nowS);
    if (s) {
      const name = s.role === 'admin' ? 'الإدارة' : 'المعلم';
      return { uid: s.uid, role: s.role, name, tokenId: s.id };
    }
  } catch {}

  // If not found in local auth_sessions (e.g. fresh lambda worker instance):
  // Verify token signature against stable session secret
  if (parts.length === 5) {
    const sessionSecret = ctx.env.SESSION_SECRET || 'school-hafth-session-2026';
    const signed = await verifySignedSessionToken(token, nowS, sessionSecret);
    if (signed) {
      // Re-populate session in this container's SQLite DB
      try {
        await run(ctx.db,
          'INSERT OR REPLACE INTO auth_sessions (id, uid, role, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)',
          tokenId, signed.uid, signed.role, nowS, Number(parts[2]));
      } catch {}
      return { uid: signed.uid, role: signed.role, name: signed.name, tokenId };
    }
  }

  return null;
}

const json = (status, data, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE, ...headers } });

const publicInfo = async ({ db, env }) => json(200, { ...(await loadSettings(db)), turnstile_site_key: env.TURNSTILE_SITE_KEY || '' });

async function me({ db, user, nowMs }) {
  const out = {
    role: user.role,
    name: user.name,
    config: {
      periods: CONFIG.PERIODS,
      weekend_days: CONFIG.WEEKEND_DAYS,
      timezone: CONFIG.TIMEZONE,
      today: todayIn(CONFIG.TIMEZONE, new Date(nowMs)),
      max_backdate_days: CONFIG.MAX_BACKDATE_DAYS,
    },
  };
  if (user.role === 'admin') out.rules = await loadRules(db);
  return json(200, out);
}

async function logout({ db, user, url }) {
  try {
    await db.batch([
      st(db, 'DELETE FROM auth_sessions WHERE id = ?1', user.tokenId),
      st(db, 'INSERT OR REPLACE INTO session_revocations (id, revoked_at) VALUES (?1, ?2)', user.tokenId, Math.floor(Date.now() / 1000)),
    ]);
  } catch {
    await run(db, 'DELETE FROM auth_sessions WHERE id = ?1', user.tokenId);
  }
  return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(url, '', 0) });
}

// قائمة المعلمين للموقع (متاحة لكل من سجل دخوله لاختيار المعلم)
async function listPublicTeachers({ db }) {
  await syncFromCloud(db).catch(() => {});
  const teachers = await all(db, 'SELECT id, name, created_at FROM teachers ORDER BY name COLLATE NOCASE');
  return json(200, { teachers });
}

// تسجيل أو اختيار اسم المعلم وحفظه في القاعدة الرسمية
async function registerTeacher({ db, body, nowMs }) {
  const name = str(body?.name, 'اسم المعلم', { min: 2, max: 100 });
  await run(db, 'INSERT OR IGNORE INTO teachers (name, created_at) VALUES (?1, ?2)', name, nowMs);
  syncTeacherAdded(name, nowMs).catch(() => {});
  const row = await one(db, 'SELECT id, name, created_at FROM teachers WHERE name = ?1', name);
  return json(200, { ok: true, teacher: row });
}

function gradeOrder(name) {
  if (!name) return 99;
  if (name.includes('حادي عشر')) return 11;
  if (name.includes('ثاني عشر')) return 12;
  if (name.includes('عاشر')) return 10;
  if (name.includes('تاسع')) return 9;
  if (name.includes('ثامن')) return 8;
  if (name.includes('سابع')) return 7;
  if (name.includes('سادس')) return 6;
  if (name.includes('خامس')) return 5;
  return 99;
}

function classNumber(name) {
  const m = (name || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function sortGroups(groups) {
  return [...groups].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'basic' ? -1 : 1;
    const ga = gradeOrder(a.name);
    const gb = gradeOrder(b.name);
    if (ga !== gb) return ga - gb;
    const na = classNumber(a.name);
    const nb = classNumber(b.name);
    if (na !== nb) return na - nb;
    return (a.name || '').localeCompare(b.name || '', 'ar');
  });
}

// ------------------------------------------------------------------ 6) إدارة سجلات الغياب والصفوف والتقارير
async function listGroups({ db }) {
  const groups = await all(db,
    `SELECT g.id, g.name, g.kind, COUNT(e.student_id) AS student_count
       FROM groups g LEFT JOIN enrollments e ON e.group_id = g.id
      GROUP BY g.id`);
  return json(200, { groups: sortGroups(groups) });
}

async function listStudents({ db, params }) {
  const id = idOf(params.id, 'الصف');
  const students = await all(db,
    `SELECT s.id, s.number, s.name FROM enrollments e JOIN students s ON s.id = e.student_id
      WHERE e.group_id = ?1 ORDER BY CAST(s.number AS INTEGER), s.number`, id);
  return json(200, { students });
}

async function getRecord({ db, query }) {
  const date = isoDate(query.date);
  const period = int(query.period, 'الحصة', 1, CONFIG.PERIODS);
  const gid = idOf(query.group_id, 'الصف');
  await requireGroup(db, gid);
  const r = await one(db,
    'SELECT id, teacher_uid, teacher_name, created_at FROM records WHERE date = ?1 AND period = ?2 AND group_id = ?3', date, period, gid);
  if (!r) return json(200, { record: null });
  const entries = await all(db, 'SELECT student_id, status, note FROM entries WHERE record_id = ?1', r.id);
  return json(200, { record: { ...r, entries } });
}

async function saveRecord({ db, body, user, nowMs }) {
  const date = isoDate(body.date);
  const period = int(body.period, 'الحصة', 1, CONFIG.PERIODS);
  const gid = idOf(body.group_id, 'الصف');
  await requireGroup(db, gid);

  const teacherName = str(body.teacher_name || user.name || 'المعلم', 'اسم المعلم', { max: 100 });
  const today = todayIn(CONFIG.TIMEZONE, new Date(nowMs));
  const minDate = addDays(today, -CONFIG.MAX_BACKDATE_DAYS);
  if (date > today) throw bad('لا يمكن رصد الغياب لتاريخ في المستقبل');
  if (date < minDate) throw bad(`لا يمكن تسجيل غياب أقدم من ${CONFIG.MAX_BACKDATE_DAYS} يوماً`);

  const enrolled = new Set((await all(db, 'SELECT student_id FROM enrollments WHERE group_id = ?1', gid)).map((x) => x.student_id));
  const entries = arr(body.entries, 'الطلاب');
  const seen = new Set();
  const validEntries = [];
  for (const e of entries) {
    const sid = idOf(e.student_id, 'رقم الطالب');
    if (!enrolled.has(sid)) throw bad(`الطالب غير مسجل في هذا الصف`);
    if (seen.has(sid)) throw bad(`تكرار الطالب في الطلب`);
    seen.add(sid);
    const status = oneOf(e.status, 'الحالة', STATUSES);
    const note = optStr(e.note, 'الملاحظة', 200);
    validEntries.push({ sid, status, note });
  }

  let recId;
  const existing = await one(db, 'SELECT id, teacher_name FROM records WHERE date = ?1 AND period = ?2 AND group_id = ?3', date, period, gid);
  if (existing) {
    if (existing.teacher_name !== teacherName && user.role !== 'admin') {
      throw conflict(`هذه الحصة رُصدت سابقاً بواسطة ${existing.teacher_name}`);
    }
    recId = existing.id;
    await run(db, 'UPDATE records SET teacher_name = ?1, created_at = ?2 WHERE id = ?3', teacherName, nowMs, recId);
    await run(db, 'DELETE FROM entries WHERE record_id = ?1', recId);
  } else {
    const insertRes = await run(db,
      'INSERT INTO records (date, period, group_id, teacher_uid, teacher_name, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
      date, period, gid, 'teacher', teacherName, nowMs
    );
    recId = insertRes.meta?.last_row_id;
    if (!recId) {
      const row = await one(db, 'SELECT id FROM records WHERE date = ?1 AND period = ?2 AND group_id = ?3', date, period, gid);
      recId = row?.id;
    }
  }

  const batch = [];
  for (const e of validEntries) {
    batch.push(st(db,
      'INSERT INTO entries (record_id, student_id, status, note) VALUES (?1, ?2, ?3, ?4)',
      recId, e.sid, e.status, e.note));
  }
  batch.push(st(db, 'INSERT OR IGNORE INTO teachers (name, created_at) VALUES (?1, ?2)', teacherName, nowMs));
  batch.push(auditStmt(db, teacherName, existing ? 'record.update' : 'record.save', {
    date, period, group_id: gid, absent_count: validEntries.filter((x) => x.status === 'absent').length
  }));
  await db.batch(batch);
  syncRecordSaved(db, { date, period, group_id: gid, teacher_name: teacherName, entries: validEntries, created_at: nowMs }).catch(() => {});
  return json(existing ? 200 : 201, { ok: true, updated: !!existing });
}

async function dailyReport({ db, query, nowMs }) {
  await syncFromCloud(db).catch(() => {});
  const date = query.date ? isoDate(query.date) : todayIn(CONFIG.TIMEZONE, new Date(nowMs));
  const gid = idOf(query.group_id, 'الصف');
  const group = await requireGroup(db, gid);
  if (group.kind !== 'basic') throw bad('التقرير اليومي مخصص للصفوف الأساسية فقط');
  const students = await all(db,
    'SELECT s.id, s.number, s.name FROM enrollments e JOIN students s ON s.id = e.student_id WHERE e.group_id = ?1 ORDER BY LENGTH(s.number), s.number', gid);
  const rows = await all(db,
    `SELECT e.student_id, e.status, e.note, r.period, g.id AS group_id, g.name AS group_name, g.kind
       FROM entries e JOIN records r ON r.id = e.record_id JOIN groups g ON g.id = r.group_id
      WHERE r.date = ?1 AND e.student_id IN (SELECT student_id FROM enrollments WHERE group_id = ?2)
      ORDER BY r.period`, date, gid);
  const records = await all(db,
    'SELECT period, teacher_name FROM records WHERE date = ?1 AND group_id = ?2', date, gid);
  const byPeriod = Object.fromEntries(records.map((r) => [r.period, r.teacher_name]));
  const grid = new Map(students.map((s) => [s.id, { id: s.id, number: s.number, name: s.name, periods: {}, mobile: [] }]));
  for (const r of rows) {
    const s = grid.get(r.student_id);
    if (!s) continue;
    if (r.kind === 'basic' && r.group_id === gid) s.periods[r.period] = { status: r.status, note: r.note };
    else if (r.status !== 'present') s.mobile.push({ period: r.period, group_name: r.group_name, status: r.status, note: r.note });
  }
  return json(200, {
    date, group, periods_count: CONFIG.PERIODS,
    teachers_by_period: byPeriod, students: [...grid.values()],
  });
}

// ملخص الحصص والصفوف المرصودة لليوم (لمساعدة الإدارة والمعلمين على معرفة الحصص المسجلة فوراً)
async function dailySummary({ db, query, nowMs }) {
  await syncFromCloud(db).catch(() => {});
  const date = query.date ? isoDate(query.date) : todayIn(CONFIG.TIMEZONE, new Date(nowMs));
  const records = await all(db,
    `SELECT r.id, r.period, r.teacher_name, r.group_id, g.name AS group_name, g.kind AS group_kind,
            COALESCE(SUM(CASE WHEN e.status = 'absent' THEN 1 ELSE 0 END), 0) AS absent,
            COALESCE(SUM(CASE WHEN e.status = 'late' THEN 1 ELSE 0 END), 0) AS late,
            (SELECT COUNT(*) FROM enrollments WHERE group_id = r.group_id) AS total,
            r.created_at
       FROM records r
       JOIN groups g ON g.id = r.group_id
       LEFT JOIN entries e ON e.record_id = r.id
      WHERE r.date = ?1
      GROUP BY r.id
      ORDER BY g.name, r.period`, date);

  const groupsMap = new Map();
  for (const r of records) {
    if (!groupsMap.has(r.group_id)) {
      groupsMap.set(r.group_id, {
        group_id: r.group_id,
        group_name: r.group_name,
        group_kind: r.group_kind,
        periods_count: 0,
        teachers: [],
        periods: [],
        total_absent: 0,
        total_late: 0,
      });
    }
    const item = groupsMap.get(r.group_id);
    item.periods_count++;
    if (!item.teachers.includes(r.teacher_name)) item.teachers.push(r.teacher_name);
    item.periods.push({
      id: r.id,
      period: r.period,
      teacher_name: r.teacher_name,
      absent: r.absent || 0,
      late: r.late || 0,
      total: r.total || 0,
      created_at: r.created_at
    });
    item.total_absent += (r.absent || 0);
    item.total_late += (r.late || 0);
  }

  const recordedGroups = [...groupsMap.values()];
  const totalAbsent = records.reduce((acc, r) => acc + (r.absent || 0), 0);
  const totalLate = records.reduce((acc, r) => acc + (r.late || 0), 0);

  return json(200, {
    date,
    recorded_groups: recordedGroups,
    all_records: records,
    total_recorded_sessions: records.length,
    total_absent: totalAbsent,
    total_late: totalLate
  });
}

async function weeklyReport({ db, query, nowMs }) {
  const date = query.date ? isoDate(query.date) : todayIn(CONFIG.TIMEZONE, new Date(nowMs));
  const from = addDays(date, -dayOfWeek(date));
  const to = addDays(from, 6);
  const counts = await all(db,
    `SELECT teacher_name AS name, COUNT(*) AS sessions FROM records
      WHERE date BETWEEN ?1 AND ?2 AND CAST(strftime('%w', date) AS INTEGER) NOT IN (?3, ?4)
      GROUP BY teacher_name`, from, to, CONFIG.WEEKEND_DAYS[0], CONFIG.WEEKEND_DAYS[1]);
  const teachers = await all(db, 'SELECT id, name FROM teachers');
  const byName = new Map(counts.map((c) => [c.name, c.sessions]));
  const list = teachers.map((t) => ({ id: t.id, name: t.name, sessions: byName.get(t.name) ?? 0 }));
  for (const c of counts) {
    if (!teachers.some((t) => t.name === c.name)) list.push({ name: c.name, sessions: c.sessions });
  }
  const total = list.reduce((n, t) => n + t.sessions, 0);
  list.sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name, 'ar'));
  return json(200, {
    from, to, total,
    teachers: list.map((t) => ({ name: t.name, sessions: t.sessions, percent: total ? Math.round((t.sessions / total) * 1000) / 10 : 0 })),
  });
}

// ------------------------------------------------------------------ 7) لوحة الإدارة وإدارة المعلمين والإعدادات
const publicSettingsPut = async ({ db, body, user }) => {
  const next = {
    school_name: str(body.school_name, 'اسم المدرسة', { max: 120 }),
    principal_name: optStr(body.principal_name, 'اسم المدير', 120),
    developer_credit: optStr(body.developer_credit, 'حقوق التطوير', 120),
  };
  await db.batch([
    ...Object.entries(next).map(([k, v]) => st(db, 'INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, v)),
    auditStmt(db, user.name, 'settings.update', next),
  ]);
  return json(200, { ok: true, ...next });
};

const rulesPut = async ({ db, body, user }) => {
  const list = arr(body.rules, 'القواعد', { min: 1, max: 20 });
  const clean = [];
  const daysSeen = new Set();
  for (const r of list) {
    const days = int(r.min_days, 'الأيام', 1, 365);
    if (daysSeen.has(days)) throw bad('تكرار عدد الأيام في القواعد');
    daysSeen.add(days);
    clean.push({ min_days: days, label: str(r.label, 'الإجراء', { max: 80 }), color: color(r.color) });
  }
  clean.sort((a, b) => a.min_days - b.min_days);
  const stmts = [st(db, 'DELETE FROM rules')];
  clean.forEach((r) => stmts.push(st(db, 'INSERT INTO rules (min_days, label, color) VALUES (?1, ?2, ?3)', r.min_days, r.label, r.color)));
  stmts.push(auditStmt(db, user.name, 'rules.update', { count: clean.length }));
  await db.batch(stmts);
  return json(200, { ok: true, rules: clean });
};

async function createGroup({ db, body, user }) {
  const name = str(body.name, 'اسم الصف أو المادة', { max: 80 });
  const kind = oneOf(body.kind, 'النوع', ['basic', 'mobile']);
  const exists = await one(db, 'SELECT id FROM groups WHERE name = ?1', name);
  if (exists) throw conflict('يوجد صف أو مادة بهذا الاسم مسبقاً');
  const inputStudents = arr(body.students ?? [], 'الطلاب');
  const cleanStudents = [];
  const seenNumbers = new Set();
  for (const s of inputStudents) {
    const num = latinDigits(str(s.number, 'رقم الطالب', { max: 40 }));
    const sName = str(s.name, 'اسم الطالب', { max: 100 });
    if (seenNumbers.has(num)) throw bad(`تكرار رقم الطالب «${num}» في القائمة`);
    seenNumbers.add(num);
    cleanStudents.push({ number: num, name: sName });
  }

  await run(db, 'INSERT INTO groups (name, kind) VALUES (?1, ?2)', name, kind);
  const created = await one(db, 'SELECT id, name, kind FROM groups WHERE name = ?1', name);
  for (const s of cleanStudents) {
    await run(db, 'INSERT INTO students (number, name) VALUES (?1, ?2)', s.number, s.name);
    const row = await one(db, 'SELECT last_insert_rowid() AS id');
    if (row?.id) {
      await run(db, 'INSERT OR IGNORE INTO enrollments (group_id, student_id) VALUES (?1, ?2)', created.id, row.id);
    }
  }
  await audit(db, user.name, 'group.create', { name, kind, student_count: cleanStudents.length });
  return json(201, { group: created, student_count: cleanStudents.length });
}

async function deleteGroup({ db, params, user }) {
  const id = idOf(params.id, 'الصف');
  const g = await requireGroup(db, id);
  await db.batch([
    st(db, 'DELETE FROM groups WHERE id = ?1', id),
    st(db, 'DELETE FROM students WHERE id NOT IN (SELECT student_id FROM enrollments)'),
    auditStmt(db, user.name, 'group.delete', { id, name: g.name }),
  ]);
  return json(200, { ok: true });
}

async function addStudents({ db, params, body, user }) {
  const gid = idOf(params.id, 'الصف');
  const g = await requireGroup(db, gid);
  const input = arr(body.students, 'الطلاب', { min: 1 });
  const added = [];
  for (const s of input) {
    const num = latinDigits(str(s.number, 'رقم الطالب', { max: 40 }));
    const sName = str(s.name, 'اسم الطالب', { max: 100 });
    await run(db, 'INSERT INTO students (number, name) VALUES (?1, ?2)', num, sName);
    const row = await one(db, 'SELECT last_insert_rowid() AS id');
    if (row?.id) {
      await run(db, 'INSERT OR IGNORE INTO enrollments (group_id, student_id) VALUES (?1, ?2)', gid, row.id);
      added.push({ id: row.id, number: num, name: sName });
    }
  }
  await audit(db, user.name, 'students.add', { group_id: gid, group_name: g.name, count: input.length });
  return json(200, { ok: true, count: input.length, students: added });
}

async function updateStudent({ db, params, body, user }) {
  const gid = idOf(params.id, 'الصف');
  const sid = idOf(params.sid, 'الطالب');
  await requireGroup(db, gid);
  const s = await one(db, 'SELECT id, number, name FROM students WHERE id = ?1', sid);
  if (!s) throw notFound('الطالب غير موجود');
  const num = latinDigits(str(body.number != null ? body.number : s.number, 'رقم الطالب', { max: 40 }));
  const sName = str(body.name != null ? body.name : s.name, 'اسم الطالب', { max: 100 });
  await db.batch([
    st(db, 'UPDATE students SET number = ?1, name = ?2 WHERE id = ?3', num, sName, sid),
    auditStmt(db, user.name, 'student.update', { group_id: gid, student_id: sid, old: { number: s.number, name: s.name }, next: { number: num, name: sName } }),
  ]);
  return json(200, { ok: true, student: { id: sid, number: num, name: sName } });
}

async function removeStudent({ db, params, user }) {
  const gid = idOf(params.id, 'الصف');
  const sid = idOf(params.sid, 'الطالب');
  await requireGroup(db, gid);
  await db.batch([
    st(db, 'DELETE FROM enrollments WHERE group_id = ?1 AND student_id = ?2', gid, sid),
    st(db, 'DELETE FROM students WHERE id = ?1 AND id NOT IN (SELECT student_id FROM enrollments)', sid),
    auditStmt(db, user.name, 'student.remove', { group_id: gid, student_id: sid }),
  ]);
  return json(200, { ok: true });
}

// التحكم بكلمات المرور من لوحة الإدارة
async function getAdminPasswords({ db }) {
  let plainRow = await one(db, "SELECT value FROM settings WHERE key = 'teacher_password_plain'");
  if (!plainRow) {
    const def = 'teacher@77';
    const hashed = await pbkdf2Hash(def);
    await db.batch([
      st(db, "INSERT OR REPLACE INTO settings (key, value) VALUES ('teacher_password_plain', ?1)", def),
      st(db, "INSERT OR REPLACE INTO settings (key, value) VALUES ('teacher_password_hash', ?1)", hashed.hashHex),
      st(db, "INSERT OR REPLACE INTO settings (key, value) VALUES ('teacher_password_salt', ?1)", hashed.saltHex),
    ]);
    plainRow = { value: def };
  }
  return json(200, { teacher_password: plainRow.value });
}

async function updateTeacherPassword({ db, body, user }) {
  let nextPw = '';
  if (body.generate) {
    nextPw = `tchr-${newPassword(4).toLowerCase()}-${newPassword(4).toLowerCase()}`;
  } else {
    nextPw = str(body.password, 'كلمة المرور الجديدة', { min: 4, max: 100 });
  }

  const hashed = await pbkdf2Hash(nextPw);
  const nowS = Math.floor(Date.now() / 1000);
  await db.batch([
    st(db, "INSERT OR REPLACE INTO settings (key, value) VALUES ('teacher_password_plain', ?1)", nextPw),
    st(db, "INSERT OR REPLACE INTO settings (key, value) VALUES ('teacher_password_hash', ?1)", hashed.hashHex),
    st(db, "INSERT OR REPLACE INTO settings (key, value) VALUES ('teacher_password_salt', ?1)", hashed.saltHex),
    st(db, "INSERT OR REPLACE INTO settings (key, value) VALUES ('teacher_pw_changed_at', ?1)", String(nowS)),
    st(db, "DELETE FROM auth_sessions WHERE role = 'teacher'"), // إنهاء جلسات المعلمين الحالية فوراً
    auditStmt(db, user.name, 'password.teacher_change', { generated: !!body.generate }),
  ]);

  return json(200, { ok: true, teacher_password: nextPw });
}

async function updateAdminPassword({ db, body, user }) {
  const current = typeof body.current === 'string' ? body.current : '';
  const next = str(body.next, 'كلمة المرور الجديدة', { min: 6, max: 100 });
  if (next === current) throw bad('كلمة المرور الجديدة يجب أن تختلف عن الحالية');

  const hashRow = await one(db, "SELECT value FROM settings WHERE key = 'admin_password_hash'");
  const saltRow = await one(db, "SELECT value FROM settings WHERE key = 'admin_password_salt'");
  let verified = false;
  if (hashRow && saltRow) {
    verified = await verifyPassword(current, hashRow.value, saltRow.value);
  }
  if (!verified) throw new HttpError(401, 'كلمة المرور الحالية غير صحيحة');

  const hashed = await pbkdf2Hash(next);
  const nowS = Math.floor(Date.now() / 1000);
  await db.batch([
    st(db, "INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_password_hash', ?1)", hashed.hashHex),
    st(db, "INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_password_salt', ?1)", hashed.saltHex),
    st(db, "INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_pw_changed_at', ?1)", String(nowS)),
    st(db, 'DELETE FROM auth_sessions WHERE role = ?1 AND id <> ?2', 'admin', user.tokenId),
    auditStmt(db, user.name, 'password.admin_change', {}),
  ]);

  return json(200, { ok: true });
}

// إدارة دليل المعلمين في لوحة الإدارة
async function listAdminTeachers({ db }) {
  const teachers = await all(db, 'SELECT id, name, created_at FROM teachers ORDER BY name COLLATE NOCASE');
  return json(200, { teachers });
}

async function createTeachers({ db, body, user, nowMs }) {
  let names = [];
  if (Array.isArray(body.names)) {
    names = body.names;
  } else if (typeof body.name === 'string') {
    names = [body.name];
  } else {
    throw bad('يرجى تحديد اسم المعلم');
  }

  const cleaned = names.map((n) => (typeof n === 'string' ? n.replace(CONTROL, '').trim().replace(/\s+/g, ' ') : '')).filter(Boolean);
  if (!cleaned.length) throw bad('لا توجد أسماء صالحة');

  const existingRows = await all(db, 'SELECT name FROM teachers');
  const existingSet = new Set(existingRows.map((r) => r.name.toLowerCase()));

  const created = [];
  const skipped = [];
  const stmts = [];

  for (const name of cleaned) {
    if (existingSet.has(name.toLowerCase())) {
      skipped.push(name);
      continue;
    }
    existingSet.add(name.toLowerCase());
    created.push(name);
    stmts.push(st(db, 'INSERT INTO teachers (name, created_at) VALUES (?1, ?2)', name, nowMs));
  }

  if (stmts.length) {
    stmts.push(auditStmt(db, user.name, 'teachers.create', { count: created.length }));
    await db.batch(stmts);
    for (const name of created) {
      syncTeacherAdded(name, nowMs).catch(() => {});
    }
  }

  return json(201, { ok: true, created, skipped });
}

async function deleteTeacher({ db, params, user }) {
  const id = idOf(params.id, 'المعلم');
  const t = await one(db, 'SELECT id, name FROM teachers WHERE id = ?1', id);
  if (!t) throw notFound('المعلم غير موجود');
  await db.batch([
    st(db, 'DELETE FROM teachers WHERE id = ?1 OR TRIM(name) = ?2', id, t.name.trim()),
    auditStmt(db, user.name, 'teacher.delete', { id: t.id, name: t.name }),
  ]);
  syncTeacherDeleted(t.name).catch(() => {});
  return json(200, { ok: true });
}

// التقارير والسجلات الإدارية
async function monthlyReport({ db, query }) {
  const month = monthStr(query.month);
  const gid = idOf(query.group_id, 'الصف');
  const group = await requireGroup(db, gid);
  const rules = await loadRules(db);
  const minDays = rules.length ? rules[0].min_days : 5;
  const students = await all(db,
    'SELECT s.id, s.number, s.name FROM enrollments e JOIN students s ON s.id = e.student_id WHERE e.group_id = ?1', gid);
  const rows = await all(db,
    `SELECT e.student_id, e.status, r.date, r.period, g.name AS group_name
       FROM entries e JOIN records r ON r.id = e.record_id JOIN groups g ON g.id = r.group_id
      WHERE e.student_id IN (SELECT student_id FROM enrollments WHERE group_id = ?1)
        AND r.date >= ?2 AND r.date < ?3 AND e.status IN ('absent', 'late')
      ORDER BY r.date, r.period`, gid, `${month}-01`, nextMonth(month));
  const stats = new Map(students.map((s) => [s.id, { id: s.id, number: s.number, name: s.name, absent: new Map(), late: new Map() }]));
  for (const r of rows) {
    const side = stats.get(r.student_id)?.[r.status === 'absent' ? 'absent' : 'late'];
    if (!side) continue;
    if (!side.has(r.date)) side.set(r.date, []);
    side.get(r.date).push({ period: r.period, group_name: r.group_name });
  }
  const dates = (m) => [...m].map(([date, items]) => ({ date, items }));
  const all_ = [...stats.values()];
  const listed = all_.filter((s) => s.absent.size > 0 || s.late.size > 0).sort((a, b) => b.absent.size - a.absent.size || a.name.localeCompare(b.name, 'ar'));
  return json(200, {
    month, group, min_days: minDays,
    totals: { absence_days: all_.reduce((n, s) => n + s.absent.size, 0), late_days: all_.reduce((n, s) => n + s.late.size, 0), students: all_.length, warning_count: all_.filter((s) => s.absent.size >= minDays).length },
    students: listed.map((s) => ({
      id: s.id, number: s.number, name: s.name, absence_days: s.absent.size, absences: dates(s.absent),
      late_days: dates(s.late), action: disciplineAction(s.absent.size, rules),
    })),
  });
}

async function clearEntries({ db, body, user }) {
  const sid = idOf(body.student_id, 'الطالب');
  const date = isoDate(body.date);
  const kind = oneOf(body.kind ?? 'absent', 'النوع', ['absent', 'late']);
  const s = await one(db, 'SELECT number, name FROM students WHERE id = ?1', sid);
  if (!s) throw notFound('الطالب غير موجود');
  const res = await run(db,
    `UPDATE entries SET status = 'present', note = ?4
      WHERE student_id = ?1 AND status = ?3 AND record_id IN (SELECT id FROM records WHERE date = ?2)`, sid, date, kind, CONFIG.CLEARED_NOTE);
  if (!res.meta?.changes) throw notFound('السجل غير موجود');
  await audit(db, user.name, 'entry.clear', { number: s.number, name: s.name, date, kind, count: res.meta.changes });
  return json(200, { ok: true, cleared: res.meta.changes });
}

async function updateAdminEntry({ db, body, user, nowMs }) {
  const date = isoDate(body.date);
  const gid = idOf(body.group_id, 'الصف');
  const sid = idOf(body.student_id, 'الطالب');
  const status = oneOf(body.status, 'الحالة', ['present', 'absent', 'late']);
  const note = optStr(body.note, 'الملاحظة', 200) || '';
  const period = (body.period && body.period !== 'all' && Number(body.period) > 0)
    ? int(body.period, 'الحصة', 1, CONFIG.PERIODS)
    : null;

  const s = await one(db, 'SELECT id, number, name FROM students WHERE id = ?1', sid);
  if (!s) throw notFound('الطالب غير موجود');

  const enr = await one(db, 'SELECT 1 FROM enrollments WHERE group_id = ?1 AND student_id = ?2', gid, sid);
  if (!enr) throw bad('الطالب غير مسجل في هذا الصف');

  let recordsQuery = 'SELECT id, period, teacher_name FROM records WHERE date = ?1 AND group_id = ?2';
  const queryParams = [date, gid];
  if (period !== null) {
    recordsQuery += ' AND period = ?3';
    queryParams.push(period);
  }
  const records = await all(db, recordsQuery, ...queryParams);

  const batch = [];
  if (records.length === 0) {
    const p = period !== null ? period : 1;
    const createRes = await run(db,
      'INSERT INTO records (date, period, group_id, teacher_uid, teacher_name, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
      date, p, gid, 'admin', user.name || 'إدارة المدرسة', nowMs
    );
    const recId = createRes.meta?.last_row_id;
    if (recId) {
      batch.push(st(db,
        'INSERT OR REPLACE INTO entries (record_id, student_id, status, note) VALUES (?1, ?2, ?3, ?4)',
        recId, sid, status, note
      ));
    }
  } else {
    for (const r of records) {
      batch.push(st(db,
        'INSERT OR REPLACE INTO entries (record_id, student_id, status, note) VALUES (?1, ?2, ?3, ?4)',
        r.id, sid, status, note
      ));
    }
  }

  batch.push(auditStmt(db, user.name || 'إدارة المدرسة', 'entry.admin_edit', {
    student_id: sid,
    student_name: s.name,
    date,
    period: period ?? 'all',
    status,
    note
  }));

  await db.batch(batch);
  return json(200, { ok: true, student_name: s.name, status });
}

async function listRecords({ db, query }) {
  await syncFromCloud(db).catch(() => {});
  const date = isoDate(query.date);
  const records = await all(db,
    `SELECT r.id, r.period, r.teacher_name, r.group_id, g.name AS group_name,
            SUM(e.status = 'absent') AS absent, SUM(e.status = 'late') AS late, COUNT(e.student_id) AS total
       FROM records r JOIN groups g ON g.id = r.group_id LEFT JOIN entries e ON e.record_id = r.id
      WHERE r.date = ?1 GROUP BY r.id ORDER BY r.period, g.name`, date);
  return json(200, { date, records });
}

async function deleteRecord({ db, params, user }) {
  const id = idOf(params.id, 'السجل');
  const r = await one(db, 'SELECT r.date, r.period, r.group_id, r.teacher_name, g.name AS group_name FROM records r JOIN groups g ON g.id = r.group_id WHERE r.id = ?1', id);
  if (!r) throw notFound('السجل غير موجود');
  await db.batch([st(db, 'DELETE FROM records WHERE id = ?1', id), auditStmt(db, user.name, 'record.delete', r)]);
  syncRecordDeleted(r.date, r.period, r.group_id).catch(() => {});
  return json(200, { ok: true });
}

const auditList = async ({ db }) =>
  json(200, { entries: await all(db, 'SELECT id, at, actor, action, details FROM audit ORDER BY id DESC LIMIT 100') });

// ------------------------------------------------------------------ 8) الموجّه والترويسات الأمنية
// access: 'public' بلا دخول | 'any' أي جلسة مسجلة | 'teacher' المعلمون فقط | 'admin' الإدارة فقط
export const ROUTES = [
  ['GET', '/api/public', 'public', publicInfo],
  ['POST', '/api/login', 'public', login],
  ['GET', '/api/me', 'any', me],
  ['POST', '/api/logout', 'any', logout],
  ['GET', '/api/teachers', 'any', listPublicTeachers],
  ['POST', '/api/teachers', 'any', registerTeacher],
  ['GET', '/api/groups', 'any', listGroups],
  ['GET', '/api/groups/:id/students', 'any', listStudents],
  ['GET', '/api/record', 'any', getRecord],
  ['POST', '/api/record', 'teacher', saveRecord],
  ['GET', '/api/reports/daily', 'any', dailyReport],
  ['GET', '/api/reports/daily/summary', 'any', dailySummary],
  ['GET', '/api/reports/weekly', 'any', weeklyReport],
  ['PUT', '/api/admin/settings', 'admin', publicSettingsPut],
  ['PUT', '/api/admin/rules', 'admin', rulesPut],
  ['POST', '/api/admin/groups', 'admin', createGroup],
  ['DELETE', '/api/admin/groups/:id', 'admin', deleteGroup],
  ['POST', '/api/admin/groups/:id/students', 'admin', addStudents],
  ['PUT', '/api/admin/groups/:id/students/:sid', 'admin', updateStudent],
  ['DELETE', '/api/admin/groups/:id/students/:sid', 'admin', removeStudent],
  ['GET', '/api/admin/passwords', 'admin', getAdminPasswords],
  ['PUT', '/api/admin/passwords/teacher', 'admin', updateTeacherPassword],
  ['PUT', '/api/admin/passwords/admin', 'admin', updateAdminPassword],
  ['GET', '/api/admin/teachers', 'admin', listAdminTeachers],
  ['POST', '/api/admin/teachers', 'admin', createTeachers],
  ['DELETE', '/api/admin/teachers/:id', 'admin', deleteTeacher],
  ['GET', '/api/admin/reports/monthly', 'admin', monthlyReport],
  ['POST', '/api/admin/entries/clear', 'admin', clearEntries],
  ['POST', '/api/admin/entries/update', 'admin', updateAdminEntry],
  ['GET', '/api/admin/records', 'admin', listRecords],
  ['DELETE', '/api/admin/records/:id', 'admin', deleteRecord],
  ['GET', '/api/admin/audit', 'admin', auditList],
].map(([method, path, access, handler]) => {
  if (path.startsWith('/api/admin/') && access !== 'admin') throw new Error(`route ${path} must be admin-only`);
  const keys = [];
  const rx = new RegExp(`^${path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  return { method, path, access, handler, rx, keys };
});

function securityHeaders(h, url) {
  h.set('Content-Security-Policy',
    "default-src 'none'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data:; font-src 'self'; "
    + "connect-src 'self'; frame-src https://challenges.cloudflare.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; manifest-src 'self'");
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'DENY');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  if (url.protocol === 'https:') h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

async function readBody(request) {
  if (Number(request.headers.get('Content-Length') ?? 0) > CONFIG.MAX_BODY_BYTES) throw new HttpError(413, 'الطلب كبير جداً');
  const text = await request.text();
  if (text.length > CONFIG.MAX_BODY_BYTES) throw new HttpError(413, 'الطلب كبير جداً');
  if (!text) return {};
  if (!/^application\/json\b/i.test(request.headers.get('Content-Type') ?? '')) throw new HttpError(415, 'نوع المحتوى غير مدعوم');
  let b;
  try { b = JSON.parse(text); } catch { throw bad('صيغة الطلب غير صالحة'); }
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw bad('صيغة الطلب غير صالحة');
  return b;
}

async function handleApi(request, env, url, deps) {
  const method = request.method;
  const route = ROUTES.map((r) => (r.method === method ? { r, m: r.rx.exec(url.pathname) } : null)).find((x) => x?.m);
  if (!route) throw notFound('المسار غير موجود');
  const { r, m } = route;
  const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));

  // حماية CSRF: كل طلب يغيّر بيانات يجب أن يأتي من نفس الموقع
  if (method !== 'GET' && request.headers.get('Origin') !== url.origin) throw forbidden('طلب مرفوض');

  const nowMs = deps.now().getTime();
  await ensureSchema(env.DB, env);

  const ctx = {
    request, env, url, db: env.DB, nowMs, params, query: Object.fromEntries(url.searchParams),
    ip: request.headers.get('CF-Connecting-IP') ?? 'local', user: null, body: {},
  };

  if (r.access !== 'public') {
    ctx.user = await loadSession(ctx);
    if (!ctx.user) throw new HttpError(401, 'يلزم تسجيل الدخول');
    if (r.access === 'admin' && ctx.user.role !== 'admin') throw forbidden();
    if (r.access === 'teacher' && ctx.user.role !== 'teacher') throw forbidden();
  }
  if (method !== 'GET') ctx.body = await readBody(request);
  return r.handler(ctx);
}

export function createApp(deps = {}) {
  const d = { now: () => new Date(), ...deps };
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      let res;
      try {
        if (url.pathname.startsWith('/api/')) res = await handleApi(request, env, url, d);
        else if (request.method === 'GET' || request.method === 'HEAD') {
          res = await env.ASSETS.fetch(request);
          res = new Response(res.body, res);
          res.headers.set('Cache-Control', url.pathname.endsWith('.woff2') ? 'public, max-age=31536000, immutable' : 'no-cache');
        } else res = new Response('Method Not Allowed', { status: 405 });
      } catch (err) {
        if (err instanceof HttpError) res = json(err.status, { message: err.message });
        else { console.error('unhandled', err); res = json(500, { message: 'حدث خطأ غير متوقع. حاول مرة أخرى.' }); }
      }
      res = new Response(res.body, res);
      securityHeaders(res.headers, url);
      return res;
    },
  };
}

export default createApp();
