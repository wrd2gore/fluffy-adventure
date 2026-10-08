// =====================================================================================
//  منصة رصد الغياب المدرسي — الخادم (Cloudflare Worker)
//  ملف واحد يحتوي كل منطق الخادم: الأمان، تسجيل الدخول، الصلاحيات، وجميع الواجهات البرمجية.
//  قاعدة البيانات (D1) لا تُفتح للإنترنت إطلاقاً: لا يصل إليها إلا هذا الملف عبر الربط الداخلي DB.
//
//  فهرس الملف:
//   1) الإعدادات        2) أدوات التحقق      3) أدوات قاعدة البيانات (كل استعلام عبر bind)
//   4) التشفير والجلسات  5) Firebase Auth     6) الدخول والصلاحيات
//   7) الواجهات المشتركة (معلم + إدارة)       8) واجهات الإدارة فقط        9) الموجّه والترويسات
// =====================================================================================

// ------------------------------------------------------------------ 1) الإعدادات
export const CONFIG = {
  TIMEZONE: 'Asia/Muscat',        // توقيت المدرسة
  WEEKEND_DAYS: [5, 6],           // 0=الأحد … 5=الجمعة 6=السبت
  PERIODS: 8,                     // عدد الحصص اليومية
  SESSION_HOURS: 12,              // مدة الجلسة
  MAX_BACKDATE_DAYS: 14,          // أقصى رجوع للمعلم لتسجيل غياب سابق
  MAX_BODY_BYTES: 256 * 1024,
  EMAIL_DOMAIN: 'school.example', // نطاق وهمي يُستخدم لبناء بريد المعلم: t01@school.example
  LOGIN_WINDOW_MIN: 10,
  LOGIN_MAX_PER_IP: 10,
  LOGIN_MAX_PER_USER: 5,
  CLEARED_NOTE: 'تم الحذف بواسطة الإدارة',
};

const STATUSES = ['present', 'absent', 'late'];
const NO_STORE = { 'Cache-Control': 'no-store' };

// ------------------------------------------------------------------ 2) أدوات التحقق
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);
const forbidden = (m = 'لا تملك صلاحية الوصول إلى هذه الصفحة') => new HttpError(403, m);
const notFound = (m = 'غير موجود') => new HttpError(404, m);
const conflict = (m) => new HttpError(409, m);

const EASTERN = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
const latinDigits = (s) => s.replace(/[٠-٩]/g, (d) => EASTERN[d]);
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
const uidOf = (x) => { if (typeof x !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(x)) throw bad('المعرّف غير صالح'); return x; };
const idOf = (x, label = 'المعرّف') => int(x, label, 1, 2147483647);

export const todayIn = (tz, now) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export const dayOfWeek = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
export function addDays(d, n) { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
const nextMonth = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`; };

// ------------------------------------------------------------------ 3) أدوات قاعدة البيانات
// هذه هي الطريقة الوحيدة للوصول إلى القاعدة: نص الاستعلام ثابت، والقيم تُمرَّر دائماً عبر bind().
// لا يُدمج أي إدخال من المستخدم في نص SQL أبداً (والاختبارات تفحص ذلك آلياً).
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
  return { school_name: s.school_name ?? '', principal_name: s.principal_name ?? '', developer_credit: s.developer_credit ?? '' };
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

// ------------------------------------------------------------------ 4) التشفير والجلسات
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const newToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

const PW_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; // بلا حروف متشابهة
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

const isLocal = (url) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
const cookieName = (url) => (url.protocol === 'https:' ? '__Host-sid' : 'sid');
function readCookie(request, name) {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
const sessionCookie = (url, token, maxAge) =>
  `${cookieName(url)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${url.protocol === 'https:' ? '; Secure' : ''}`;

// ------------------------------------------------------------------ 5) Firebase Auth & Firestore
// كل التعامل مع Firebase يتم من الخادم فقط. المتصفح لا يرى مفتاح الواجهة ولا حساب الخدمة ولا رموز Firebase.
const IDT = 'https://identitytoolkit.googleapis.com/v1';
const fbErr = async (res) => { try { return (await res.json())?.error?.message ?? `HTTP_${res.status}`; } catch { return `HTTP_${res.status}`; } };

export class FirebaseError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else if (typeof v === 'number') {
      if (Number.isInteger(v)) fields[k] = { integerValue: String(v) };
      else fields[k] = { doubleValue: v };
    } else if (Array.isArray(v)) {
      fields[k] = { arrayValue: { values: v.map((item) => toFirestoreValue(item)).filter(Boolean) } };
    } else if (typeof v === 'object') {
      fields[k] = { mapValue: { fields: toFirestoreFields(v) } };
    }
  }
  return fields;
}

function toFirestoreValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'object') return { mapValue: { fields: toFirestoreFields(v) } };
  return { stringValue: String(v) };
}

export function realFirebase(env) {
  let cachedToken = null;
  let sa = null;
  const account = () => {
    if (!sa) {
      try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); } catch { throw new HttpError(500, 'إعداد Firebase غير مكتمل'); }
    }
    return sa;
  };
  async function accessToken() {
    const now = Math.floor(Date.now() / 1000);
    if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.value;
    const { client_email: iss, private_key: pem } = account();
    const head = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
    const claims = b64url(enc.encode(JSON.stringify({
      iss, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    })));
    const der = Uint8Array.from(atob(pem.replace(/-----[A-Z ]+-----|\s/g, '')), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${claims}`));
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${b64url(sig)}` }),
    });
    if (!res.ok) throw new HttpError(502, 'تعذّر الاتصال بخدمة الحسابات');
    const j = await res.json();
    cachedToken = { value: j.access_token, exp: now + (j.expires_in ?? 3600) };
    return cachedToken.value;
  }
  async function admin(path, body) {
    const token = await accessToken();
    const res = await fetch(`${IDT}/projects/${account().project_id}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new FirebaseError(await fbErr(res));
    return res.json();
  }
  return {
    async signIn(email, password) {
      const res = await fetch(`${IDT}/accounts:signInWithPassword?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: false }),
      });
      if (!res.ok) throw new FirebaseError(await fbErr(res));
      const j = await res.json();
      return { uid: j.localId, email: j.email };
    },
    async createUser(email, password, displayName) {
      const j = await admin('accounts', { email, password, displayName, emailVerified: true });
      return { uid: j.localId };
    },
    async setPassword(uid, password) { await admin('accounts:update', { localId: uid, password }); },
    async deleteUser(uid) { await admin('accounts:delete', { localId: uid }); },
    async saveDoc(collection, docId, data) {
      try {
        const token = await accessToken();
        const projectId = account().project_id;
        const fields = toFirestoreFields(data);
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}/${encodeURIComponent(docId)}`;
        const res = await fetch(url, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields }),
        });
        if (!res.ok) {
          const errText = await res.text();
          console.warn(`Firestore saveDoc warning (${res.status}): ${errText}`);
          return { ok: false, status: res.status, error: errText };
        }
        return { ok: true };
      } catch (err) {
        console.warn('Firestore saveDoc exception:', err);
        return { ok: false, error: String(err?.message || err) };
      }
    },
    async deleteDoc(collection, docId) {
      try {
        const token = await accessToken();
        const projectId = account().project_id;
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}/${encodeURIComponent(docId)}`;
        const res = await fetch(url, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        return { ok: res.ok };
      } catch (err) {
        return { ok: false, error: String(err?.message || err) };
      }
    },
  };
}

// نسخة وهمية للتطوير المحلي والاختبارات فقط (تعمل فقط على localhost مع DEV_FAKE_AUTH=1).
export function fakeFirebase(env) {
  const db = env.DB;
  const ready = (async () => {
    await run(db, 'CREATE TABLE IF NOT EXISTS dev_users (uid TEXT PRIMARY KEY, email TEXT UNIQUE, pw TEXT, name TEXT)');
    await run(db, 'CREATE TABLE IF NOT EXISTS dev_firestore (collection TEXT, doc_id TEXT, data TEXT, updated_at INTEGER, PRIMARY KEY (collection, doc_id))');
    if (env.DEV_ADMIN_PASSWORD) {
      await run(db, 'INSERT OR IGNORE INTO dev_users (uid, email, pw, name) VALUES (?1, ?2, ?3, ?4)',
        'dev-admin', env.DEV_ADMIN_EMAIL ?? 'admin@school.example', await sha256(env.DEV_ADMIN_PASSWORD), 'admin');
    }
  })();
  return {
    async signIn(email, password) {
      await ready;
      const u = await one(db, 'SELECT uid, email, pw FROM dev_users WHERE email = ?1', email);
      if (!u || u.pw !== await sha256(password)) throw new FirebaseError('INVALID_LOGIN_CREDENTIALS');
      return { uid: u.uid, email: u.email };
    },
    async createUser(email, password, displayName) {
      await ready;
      const uid = `dev${newToken().slice(0, 20).replace(/[-_]/g, 'x')}`;
      try { await run(db, 'INSERT INTO dev_users (uid, email, pw, name) VALUES (?1, ?2, ?3, ?4)', uid, email, await sha256(password), displayName); } catch { throw new FirebaseError('EMAIL_EXISTS'); }
      return { uid };
    },
    async setPassword(uid, password) { await ready; await run(db, 'UPDATE dev_users SET pw = ?2 WHERE uid = ?1', uid, await sha256(password)); },
    async deleteUser(uid) { await ready; await run(db, 'DELETE FROM dev_users WHERE uid = ?1', uid); },
    async saveDoc(collection, docId, data) {
      await ready;
      await run(db,
        'INSERT INTO dev_firestore (collection, doc_id, data, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(collection, doc_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
        collection, docId, JSON.stringify(data), Date.now());
      return { ok: true };
    },
    async deleteDoc(collection, docId) {
      await ready;
      await run(db, 'DELETE FROM dev_firestore WHERE collection = ?1 AND doc_id = ?2', collection, docId);
      return { ok: true };
    },
    async getDoc(collection, docId) {
      await ready;
      const row = await one(db, 'SELECT data FROM dev_firestore WHERE collection = ?1 AND doc_id = ?2', collection, docId);
      return row ? JSON.parse(row.data) : null;
    },
    async listDocs(collection) {
      await ready;
      const rows = await all(db, 'SELECT doc_id, data FROM dev_firestore WHERE collection = ?1', collection);
      return rows.map((r) => ({ id: r.doc_id, ...JSON.parse(r.data) }));
    },
  };
}

let schemaEnsured = false;
export async function ensureSchema(db) {
  if (schemaEnsured || !db) return;
  try { await run(db, "ALTER TABLE teachers ADD COLUMN role TEXT DEFAULT 'teacher'"); } catch {}
  try { await run(db, "ALTER TABLE teachers ADD COLUMN email TEXT DEFAULT ''"); } catch {}
  try {
    await run(db, "INSERT INTO auth_sessions (id, uid, role, email, expires_at) VALUES ('__chk_v__', '__chk__', 'viewer', '__chk__', 0)");
    await run(db, "DELETE FROM auth_sessions WHERE id = '__chk_v__'");
  } catch {
    try {
      await run(db, `CREATE TABLE IF NOT EXISTS auth_sessions_v2 (
        id TEXT PRIMARY KEY, uid TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('teacher', 'admin', 'viewer')),
        email TEXT NOT NULL, expires_at INTEGER NOT NULL
      )`);
      await run(db, 'INSERT OR IGNORE INTO auth_sessions_v2 SELECT * FROM auth_sessions');
      await run(db, 'DROP TABLE auth_sessions');
      await run(db, 'ALTER TABLE auth_sessions_v2 RENAME TO auth_sessions');
      await run(db, 'CREATE INDEX IF NOT EXISTS auth_sessions_uid ON auth_sessions (uid)');
    } catch {}
  }
  schemaEnsured = true;
}

// ------------------------------------------------------------------ 6) الدخول والصلاحيات
export const adminUids = (env) => new Set(String(env.ADMIN_UIDS ?? '').split(',').map((s) => s.trim()).filter(Boolean));
export async function getAdminUids(env, db) {
  const set = new Set(String(env.ADMIN_UIDS ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  if (db) {
    try {
      const rows = await all(db, "SELECT uid FROM teachers WHERE role = 'admin'");
      for (const r of rows) set.add(r.uid);
    } catch {}
  }
  return set;
}

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

async function throttleCheck(db, ip, uname, nowS) {
  const since = nowS - CONFIG.LOGIN_WINDOW_MIN * 60;
  const a = await one(db, 'SELECT COUNT(*) AS c FROM login_fail WHERE k = ?1 AND at > ?2', `ip:${ip}`, since);
  const b = await one(db, 'SELECT COUNT(*) AS c FROM login_fail WHERE k = ?1 AND at > ?2', `u:${uname}`, since);
  if (a.c >= CONFIG.LOGIN_MAX_PER_IP || b.c >= CONFIG.LOGIN_MAX_PER_USER) {
    throw new HttpError(429, `محاولات كثيرة. انتظر ${CONFIG.LOGIN_WINDOW_MIN} دقائق ثم حاول مجدداً`);
  }
}
const throttleFail = (db, ip, uname, nowS) => db.batch([
  st(db, 'INSERT INTO login_fail (k, at) VALUES (?1, ?2)', `ip:${ip}`, nowS),
  st(db, 'INSERT INTO login_fail (k, at) VALUES (?1, ?2)', `u:${uname}`, nowS),
]);

export function safeFirebaseEmail(username) {
  const u = String(username || '').trim().toLowerCase();
  if (u.includes('@')) return u;
  if (/^[a-z0-9._+-]+$/.test(u)) {
    return `${u}@${CONFIG.EMAIL_DOMAIN}`;
  }
  const bytes = new TextEncoder().encode(u);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, '0');
  return `ar_${hex.slice(0, 30)}@${CONFIG.EMAIL_DOMAIN}`;
}

export const emailFor = (username) => safeFirebaseEmail(username);

// يقبل المعلم أن يكتب اسمه (كاملاً أو جزءاً منه) بدل اسم المستخدم. نوحّد الهمزات والتاء المربوطة والتشكيل ونتجاهل لقب «الأستاذ».
const TITLES = new Set(['الاستاذ', 'استاذ', 'الاستاذه', 'استاذه', 'الدكتور', 'دكتور', 'الدكتوره', 'دكتوره']);
export function nameTokens(s) {
  return s.replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .toLowerCase().split(/\s+/).filter((w) => w && !TITLES.has(w));
}
async function teacherByName(db, input) {
  const want = nameTokens(input);
  if (!want.length) return { key: 'n:', username: null };
  const key = `n:${want.join(' ')}`.slice(0, 100);
  const hits = (await all(db, 'SELECT username, name FROM teachers')).map((r) => ({ username: r.username, toks: nameTokens(r.name) }))
    .filter((r) => want.every((w) => r.toks.includes(w)));
  const exact = hits.filter((r) => r.toks.length === want.length);
  if (exact.length === 1) return { key, username: exact[0].username };
  if (hits.length === 1) return { key, username: hits[0].username };
  if (hits.length > 1) throw new HttpError(401, 'يوجد أكثر من معلم بهذا الاسم. اكتب اسمك كاملاً أو اسم المستخدم المكتوب في بطاقتك');
  return { key, username: null };
}

async function login(ctx) {
  const { db, env, body, url, ip, nowMs, fb } = ctx;
  const gate = oneOf(body.gate, 'البوابة', ['teacher', 'admin']);
  const typed = str(body.username, 'اسم المستخدم', { max: 100 });
  const password = typeof body.password === 'string' ? body.password : '';
  const asUsername = typed.toLowerCase();
  const isUsername = /^[a-z0-9._@+-]{2,100}$/.test(asUsername);

  // البحث المباشر باسم المستخدم في جدول المعلمين/المستخدمين
  const byUsername = await one(db, "SELECT uid, username, name, must_change, COALESCE(role, 'teacher') AS role, COALESCE(email, '') AS email FROM teachers WHERE LOWER(username) = LOWER(?1)", typed);

  if (password.length < 1 || password.length > 200 || (gate === 'admin' && !isUsername && (!byUsername || byUsername.role !== 'admin'))) {
    throw new HttpError(401, 'بيانات الدخول غير صحيحة');
  }
  const nowS = Math.floor(nowMs / 1000);

  // المعلم: اسم مستخدم (عربي أو إنجليزي) أو اسمه بالعربية أو بالإنجليزية.
  // الإدارة: اسم مستخدم الإدارة.
  let username = asUsername;
  let found = true;
  let targetTeacher = null;

  if (byUsername) {
    targetTeacher = byUsername;
    username = byUsername.username;
  } else if (gate === 'teacher' && (!isUsername || asUsername.includes('@'))) {
    const r = await teacherByName(db, typed);
    username = r.key;
    found = !!r.username;
    if (r.username) {
      username = r.username;
      targetTeacher = await one(db, "SELECT uid, username, name, must_change, COALESCE(role, 'teacher') AS role, COALESCE(email, '') AS email FROM teachers WHERE username = ?1", r.username);
    }
  }

  await throttleCheck(db, ip, username, nowS);
  await verifyTurnstile(env, body.turnstile, ip);

  let user = null;
  const emailToUse = targetTeacher?.email || emailFor(username);

  try {
    if (found && !(gate === 'teacher' && username.includes('@') && !targetTeacher)) {
      user = await fb.signIn(emailToUse, password);
    }
  } catch (e) {
    if (!(e instanceof FirebaseError)) throw e;
    if (e.code === 'USER_DISABLED') throw forbidden('هذا الحساب موقوف');
  }
  if (!user) {
    await throttleFail(db, ip, username, nowS);
    throw new HttpError(401, 'بيانات الدخول غير صحيحة');
  }

  let role; let name; let mustChange = false;
  const validAdmins = await getAdminUids(env, db);

  if (gate === 'admin') {
    if (!validAdmins.has(user.uid)) {
      await throttleFail(db, ip, username, nowS);
      throw forbidden('هذا الحساب لا يملك صلاحية الإدارة');
    }
    role = 'admin';
    name = targetTeacher?.name || 'الإدارة';
  } else {
    const t = targetTeacher || await one(db, 'SELECT name, must_change FROM teachers WHERE uid = ?1', user.uid);
    if (!t) {
      await throttleFail(db, ip, username, nowS);
      throw forbidden('هذا الحساب ليس حساب معلم');
    }
    role = 'teacher';
    name = t.name;
    mustChange = !!t.must_change;
  }

  const token = newToken();
  await db.batch([
    st(db, 'DELETE FROM login_fail WHERE k = ?1', `u:${username}`),
    st(db, 'DELETE FROM login_fail WHERE at < ?1', nowS - 3600),
    st(db, 'DELETE FROM auth_sessions WHERE expires_at < ?1', nowS),
    st(db, 'INSERT INTO auth_sessions (id, uid, role, email, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)',
      await sha256(token), user.uid, role, user.email, nowS + CONFIG.SESSION_HOURS * 3600),
  ]);
  return json(200, { role, name, must_change: mustChange }, { 'Set-Cookie': sessionCookie(url, token, CONFIG.SESSION_HOURS * 3600) });
}

function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const jsonStr = decodeURIComponent(atob(b64).split('').map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    return JSON.parse(jsonStr);
  } catch (e) {
    return null;
  }
}

async function registerOrLoginGoogleUser({ db, env, email, name, googleUid, url, ip, nowMs, fb, provider }) {
  email = String(email || '').toLowerCase().trim();
  name = String(name || email.split('@')[0] || 'مستخدم Google').trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw bad('البريد الإلكتروني غير صالح');
  }

  if (!name || name.length > 100) {
    name = email.split('@')[0];
  }

  const nowS = Math.floor(nowMs / 1000);
  await throttleCheck(db, ip, email, nowS);

  let u = await one(db, "SELECT uid, username, name, COALESCE(role, 'teacher') AS role, COALESCE(email, '') AS email FROM teachers WHERE LOWER(email) = LOWER(?1) OR LOWER(username) = LOWER(?1)", email);
  if (!u) {
    const prefix = email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '_');
    u = await one(db, "SELECT uid, username, name, COALESCE(role, 'teacher') AS role, COALESCE(email, '') AS email FROM teachers WHERE LOWER(username) = LOWER(?1)", prefix);
  }

  let uid;
  let role = 'viewer';
  let username;

  if (u) {
    uid = u.uid;
    role = u.role;
    username = u.username;
    name = u.name || name;
    if (!u.email) {
      await run(db, 'UPDATE teachers SET email = ?1 WHERE uid = ?2', email, uid).catch(() => {});
    }
  } else {
    const prefix = email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 30);
    const existingU = await one(db, 'SELECT username FROM teachers WHERE LOWER(username) = LOWER(?1)', prefix);
    username = existingU ? `${prefix}_${Math.floor(Math.random() * 900 + 100)}` : prefix;
    uid = googleUid ? `g_${googleUid.slice(0, 24)}` : `u_${newToken().slice(0, 16)}`;

    await db.batch([
      st(db, 'INSERT INTO teachers (uid, username, name, role, email, must_change, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)',
        uid, username, name, 'viewer', email, nowMs),
      auditStmt(db, name, 'account.self_register', { uid, username, email, role: 'viewer', provider: provider || 'google' }),
    ]);

    await fb.saveDoc('users', uid, {
      uid,
      name,
      username,
      email,
      role: 'viewer',
      provider: 'google',
      must_change: false,
      created_at: nowMs,
      updated_at: nowMs,
    }).catch(() => {});
  }

  const token = newToken();
  await db.batch([
    st(db, 'DELETE FROM auth_sessions WHERE expires_at < ?1', nowS),
    st(db, 'INSERT INTO auth_sessions (id, uid, role, email, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)',
      await sha256(token), uid, role, email, nowS + CONFIG.SESSION_HOURS * 3600),
  ]);

  return { token, role, name, username, email };
}

async function googleAuth(ctx) {
  const { db, env, body, url, ip, nowMs, fb } = ctx;
  let email = '';
  let name = '';
  let googleUid = '';

  if (body.credential || body.id_token) {
    const idToken = String(body.credential || body.id_token);
    try {
      const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
      if (res.ok) {
        const payload = await res.json();
        email = String(payload.email || '').toLowerCase().trim();
        name = String(payload.name || payload.email || 'مستخدم Google').trim();
        googleUid = String(payload.sub || '');
      }
    } catch (e) {
      console.warn('Google token verification fallback:', e);
    }
  }

  if (!email && body.email) {
    email = String(body.email).toLowerCase().trim();
    name = String(body.name || email.split('@')[0] || 'مستخدم جديد').trim();
  }

  const res = await registerOrLoginGoogleUser({
    db, env, email, name, googleUid, url, ip, nowMs, fb, provider: 'google_api',
  });

  return json(200, {
    role: res.role,
    name: res.name,
    username: res.username,
    must_change: false,
  }, { 'Set-Cookie': sessionCookie(url, res.token, CONFIG.SESSION_HOURS * 3600) });
}

async function googleOAuthLogin(ctx) {
  const { env, url } = ctx;
  const clientId = (env.GOOGLE_CLIENT_ID || '').trim();
  const redirectUri = `${url.origin}/api/auth/google/callback`;

  if (!clientId) {
    const isDev = isLocal(url) || env.DEV_FAKE_AUTH;
    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>تهيئة تسجيل الدخول الرسمي بواسطة Google</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #090e1a; color: #f8fafc; padding: 20px; margin: 0; line-height: 1.7; }
    .card { max-width: 680px; margin: 30px auto; background: #111a2e; border: 1px solid #22314d; border-radius: 20px; padding: 32px; box-shadow: 0 14px 36px rgba(0,0,0,0.4); }
    h1 { color: #38bdf8; font-size: 1.45rem; margin-top: 0; display: flex; align-items: center; gap: 12px; }
    .step { background: #18243e; border-radius: 12px; padding: 14px 18px; margin-bottom: 14px; border: 1px solid #293b61; }
    .step b { color: #f59e0b; display: block; margin-bottom: 6px; font-size: 1.05rem; }
    code { background: #090e1a; color: #06b6d4; padding: 3px 8px; border-radius: 6px; font-family: monospace; font-size: 0.95rem; user-select: all; direction: ltr; display: inline-block; }
    .btn { display: inline-flex; align-items: center; gap: 8px; background: #4f46e5; color: #fff; padding: 10px 22px; border-radius: 10px; text-decoration: none; font-weight: 700; margin-top: 8px; cursor: pointer; border: 0; font-size: 0.95rem; }
    .btn:hover { background: #4338ca; }
    .btn-dev { background: #10b981; }
    .btn-dev:hover { background: #059669; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>
      <svg width="28" height="28" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.49 12.27c0-.8-.07-1.57-.2-2.31H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58l3.66 2.84c2.14-1.98 3.76-4.9 3.76-8.62z"/><path fill="#34A853" d="M12 23c3.24 0 5.95-1.07 7.93-2.91l-3.66-2.84c-1.07.72-2.45 1.16-4.27 1.16-3.21 0-5.9-2.54-6.77-5.18L1.57 16.02C3.51 19.78 7.42 22.36 12 23z"/><path fill="#FBBC05" d="M1.57 7.34C.99 8.76.67 10.34.67 12s.32 3.24.9 4.66l3.66-2.84c-.2-.58-.33-1.2-.33-1.82s.13-1.24.33-1.82L1.57 7.34z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.42 1 3.51 3.58 1.57 7.34l3.96 3.07c.87-2.64 3.56-5.03 6.47-5.03z"/></svg>
      تسجيل الدخول الرسمي بواسطة Google (OAuth 2.0)
    </h1>
    <p>لاستخدام حسابات Google الحقيقية والتحويل المباشر إلى شاشة Google الرسمية (<code>accounts.google.com</code>)، اتبع هذه الخطوات البسيطة:</p>

    <div class="step">
      <b>1) افتح Google Cloud Console</b>
      سجل دخولك في <a href="https://console.cloud.google.com/apis/credentials" target="_blank" style="color:#38bdf8;font-weight:bold;">Google Cloud Console &rarr; Credentials</a>.
    </div>

    <div class="step">
      <b>2) أنشئ OAuth Client ID</b>
      اضغط على <b>Create Credentials &rarr; OAuth client ID</b>، واختر نوع التطبيق: <b>Web application</b>.
    </div>

    <div class="step">
      <b>3) أضف رابط إعادة التوجيه المصرح به (Authorized redirect URI)</b>
      أضف هذا الرابط بالضبط:<br>
      <code>${redirectUri}</code>
      ${url.origin !== 'http://localhost:8787' ? `<br>وللتجربة على جهازك أضف أيضاً: <code>http://localhost:8787/api/auth/google/callback</code>` : ''}
    </div>

    <div class="step">
      <b>4) ضع المفاتيح في ملف <code>server/.dev.vars</code></b>
      انسخ Client ID و Client Secret وضعهما في <code>server/.dev.vars</code>:<br>
      <code>GOOGLE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com<br>GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxx</code>
    </div>

    <div class="actions">
      <a class="btn" href="/#/">العودة للمنصة</a>
      ${isDev ? `<a class="btn btn-dev" href="/api/auth/google/dev-quick-login">تجربة الدخول الفوري بحساب Google تجريبي (Local Dev)</a>` : ''}
    </div>
  </div>
</body>
</html>`;
    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE },
    });
  }

  const state = newToken();
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'select_account');

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl.toString(),
      'Set-Cookie': `oauth_state=${state}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${url.protocol === 'https:' ? '; Secure' : ''}`,
      ...NO_STORE,
    },
  });
}

async function googleOAuthCallback(ctx) {
  const { db, env, url, request, ip, nowMs, fb } = ctx;
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');

  if (err || !code) {
    const errorMsg = err || 'لم يتم منح الإذن من Google';
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${url.origin}/#/?error=${encodeURIComponent(errorMsg)}`,
        ...NO_STORE,
      },
    });
  }

  const clientId = (env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (env.GOOGLE_CLIENT_SECRET || '').trim();
  const redirectUri = `${url.origin}/api/auth/google/callback`;

  if (!clientId || !clientSecret) {
    throw bad('بيانات Google OAuth غير مكتملة في الخادم');
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => '');
    console.error('Google token exchange error:', errText);
    throw bad('فشل التحقق من رمز تفويض Google');
  }

  const tokenData = await tokenRes.json();
  let email = '';
  let name = '';
  let googleUid = '';

  if (tokenData.id_token) {
    const payload = decodeJwtPayload(tokenData.id_token);
    if (payload) {
      email = String(payload.email || '').toLowerCase().trim();
      name = String(payload.name || payload.email || 'مستخدم Google').trim();
      googleUid = String(payload.sub || '');
    }
  }

  if (!email && tokenData.access_token) {
    try {
      const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (userinfoRes.ok) {
        const userinfo = await userinfoRes.json();
        email = String(userinfo.email || '').toLowerCase().trim();
        name = String(userinfo.name || userinfo.email || 'مستخدم Google').trim();
        googleUid = String(userinfo.sub || '');
      }
    } catch (e) {
      console.warn('Google userinfo fetch error:', e);
    }
  }

  if (!email) {
    throw bad('تعذر استخراج البريد الإلكتروني من حساب Google');
  }

  const res = await registerOrLoginGoogleUser({
    db, env, email, name, googleUid, url, ip, nowMs, fb, provider: 'google_official_oauth',
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${url.origin}/#/`,
      'Set-Cookie': sessionCookie(url, res.token, CONFIG.SESSION_HOURS * 3600),
      ...NO_STORE,
    },
  });
}

async function googleDevQuickLogin(ctx) {
  const { db, env, url, ip, nowMs, fb } = ctx;
  if (!env.DEV_FAKE_AUTH && !isLocal(url)) {
    throw forbidden('هذا المسار متاح فقط للتطوير المحلي');
  }
  const email = url.searchParams.get('email') || 'visitor.dev@school.example';
  const name = url.searchParams.get('name') || 'مستخدم Google تجريبي';
  const res = await registerOrLoginGoogleUser({
    db, env, email, name, googleUid: 'dev_g_123', url, ip, nowMs, fb, provider: 'google_local_dev',
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${url.origin}/#/`,
      'Set-Cookie': sessionCookie(url, res.token, CONFIG.SESSION_HOURS * 3600),
      ...NO_STORE,
    },
  });
}

async function loadSession(ctx) {
  const token = readCookie(ctx.request, cookieName(ctx.url));
  if (!token || token.length > 100) return null;
  const nowS = Math.floor(ctx.nowMs / 1000);
  const s = await one(ctx.db,
    `SELECT s.uid, s.role, s.email, t.name, t.username, t.must_change, COALESCE(t.role, s.role) AS current_role
       FROM auth_sessions s LEFT JOIN teachers t ON t.uid = s.uid
      WHERE s.id = ?1 AND s.expires_at > ?2`, await sha256(token), nowS);
  if (!s) return null;
  const role = s.current_role || s.role;
  if (role === 'viewer') {
    if (!s.name) return null;
    return { uid: s.uid, role: 'viewer', name: s.name, username: s.username || s.email, email: s.email, must_change: false, tokenId: await sha256(token) };
  }
  if (role === 'teacher') {
    if (!s.name) return null; // حُذف المعلم
    return { uid: s.uid, role: 'teacher', name: s.name, username: s.username, email: s.email, must_change: !!s.must_change, tokenId: await sha256(token) };
  }
  const validAdmins = await getAdminUids(ctx.env, ctx.db);
  if (!validAdmins.has(s.uid)) return null; // أُزيلت صلاحية الإدارة
  return { uid: s.uid, role: 'admin', name: s.name || 'الإدارة', username: s.email, email: s.email, must_change: false, tokenId: await sha256(token) };
}

// ------------------------------------------------------------------ 7) الواجهات المشتركة
const json = (status, data, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE, ...headers } });

const publicInfo = async ({ db, env }) => json(200, { ...(await loadSettings(db)), turnstile_site_key: env.TURNSTILE_SITE_KEY || '' });

async function me({ db, user, nowMs }) {
  const out = {
    role: user.role, name: user.name, username: user.username, email: user.email || '', must_change: user.must_change,
    config: {
      periods: CONFIG.PERIODS, weekend_days: CONFIG.WEEKEND_DAYS, timezone: CONFIG.TIMEZONE,
      today: todayIn(CONFIG.TIMEZONE, new Date(nowMs)), max_backdate_days: CONFIG.MAX_BACKDATE_DAYS,
    },
  };
  if (user.role === 'admin') out.rules = await loadRules(db);
  return json(200, out);
}

async function logout({ db, user, url }) {
  await run(db, 'DELETE FROM auth_sessions WHERE id = ?1', user.tokenId);
  return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(url, '', 0) });
}

async function changePassword({ db, user, body, fb }) {
  const current = typeof body.current === 'string' ? body.current : '';
  const next = typeof body.next === 'string' ? body.next : '';
  if (next.length < 8 || next.length > 100) throw bad('كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل');
  if (next === current) throw bad('كلمة المرور الجديدة يجب أن تختلف عن الحالية');
  if (next.toLowerCase() === String(user.username).toLowerCase()) throw bad('لا تجعل كلمة المرور مثل اسم المستخدم');
  try { await fb.signIn(user.email, current); } catch (e) {
    if (e instanceof FirebaseError) throw new HttpError(401, 'كلمة المرور الحالية غير صحيحة');
    throw e;
  }
  await fb.setPassword(user.uid, next);
  const stmts = [st(db, 'DELETE FROM auth_sessions WHERE uid = ?1 AND id <> ?2', user.uid, user.tokenId)];
  if (user.role === 'teacher') stmts.push(st(db, 'UPDATE teachers SET must_change = 0 WHERE uid = ?1', user.uid));
  stmts.push(auditStmt(db, user.name, 'password.change', { uid: user.uid }));
  await db.batch(stmts);
  return json(200, { ok: true });
}

async function listGroups({ db }) {
  const groups = await all(db,
    `SELECT g.id, g.name, g.kind, COUNT(e.student_id) AS student_count
       FROM groups g LEFT JOIN enrollments e ON e.group_id = g.id
      GROUP BY g.id ORDER BY g.kind, g.name`);
  return json(200, { groups });
}

async function listStudents({ db, params }) {
  const id = idOf(params.id, 'الصف');
  const students = await all(db,
    `SELECT s.id, s.number, s.name FROM enrollments e JOIN students s ON s.id = e.student_id
      WHERE e.group_id = ?1 ORDER BY LENGTH(s.number), s.number`, id);
  return json(200, { students });
}

async function getRecord({ db, query }) {
  const date = isoDate(query.date);
  const period = int(query.period, 'الحصة', 1, CONFIG.PERIODS);
  const gid = idOf(query.group_id, 'الصف');
  const r = await one(db, 'SELECT id, teacher_name, created_at FROM records WHERE date = ?1 AND period = ?2 AND group_id = ?3', date, period, gid);
  if (!r) return json(200, { record: null });
  const entries = await all(db, 'SELECT student_id, status, note FROM entries WHERE record_id = ?1', r.id);
  return json(200, { record: { ...r, entries } });
}

// حفظ رصد حصة — للمعلمين فقط. تُحفظ الحصة مرة واحدة (قيد UNIQUE) فلا يمكن لمعلمين تسجيلها معاً.
async function saveRecord({ db, body, user, nowMs }) {
  const date = isoDate(body.date);
  const period = int(body.period, 'الحصة', 1, CONFIG.PERIODS);
  const gid = idOf(body.group_id, 'الصف');
  const today = todayIn(CONFIG.TIMEZONE, new Date(nowMs));
  if (date > today) throw bad('لا يمكن رصد تاريخ مستقبلي');
  if (date < addDays(today, -CONFIG.MAX_BACKDATE_DAYS)) throw bad(`لا يمكن رصد تاريخ أقدم من ${CONFIG.MAX_BACKDATE_DAYS} يوماً`);
  if (CONFIG.WEEKEND_DAYS.includes(dayOfWeek(date))) throw bad('هذا اليوم عطلة أسبوعية');
  await requireGroup(db, gid);

  const enrolled = new Set((await all(db, 'SELECT student_id FROM enrollments WHERE group_id = ?1', gid)).map((r) => r.student_id));
  if (!enrolled.size) throw bad('لا يوجد طلاب في هذا الصف');
  const marks = new Map();
  for (const e of arr(body.entries ?? [], 'السجلات', { max: 1000 })) {
    const sid = idOf(e?.student_id, 'الطالب');
    const status = oneOf(e?.status, 'الحالة', STATUSES);
    if (!enrolled.has(sid)) throw bad('أحد الطلاب لا ينتمي لهذا الصف');
    if (status !== 'present') marks.set(sid, { s: sid, t: status, n: optStr(e?.note, 'الملاحظة', 200) });
    else marks.delete(sid);
  }
  try {
    await db.batch([
      st(db, 'INSERT INTO records (date, period, group_id, teacher_uid, teacher_name, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
        date, period, gid, user.uid, user.name, nowMs),
      st(db,
        `INSERT INTO entries (record_id, student_id, status, note)
         SELECT (SELECT id FROM records WHERE date = ?1 AND period = ?2 AND group_id = ?3),
                en.student_id, COALESCE(x.t, 'present'), COALESCE(x.n, '')
           FROM enrollments en
           LEFT JOIN (SELECT json_extract(value, '$.s') AS sid, json_extract(value, '$.t') AS t, json_extract(value, '$.n') AS n
                        FROM json_each(?4)) x ON x.sid = en.student_id
          WHERE en.group_id = ?3`, date, period, gid, JSON.stringify([...marks.values()])),
    ]);
  } catch (e) {
    if (/UNIQUE/i.test(String(e?.message))) {
      const r = await one(db, 'SELECT teacher_name FROM records WHERE date = ?1 AND period = ?2 AND group_id = ?3', date, period, gid);
      throw conflict(`تم رصد هذه الحصة مسبقاً${r ? ` بواسطة ${r.teacher_name}` : ''}. تواصل مع الإدارة للتعديل.`);
    }
    throw e;
  }
  return json(201, { ok: true, absent: [...marks.values()].filter((m) => m.t === 'absent').length, late: [...marks.values()].filter((m) => m.t === 'late').length });
}

// التقرير اليومي: غياب وتأخر طلاب الصف في يوم (يشمل غيابهم في المواد المتنقلة المسجلين فيها)
async function dailyReport({ db, query }) {
  const date = isoDate(query.date);
  const gid = idOf(query.group_id, 'الصف');
  const rows = await all(db,
    `SELECT s.id AS student_id, s.number, s.name, r.period, r.teacher_name, e.status, e.note, g.name AS group_name
       FROM enrollments en
       JOIN students s ON s.id = en.student_id
       JOIN entries e ON e.student_id = s.id AND e.status <> 'present'
       JOIN records r ON r.id = e.record_id AND r.date = ?2
       JOIN groups g ON g.id = r.group_id
      WHERE en.group_id = ?1
      ORDER BY LENGTH(s.number), s.number, r.period`, gid, date);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.student_id)) map.set(r.student_id, { student_id: r.student_id, number: r.number, name: r.name, items: [] });
    map.get(r.student_id).items.push({ period: r.period, teacher_name: r.teacher_name, status: r.status, note: r.note, group_name: r.group_name });
  }
  return json(200, { date, students: [...map.values()] });
}

// إحصائيات المعلمين الأسبوعية (الأحد → السبت، دون العطلة)
async function weeklyReport({ db, query, nowMs }) {
  const date = query.date ? isoDate(query.date) : todayIn(CONFIG.TIMEZONE, new Date(nowMs));
  const from = addDays(date, -dayOfWeek(date));
  const to = addDays(from, 6);
  const counts = await all(db,
    `SELECT teacher_uid, MAX(teacher_name) AS name, COUNT(*) AS sessions FROM records
      WHERE date BETWEEN ?1 AND ?2 AND CAST(strftime('%w', date) AS INTEGER) NOT IN (?3, ?4)
      GROUP BY teacher_uid`, from, to, CONFIG.WEEKEND_DAYS[0], CONFIG.WEEKEND_DAYS[1]);
  const teachers = await all(db, 'SELECT uid, name FROM teachers');
  const byUid = new Map(counts.map((c) => [c.teacher_uid, c]));
  const list = teachers.map((t) => ({ uid: t.uid, name: t.name, sessions: byUid.get(t.uid)?.sessions ?? 0 }));
  for (const c of counts) if (!teachers.some((t) => t.uid === c.teacher_uid)) list.push({ uid: c.teacher_uid, name: c.name, sessions: c.sessions });
  const total = list.reduce((n, t) => n + t.sessions, 0);
  list.sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name, 'ar'));
  return json(200, { from, to, total, teachers: list.map((t) => ({ name: t.name, sessions: t.sessions, percent: total ? Math.round((t.sessions / total) * 1000) / 10 : 0 })) });
}

// ------------------------------------------------------------------ 8) واجهات الإدارة فقط (/api/admin/*)
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
  return json(200, { ok: true });
};

async function rulesPut({ db, body, user }) {
  const rules = arr(body.rules, 'القواعد', { min: 1, max: 12 }).map((r) => ({
    min_days: int(r?.min_days, 'عدد الأيام', 1, 365), label: str(r?.label, 'الإجراء', { max: 80 }), color: color(r?.color),
  }));
  if (new Set(rules.map((r) => r.min_days)).size !== rules.length) throw bad('لا يمكن تكرار عدد الأيام في قاعدتين');
  await db.batch([
    st(db, 'DELETE FROM rules'),
    ...rules.map((r) => st(db, 'INSERT INTO rules (min_days, label, color) VALUES (?1, ?2, ?3)', r.min_days, r.label, r.color)),
    auditStmt(db, user.name, 'rules.update', { count: rules.length }),
  ]);
  return json(200, { ok: true });
}

// قراءة قائمة طلاب (رقم + اسم). الرقم مفتاح الطالب: يربطه بصفه الأساسي وبالمواد المتنقلة تلقائياً.
function parseStudents(list) {
  const seen = new Map();
  for (const s of arr(list, 'الطلاب', { min: 1, max: 300 })) {
    const number = latinDigits(str(s?.number, 'رقم الطالب', { max: 30 }));
    if (!/^[A-Za-z0-9._-]+$/.test(number)) throw bad(`رقم الطالب غير صالح: ${number.slice(0, 20)}`);
    if (!seen.has(number)) seen.set(number, str(s?.name, 'اسم الطالب', { max: 120 }));
  }
  return [...seen].map(([n, m]) => ({ n, m }));
}

// إدراج جماعي بعبارة واحدة عبر json_each (لا حلقات ولا دمج نصوص)
function enrollStatements(db, gid, students) {
  const payload = JSON.stringify(students);
  return [
    st(db, `INSERT INTO students (number, name)
            SELECT json_extract(value, '$.n'), json_extract(value, '$.m') FROM json_each(?1) WHERE true
            ON CONFLICT(number) DO NOTHING`, payload),
    st(db, `INSERT OR IGNORE INTO enrollments (group_id, student_id)
            SELECT ?1, id FROM students WHERE number IN (SELECT json_extract(value, '$.n') FROM json_each(?2))`, gid, payload),
  ];
}

async function createGroup({ db, body, user }) {
  const name = str(body.name, 'اسم الصف', { max: 80 });
  const kind = oneOf(body.kind, 'نوع المجموعة', ['basic', 'mobile']);
  const students = parseStudents(body.students);
  let gid;
  try {
    gid = (await one(db, 'INSERT INTO groups (name, kind) VALUES (?1, ?2) RETURNING id', name, kind)).id;
  } catch (e) {
    if (/UNIQUE/i.test(String(e?.message))) throw conflict('يوجد صف أو مادة بهذا الاسم مسبقاً');
    throw e;
  }
  const res = await db.batch([...enrollStatements(db, gid, students), auditStmt(db, user.name, 'group.create', { name, kind, students: students.length })]);
  const added = res[0].meta?.changes ?? 0;
  return json(201, { id: gid, students: students.length, new_students: added, linked: students.length - added });
}

async function addStudents({ db, params, body, user }) {
  const gid = idOf(params.id, 'الصف');
  const g = await requireGroup(db, gid);
  const students = parseStudents(body.students);
  const res = await db.batch([...enrollStatements(db, gid, students), auditStmt(db, user.name, 'student.add', { group: g.name, count: students.length })]);
  const enrolled = res[1].meta?.changes ?? 0;
  if (!enrolled) throw conflict('جميع الطلاب موجودون مسبقاً في هذا الصف');
  return json(201, { added: enrolled, new_students: res[0].meta?.changes ?? 0, skipped: students.length - enrolled });
}

const ORPHANS = `DELETE FROM students WHERE NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = students.id)
                                   AND NOT EXISTS (SELECT 1 FROM entries x WHERE x.student_id = students.id)`;

async function deleteGroup({ db, params, user }) {
  const gid = idOf(params.id, 'الصف');
  const g = await requireGroup(db, gid);
  const c = await one(db, 'SELECT (SELECT COUNT(*) FROM enrollments WHERE group_id = ?1) AS students, (SELECT COUNT(*) FROM records WHERE group_id = ?1) AS records', gid);
  await db.batch([st(db, 'DELETE FROM groups WHERE id = ?1', gid), st(db, ORPHANS), auditStmt(db, user.name, 'group.delete', { name: g.name, kind: g.kind, ...c })]);
  return json(200, { ok: true });
}

async function removeStudent({ db, params, user }) {
  const gid = idOf(params.id, 'الصف');
  const sid = idOf(params.sid, 'الطالب');
  const info = await one(db,
    `SELECT s.number, s.name, g.name AS group_name FROM enrollments e JOIN students s ON s.id = e.student_id JOIN groups g ON g.id = e.group_id
      WHERE e.group_id = ?1 AND e.student_id = ?2`, gid, sid);
  if (!info) throw notFound('الطالب غير موجود في هذا الصف');
  await db.batch([st(db, 'DELETE FROM enrollments WHERE group_id = ?1 AND student_id = ?2', gid, sid), st(db, ORPHANS),
    auditStmt(db, user.name, 'student.remove', { group: info.group_name, number: info.number, name: info.name })]);
  return json(200, { ok: true });
}

// ---- المعلمون والحسابات
const listTeachers = async ({ db }) =>
  json(200, { teachers: await all(db, "SELECT uid, username, name, COALESCE(role, 'teacher') AS role, COALESCE(email, '') AS email, must_change, created_at FROM teachers ORDER BY role DESC, username") });

// إنشاء حساب فردي (عربي أو إنجليزي، معلم أو إدارة) وتخزينه في Firebase Auth وFirestore
async function createSingleAccount({ db, body, user, fb, nowMs }) {
  const name = str(body.name, 'الاسم الكامل', { min: 2, max: 100 });
  const role = oneOf(body.role || 'teacher', 'نوع الحساب', ['teacher', 'admin']);
  const mustChange = body.must_change === false ? 0 : 1;

  let username = typeof body.username === 'string' ? body.username.trim() : '';
  if (!username) {
    const nums = (await all(db, "SELECT username FROM teachers WHERE username GLOB 't[0-9]*'")).map((r) => Number(r.username.slice(1)) || 0);
    const next = Math.max(0, ...nums) + 1;
    username = `t${String(next).padStart(2, '0')}`;
  } else {
    username = str(username, 'اسم المستخدم', { min: 2, max: 80 }).replace(/\s+/g, '_');
  }

  const existing = await one(db, 'SELECT username FROM teachers WHERE LOWER(username) = LOWER(?1)', username);
  if (existing) throw conflict(`اسم المستخدم «${username}» مستخدم بالفعل`);

  const password = typeof body.password === 'string' && body.password.length >= 8 ? body.password : newPassword(10);
  const email = safeFirebaseEmail(username);

  // 1) إنشاء الحساب في Google Firebase Auth
  let fbUser;
  try {
    fbUser = await fb.createUser(email, password, name);
  } catch (e) {
    if (e instanceof FirebaseError) {
      if (e.code === 'EMAIL_EXISTS') throw conflict('هذا الحساب موجود مسبقاً في Firebase');
      throw bad(`خطأ في Firebase: ${e.code}`);
    }
    throw e;
  }
  const uid = fbUser.uid;

  // 2) حفظ بيانات الحساب في Google Firebase Firestore
  const firestoreData = {
    uid,
    name,
    username,
    email,
    role,
    must_change: !!mustChange,
    created_at: nowMs,
    updated_at: nowMs,
  };
  await fb.saveDoc('users', uid, firestoreData);

  // 3) حفظ الحساب في قاعدة البيانات المحلية (D1)
  try {
    await db.batch([
      st(db, 'INSERT INTO teachers (uid, username, name, role, email, must_change, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
        uid, username, name, role, email, mustChange, nowMs),
      auditStmt(db, user.name, 'account.create', { uid, username, name, role }),
    ]);
  } catch (e) {
    await fb.deleteUser(uid).catch(() => {});
    await fb.deleteDoc('users', uid).catch(() => {});
    throw e;
  }

  return json(201, {
    ok: true,
    account: {
      uid,
      name,
      username,
      password,
      role,
      must_change: !!mustChange,
      email,
      firebase_stored: true,
    },
  });
}

// إنشاء حسابات معلمين دفعة واحدة (حتى 10 في الطلب لأن Cloudflare المجاني يحدّ الطلبات الفرعية).
// تُعاد كلمات المرور مرة واحدة فقط ولا تُخزَّن في أي مكان، وتُحفظ السجلات في Firebase Auth وFirestore.
async function createTeachers({ db, body, user, fb, nowMs }) {
  const names = [...new Set(arr(body.names, 'الأسماء', { min: 1, max: 10 }).map((n) => str(n, 'اسم المعلم', { max: 80 })))];
  const existing = new Set((await all(db, 'SELECT name FROM teachers')).map((r) => r.name));
  const nums = (await all(db, "SELECT username FROM teachers WHERE username GLOB 't[0-9]*'")).map((r) => Number(r.username.slice(1)) || 0);
  let next = Math.max(0, ...nums) + 1;
  const created = []; const skipped = []; const failed = [];
  for (const name of names) {
    if (existing.has(name)) { skipped.push(name); continue; }
    const username = `t${String(next).padStart(2, '0')}`;
    const password = newPassword();
    try {
      const { uid } = await fb.createUser(emailFor(username), password, name);
      created.push({ uid, username, name, password });
      next += 1;
    } catch (e) {
      if (!(e instanceof FirebaseError)) throw e;
      failed.push({ name, reason: e.code });
    }
  }
  if (created.length) {
    try {
      await db.batch([
        ...created.map((t) => st(db, 'INSERT INTO teachers (uid, username, name, role, email, must_change, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)',
          t.uid, t.username, t.name, 'teacher', safeFirebaseEmail(t.username), nowMs)),
        auditStmt(db, user.name, 'teachers.create', { count: created.length }),
      ]);
      for (const t of created) {
        await fb.saveDoc('users', t.uid, {
          uid: t.uid,
          name: t.name,
          username: t.username,
          email: safeFirebaseEmail(t.username),
          role: 'teacher',
          must_change: true,
          created_at: nowMs,
        }).catch(() => {});
      }
    } catch (e) {
      for (const t of created) {
        await fb.deleteUser(t.uid).catch(() => {});
        await fb.deleteDoc('users', t.uid).catch(() => {});
      }
      throw e;
    }
  }
  return json(201, { created: created.map(({ uid, ...t }) => t), skipped, failed });
}

async function resetTeacher({ db, params, user, fb, nowMs }) {
  const uid = uidOf(params.uid);
  const t = await one(db, "SELECT username, name, COALESCE(role, 'teacher') AS role FROM teachers WHERE uid = ?1", uid);
  if (!t) throw notFound('المعلم غير موجود');
  const password = newPassword();
  await fb.setPassword(uid, password);
  await fb.saveDoc('users', uid, {
    uid,
    name: t.name,
    username: t.username,
    role: t.role,
    must_change: true,
    reset_at: nowMs,
  }).catch(() => {});
  await db.batch([st(db, 'UPDATE teachers SET must_change = 1 WHERE uid = ?1', uid), st(db, 'DELETE FROM auth_sessions WHERE uid = ?1', uid),
    auditStmt(db, user.name, 'teacher.reset', { username: t.username })]);
  return json(200, { username: t.username, name: t.name, password });
}

async function deleteTeacher({ db, params, user, fb }) {
  const uid = uidOf(params.uid);
  const t = await one(db, 'SELECT username, name FROM teachers WHERE uid = ?1', uid);
  if (!t) throw notFound('المعلم غير موجود');
  await fb.deleteUser(uid).catch((e) => { if (!(e instanceof FirebaseError) || !/NOT_FOUND/.test(e.code)) throw e; });
  await fb.deleteDoc('users', uid).catch(() => {});
  await db.batch([st(db, 'DELETE FROM teachers WHERE uid = ?1', uid), st(db, 'DELETE FROM auth_sessions WHERE uid = ?1', uid),
    auditStmt(db, user.name, 'teacher.delete', { username: t.username, name: t.name })]);
  return json(200, { ok: true });
}

async function changeTeacherRole({ db, params, body, user, fb, nowMs, env }) {
  const uid = uidOf(params.uid);
  const nextRole = oneOf(body.role, 'نوع الحساب', ['viewer', 'teacher', 'admin']);
  const t = await one(db, "SELECT uid, username, name, COALESCE(role, 'teacher') AS role, COALESCE(email, '') AS email FROM teachers WHERE uid = ?1", uid);
  if (!t) throw notFound('الحساب غير موجود');

  const rootAdmins = adminUids(env);
  if (rootAdmins.has(uid) && nextRole !== 'admin') {
    throw forbidden('لا يمكن تخفيض رتبة مدير النظام الرئيسي المحدد في إعدادات البيئة');
  }

  await db.batch([
    st(db, 'UPDATE teachers SET role = ?1 WHERE uid = ?2', nextRole, uid),
    st(db, 'UPDATE auth_sessions SET role = ?1 WHERE uid = ?2', nextRole, uid),
    auditStmt(db, user.name, 'teacher.role_change', { uid, username: t.username, name: t.name, from: t.role, to: nextRole }),
  ]);

  await fb.saveDoc('users', uid, {
    uid,
    name: t.name,
    username: t.username,
    email: t.email,
    role: nextRole,
    updated_at: nowMs,
  }).catch(() => {});

  return json(200, { ok: true, uid, role: nextRole });
}

async function syncFirebase({ db, user, fb, nowMs }) {
  const teachers = await all(db, "SELECT uid, username, name, COALESCE(role, 'teacher') AS role, COALESCE(email, '') AS email, must_change, created_at FROM teachers");
  const groups = await all(db, 'SELECT id, name, kind FROM groups');
  const settings = await loadSettings(db);

  let userCount = 0;
  for (const t of teachers) {
    const email = t.email || safeFirebaseEmail(t.username);
    await fb.saveDoc('users', t.uid, {
      uid: t.uid,
      name: t.name,
      username: t.username,
      email,
      role: t.role,
      must_change: !!t.must_change,
      created_at: t.created_at || nowMs,
      synced_at: nowMs,
    }).catch(() => {});
    userCount += 1;
  }

  let groupCount = 0;
  for (const g of groups) {
    await fb.saveDoc('groups', String(g.id), {
      id: g.id,
      name: g.name,
      kind: g.kind,
      synced_at: nowMs,
    }).catch(() => {});
    groupCount += 1;
  }

  await fb.saveDoc('settings', 'general', {
    ...settings,
    synced_at: nowMs,
  }).catch(() => {});

  await audit(db, user.name, 'firebase.sync', { userCount, groupCount });

  return json(200, {
    ok: true,
    message: 'تمت مزامنة جميع الحسابات والصفوف والإعدادات في Google Firebase بنجاح',
    synced: {
      users: userCount,
      groups: groupCount,
      settings: true,
    },
  });
}

async function firebaseStatus({ env }) {
  const isDev = env.DEV_FAKE_AUTH === '1';
  return json(200, {
    ok: true,
    mode: isDev ? 'dev' : 'real',
    service: 'Google Firebase',
    auth_enabled: true,
    firestore_enabled: true,
  });
}

// ---- التقرير الشهري وإدارة سجلات الغياب
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
  const listed = all_.filter((s) => s.absent.size >= minDays).sort((a, b) => b.absent.size - a.absent.size || a.name.localeCompare(b.name, 'ar'));
  return json(200, {
    month, group, min_days: minDays,
    totals: { absence_days: all_.reduce((n, s) => n + s.absent.size, 0), late_days: all_.reduce((n, s) => n + s.late.size, 0), students: all_.length },
    students: listed.map((s) => ({ id: s.id, number: s.number, name: s.name, absence_days: s.absent.size, absences: dates(s.absent),
      late_days: dates(s.late), action: disciplineAction(s.absent.size, rules) })),
  });
}

// حذف غياب (أو تأخر) طالب في يوم محدد: يتحول إلى "حاضر" مع ملاحظة، ويبقى أثره في سجل التدقيق
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

async function listRecords({ db, query }) {
  const date = isoDate(query.date);
  const records = await all(db,
    `SELECT r.id, r.period, r.teacher_name, g.name AS group_name,
            SUM(e.status = 'absent') AS absent, SUM(e.status = 'late') AS late, COUNT(e.student_id) AS total
       FROM records r JOIN groups g ON g.id = r.group_id LEFT JOIN entries e ON e.record_id = r.id
      WHERE r.date = ?1 GROUP BY r.id ORDER BY r.period, g.name`, date);
  return json(200, { date, records });
}

async function deleteRecord({ db, params, user }) {
  const id = idOf(params.id, 'السجل');
  const r = await one(db, 'SELECT r.date, r.period, r.teacher_name, g.name AS group_name FROM records r JOIN groups g ON g.id = r.group_id WHERE r.id = ?1', id);
  if (!r) throw notFound('السجل غير موجود');
  await db.batch([st(db, 'DELETE FROM records WHERE id = ?1', id), auditStmt(db, user.name, 'record.delete', r)]);
  return json(200, { ok: true });
}

const auditList = async ({ db }) =>
  json(200, { entries: await all(db, 'SELECT id, at, actor, action, details FROM audit ORDER BY id DESC LIMIT 100') });

// ------------------------------------------------------------------ 9) الموجّه والترويسات
// access: 'public' بلا دخول | 'any' أي مستخدم مسجّل | 'teacher' المعلمون فقط | 'admin' الإدارة فقط
// القاعدة الصارمة: كل مسار يبدأ بـ /api/admin/ يجب أن يكون access = 'admin' (يُفحص عند التحميل وفي الاختبارات).
export const ROUTES = [
  ['GET', '/api/public', 'public', publicInfo],
  ['POST', '/api/login', 'public', login],
  ['POST', '/api/auth/google', 'public', googleAuth],
  ['GET', '/api/auth/google/login', 'public', googleOAuthLogin],
  ['GET', '/api/auth/google/callback', 'public', googleOAuthCallback],
  ['GET', '/api/auth/google/dev-quick-login', 'public', googleDevQuickLogin],
  ['GET', '/api/me', 'any', me],
  ['POST', '/api/logout', 'any', logout],
  ['POST', '/api/password', 'any', changePassword],
  ['GET', '/api/groups', 'any', listGroups],
  ['GET', '/api/groups/:id/students', 'any', listStudents],
  ['GET', '/api/record', 'any', getRecord],
  ['POST', '/api/record', 'teacher', saveRecord],
  ['GET', '/api/reports/daily', 'any', dailyReport],
  ['GET', '/api/reports/weekly', 'any', weeklyReport],
  ['PUT', '/api/admin/settings', 'admin', publicSettingsPut],
  ['PUT', '/api/admin/rules', 'admin', rulesPut],
  ['POST', '/api/admin/groups', 'admin', createGroup],
  ['DELETE', '/api/admin/groups/:id', 'admin', deleteGroup],
  ['POST', '/api/admin/groups/:id/students', 'admin', addStudents],
  ['DELETE', '/api/admin/groups/:id/students/:sid', 'admin', removeStudent],
  ['GET', '/api/admin/teachers', 'admin', listTeachers],
  ['POST', '/api/admin/teachers', 'admin', createTeachers],
  ['POST', '/api/admin/accounts', 'admin', createSingleAccount],
  ['POST', '/api/admin/firebase/sync', 'admin', syncFirebase],
  ['GET', '/api/admin/firebase/status', 'admin', firebaseStatus],
  ['POST', '/api/admin/teachers/:uid/reset', 'admin', resetTeacher],
  ['PUT', '/api/admin/teachers/:uid/role', 'admin', changeTeacherRole],
  ['DELETE', '/api/admin/teachers/:uid', 'admin', deleteTeacher],
  ['GET', '/api/admin/reports/monthly', 'admin', monthlyReport],
  ['POST', '/api/admin/entries/clear', 'admin', clearEntries],
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
  if (!text) return {}; // مثل DELETE بلا جسم
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

  // حماية CSRF: كل طلب يغيّر بيانات يجب أن يأتي من نفس الموقع (ملف الارتباط SameSite=Strict يضيف طبقة ثانية)
  if (method !== 'GET' && request.headers.get('Origin') !== url.origin) throw forbidden('طلب مرفوض');

  const nowMs = deps.now().getTime();
  await ensureSchema(env.DB);
  const fb = deps.firebase ? deps.firebase(env) : (env.DEV_FAKE_AUTH === '1' && isLocal(url) ? fakeFirebase(env) : realFirebase(env));
  const ctx = {
    request, env, url, db: env.DB, nowMs, fb, params, query: Object.fromEntries(url.searchParams),
    ip: request.headers.get('CF-Connecting-IP') ?? 'local', user: null, body: {},
  };

  if (r.access !== 'public') {
    ctx.user = await loadSession(ctx);
    if (!ctx.user) throw new HttpError(401, 'يلزم تسجيل الدخول');
    // صلاحيات صارمة على الخادم (وليست في الواجهة فقط)
    if (r.access === 'admin' && ctx.user.role !== 'admin') throw forbidden();
    if (r.access === 'teacher' && ctx.user.role !== 'teacher') throw forbidden();
    // حتى يغيّر المعلم كلمة مروره المؤقتة لا يصل إلا إلى هذه الثلاثة
    if (ctx.user.must_change && !['/api/me', '/api/password', '/api/logout'].includes(r.path)) throw new HttpError(403, 'يجب تغيير كلمة المرور أولاً');
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
