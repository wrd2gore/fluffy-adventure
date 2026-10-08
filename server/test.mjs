// اختبارات الخادم: الصلاحيات، الأمان، حقن SQL، منطق الغياب والتقارير.
// التشغيل: npm test   (يستخدم SQLite المدمج في Node كبديل محلي لـ D1 وFirebase وهمي)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createApp, fakeFirebase, realFirebase, ROUTES, sha256, CONFIG } from './worker.js';

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const WORKER_SRC = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
const ORIGIN = 'https://school.test';
const NOW = new Date('2026-10-06T08:00:00Z'); // الثلاثاء 2026-10-06 (12:00 بتوقيت مسقط)
const DAY = { tue: '2026-10-06', mon: '2026-10-05', sun: '2026-10-04', sat: '2026-10-03', fri: '2026-10-02' };

// ---- بديل D1 فوق node:sqlite
function makeD1() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA);
  const mk = (sql, b = []) => ({
    bind: (...args) => mk(sql, args),
    all: async () => ({ results: raw.prepare(sql).all(...b).map((r) => ({ ...r })), meta: {} }),
    first: async () => { const r = raw.prepare(sql).all(...b)[0]; return r ? { ...r } : null; },
    run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...b).changes) } }),
    _run: () => ({ meta: { changes: Number(raw.prepare(sql).run(...b).changes) } }),
  });
  return {
    raw,
    prepare: (sql) => mk(sql),
    batch: async (stmts) => {
      raw.exec('BEGIN');
      try { const out = stmts.map((s) => s._run()); raw.exec('COMMIT'); return out; } catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  };
}

function world(extraEnv = {}, clock = { t: NOW }) {
  const DB = makeD1();
  const env = {
    DB, ASSETS: { fetch: async () => new Response('<!doctype html><title>x</title>', { headers: { 'Content-Type': 'text/html' } }) },
    ADMIN_UIDS: 'dev-admin', DEV_ADMIN_EMAIL: 'boss@school.example', DEV_ADMIN_PASSWORD: 'Boss-Pass-123', ...extraEnv,
  };
  const app = createApp({ now: () => clock.t, firebase: (e) => fakeFirebase(e) });
  async function call(method, path, { body, cookie, origin = ORIGIN, ip = '1.1.1.1', headers = {}, raw } = {}) {
    const h = { 'CF-Connecting-IP': ip, ...headers };
    if (origin) h.Origin = origin;
    if (cookie) h.Cookie = cookie;
    if (body !== undefined || raw !== undefined) h['Content-Type'] = headers['Content-Type'] ?? 'application/json';
    const res = await app.fetch(new Request(ORIGIN + path, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }), env);
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, data, headers: res.headers, text };
  }
  const cookieOf = (r) => (r.headers.get('Set-Cookie') ?? '').split(';')[0];
  async function login(gate, username, password, extra = {}) {
    const r = await call('POST', '/api/login', { body: { gate, username, password, ...extra } });
    return { r, cookie: cookieOf(r) };
  }
  async function admin() { const { r, cookie } = await login('admin', 'boss@school.example', 'Boss-Pass-123'); assert.equal(r.status, 200, r.text); return cookie; }
  // ينشئ معلمين ويغيّر كلمة مرورهم المؤقتة ويعيد جلسة جاهزة لكل منهم
  async function teachers(adminCookie, names) {
    const c = await call('POST', '/api/admin/teachers', { cookie: adminCookie, body: { names } });
    assert.equal(c.status, 201, c.text);
    const out = [];
    for (const t of c.data.created) {
      const { r, cookie } = await login('teacher', t.username, t.password);
      assert.equal(r.status, 200, r.text);
      const p = await call('POST', '/api/password', { cookie, body: { current: t.password, next: `New-${t.password}-9` } });
      assert.equal(p.status, 200, p.text);
      out.push({ ...t, cookie, newPassword: `New-${t.password}-9` });
    }
    return out;
  }
  const students = (n, from = 1) => Array.from({ length: n }, (_, i) => ({ number: String(from + i), name: `طالب ${from + i}` }));
  async function group(adminCookie, name, kind, list) {
    const r = await call('POST', '/api/admin/groups', { cookie: adminCookie, body: { name, kind, students: list } });
    assert.equal(r.status, 201, r.text);
    return r.data;
  }
  const idsOf = async (gid, c) => (await call('GET', `/api/groups/${gid}/students`, { cookie: c })).data.students;
  return { env, call, login, admin, teachers, group, students, idsOf, cookieOf, DB, clock };
}

// ===================================================================== الأساسيات والأمان العام
test('الواجهة العامة تعرض اسم المدرسة فقط، وبقية المسارات تتطلب دخولاً', async () => {
  const w = world();
  const p = await w.call('GET', '/api/public');
  assert.equal(p.status, 200);
  assert.deepEqual(Object.keys(p.data).sort(), ['developer_credit', 'principal_name', 'school_name', 'turnstile_site_key']);
  for (const path of ['/api/me', '/api/groups', '/api/reports/daily?date=2026-10-06&group_id=1', '/api/admin/teachers', '/api/admin/audit']) {
    assert.equal((await w.call('GET', path)).status, 401, path);
  }
  assert.equal((await w.call('GET', '/api/nope')).status, 404);
});

test('ترويسات الأمان على الواجهة البرمجية وعلى ملفات الموقع', async () => {
  const w = world();
  for (const r of [await w.call('GET', '/api/public'), await w.call('GET', '/index.html')]) {
    const csp = r.headers.get('Content-Security-Policy');
    assert.match(csp, /default-src 'none'/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
    assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(r.headers.get('X-Frame-Options'), 'DENY');
    assert.match(r.headers.get('Strict-Transport-Security'), /max-age/);
  }
  assert.equal((await w.call('GET', '/api/public')).headers.get('Cache-Control'), 'no-store');
});

test('CSRF: يُرفض أي تغيير بلا Origin صحيح أو بنوع محتوى غير JSON', async () => {
  const w = world();
  const body = { gate: 'admin', username: 'boss@school.example', password: 'Boss-Pass-123' };
  assert.equal((await w.call('POST', '/api/login', { body, origin: null })).status, 403);
  assert.equal((await w.call('POST', '/api/login', { body, origin: 'https://evil.test' })).status, 403);
  assert.equal((await w.call('POST', '/api/login', { raw: 'a=b', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 415);
  assert.equal((await w.call('POST', '/api/login', { raw: '{bad' })).status, 400);
  assert.equal((await w.call('POST', '/api/login', { raw: '[1]' })).status, 400);
  assert.equal((await w.call('POST', '/api/login', { raw: JSON.stringify({ x: 'a'.repeat(300000) }) })).status, 413);
  assert.equal((await w.call('POST', '/api/login', { body })).status, 200);
});

test('الجلسة: ملف ارتباط محمي، والقاعدة تحفظ البصمة فقط، والخروج يلغيها', async () => {
  const w = world();
  const { r, cookie } = await w.login('admin', 'boss@school.example', 'Boss-Pass-123');
  const sc = r.headers.get('Set-Cookie');
  assert.match(sc, /^__Host-sid=/); assert.match(sc, /HttpOnly/); assert.match(sc, /Secure/); assert.match(sc, /SameSite=Strict/); assert.match(sc, /Path=\//);
  const token = cookie.split('=')[1];
  const rows = w.DB.raw.prepare('SELECT id FROM auth_sessions').all();
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].id, token);
  assert.equal(rows[0].id, await sha256(token));
  assert.equal((await w.call('GET', '/api/me', { cookie })).data.role, 'admin');
  assert.equal((await w.call('POST', '/api/logout', { cookie, body: {} })).status, 200);
  assert.equal((await w.call('GET', '/api/me', { cookie })).status, 401);
  assert.equal((await w.call('GET', '/api/me', { cookie: '__Host-sid=garbage' })).status, 401);
});

test('انتهاء الجلسة بعد المدة المحددة', async () => {
  const clock = { t: NOW };
  const w = world({}, clock);
  const cookie = await w.admin();
  assert.equal((await w.call('GET', '/api/me', { cookie })).status, 200);
  clock.t = new Date(NOW.getTime() + (CONFIG.SESSION_HOURS * 3600 + 5) * 1000);
  assert.equal((await w.call('GET', '/api/me', { cookie })).status, 401);
});

// ===================================================================== فصل البوابات
test('بوابة المعلمين وبوابة الإدارة: كل حساب يدخل بوابته فقط', async () => {
  const w = world();
  const a = await w.admin();
  const [t] = await w.teachers(a, ['الاستاذ احمد']);
  assert.equal((await w.login('admin', t.username, t.newPassword)).r.status, 403, 'المعلم لا يدخل بوابة الإدارة');
  assert.equal((await w.login('teacher', 'boss@school.example', 'Boss-Pass-123')).r.status, 401, 'الإدارة لا تدخل من اسم بريد على بوابة المعلمين');
  assert.equal((await w.login('teacher', t.username, t.newPassword)).r.status, 200);
  assert.equal((await w.login('teacher', t.username, 'wrong')).r.status, 401);
  assert.equal((await w.login('hacker', t.username, t.newPassword)).r.status, 400);
});

test('المعلم يحصل على 403 في كل مسار إدارة، والمجهول على 401', async () => {
  const w = world();
  const a = await w.admin();
  const [t] = await w.teachers(a, ['معلم تجريبي']);
  const adminRoutes = ROUTES.filter((r) => r.path.startsWith('/api/admin/'));
  assert.ok(adminRoutes.length >= 10);
  for (const r of adminRoutes) {
    const path = r.path.replace(':id', '1').replace(':sid', '1').replace(':uid', 'abc');
    const opts = { body: r.method === 'GET' ? undefined : {} };
    const asTeacher = await w.call(r.method, path, { ...opts, cookie: t.cookie });
    assert.equal(asTeacher.status, 403, `${r.method} ${r.path} (معلم)`);
    const anon = await w.call(r.method, path, opts);
    assert.equal(anon.status, 401, `${r.method} ${r.path} (مجهول)`);
  }
  // لا يتجاوز الحماية بتغيير حالة الأحرف أو المسار
  assert.ok([403, 404, 401].includes((await w.call('GET', '/api/ADMIN/teachers', { cookie: t.cookie })).status));
  assert.ok([404].includes((await w.call('GET', '/api/admin/teachers/', { cookie: t.cookie })).status));
});

test('الإدارة لا ترصد الغياب (الرصد للمعلمين فقط)', async () => {
  const w = world();
  const a = await w.admin();
  const g = await w.group(a, 'الصف 1', 'basic', w.students(2));
  const r = await w.call('POST', '/api/record', { cookie: a, body: { date: DAY.tue, period: 1, group_id: g.id, entries: [] } });
  assert.equal(r.status, 403);
});

test('إزالة معرّف المدير من ADMIN_UIDS تبطل جلسته فوراً', async () => {
  const w = world();
  const a = await w.admin();
  assert.equal((await w.call('GET', '/api/admin/teachers', { cookie: a })).status, 200);
  w.env.ADMIN_UIDS = '';
  assert.equal((await w.call('GET', '/api/admin/teachers', { cookie: a })).status, 401);
});

// ===================================================================== حسابات المعلمين
test('إنشاء المعلمين: أسماء مستخدمين متسلسلة، كلمات مرور عشوائية، تخطي المكرر', async () => {
  const w = world();
  const a = await w.admin();
  const r = await w.call('POST', '/api/admin/teachers', { cookie: a, body: { names: ['أحمد', 'بسام', 'أحمد'] } });
  assert.equal(r.status, 201);
  assert.deepEqual(r.data.created.map((t) => t.username), ['t01', 't02']);
  assert.ok(r.data.created.every((t) => /^[A-Za-z2-9]{10}$/.test(t.password)));
  assert.notEqual(r.data.created[0].password, r.data.created[1].password);
  const again = await w.call('POST', '/api/admin/teachers', { cookie: a, body: { names: ['أحمد', 'جاسم'] } });
  assert.deepEqual(again.data.skipped, ['أحمد']);
  assert.equal(again.data.created[0].username, 't03');
  // كلمات المرور لا تُخزَّن في D1 إطلاقاً
  const dump = JSON.stringify(w.DB.raw.prepare('SELECT * FROM teachers').all());
  for (const t of [...r.data.created, ...again.data.created]) assert.ok(!dump.includes(t.password));
  assert.equal((await w.call('POST', '/api/admin/teachers', { cookie: a, body: { names: Array(11).fill('x').map((x, i) => x + i) } })).status, 400);
  const list = await w.call('GET', '/api/admin/teachers', { cookie: a });
  assert.equal(list.data.teachers.length, 3);
  assert.ok(list.data.teachers.every((t) => t.must_change === 1));
});

test('كلمة المرور المؤقتة: لا يصل المعلم لأي شيء قبل تغييرها', async () => {
  const w = world();
  const a = await w.admin();
  const c = await w.call('POST', '/api/admin/teachers', { cookie: a, body: { names: ['معلم'] } });
  const t = c.data.created[0];
  const { r, cookie } = await w.login('teacher', t.username, t.password);
  assert.equal(r.data.must_change, true);
  assert.equal((await w.call('GET', '/api/groups', { cookie })).status, 403);
  assert.equal((await w.call('GET', '/api/me', { cookie })).status, 200);
  const weak = await w.call('POST', '/api/password', { cookie, body: { current: t.password, next: 'short' } });
  assert.equal(weak.status, 400);
  assert.equal((await w.call('POST', '/api/password', { cookie, body: { current: 'wrong-current', next: 'Longer-pass-1' } })).status, 401);
  assert.equal((await w.call('POST', '/api/password', { cookie, body: { current: t.password, next: t.password } })).status, 400);
  assert.equal((await w.call('POST', '/api/password', { cookie, body: { current: t.password, next: 'Longer-pass-1' } })).status, 200);
  assert.equal((await w.call('GET', '/api/groups', { cookie })).status, 200);
  assert.equal((await w.login('teacher', t.username, t.password)).r.status, 401, 'القديمة لم تعد تعمل');
  assert.equal((await w.login('teacher', t.username, 'Longer-pass-1')).r.data.must_change, false);
});

test('إعادة تعيين كلمة مرور معلم تُلغي جلساته، وحذفه يُبطل دخوله', async () => {
  const w = world();
  const a = await w.admin();
  const [t] = await w.teachers(a, ['معلم']);
  const reset = await w.call('POST', `/api/admin/teachers/${(await w.call('GET', '/api/admin/teachers', { cookie: a })).data.teachers[0].uid}/reset`, { cookie: a, body: {} });
  assert.equal(reset.status, 200);
  assert.equal((await w.call('GET', '/api/me', { cookie: t.cookie })).status, 401);
  assert.equal((await w.login('teacher', t.username, t.newPassword)).r.status, 401);
  const re = await w.login('teacher', t.username, reset.data.password);
  assert.equal(re.r.data.must_change, true);
  const uid = (await w.call('GET', '/api/admin/teachers', { cookie: a })).data.teachers[0].uid;
  assert.equal((await w.call('DELETE', `/api/admin/teachers/${uid}`, { cookie: a })).status, 200);
  assert.equal((await w.call('GET', '/api/me', { cookie: re.cookie })).status, 401);
  assert.equal((await w.login('teacher', t.username, reset.data.password)).r.status, 401);
  assert.equal((await w.call('DELETE', `/api/admin/teachers/${uid}`, { cookie: a })).status, 404);
});

test('الحد من تخمين كلمات المرور (لكل مستخدم ولكل عنوان)', async () => {
  const w = world();
  const a = await w.admin();
  const [t] = await w.teachers(a, ['معلم']);
  for (let i = 0; i < CONFIG.LOGIN_MAX_PER_USER; i += 1) assert.equal((await w.login('teacher', t.username, `bad${i}`)).r.status, 401);
  assert.equal((await w.login('teacher', t.username, t.newPassword)).r.status, 429, 'حتى الصحيحة تُرفض أثناء الحظر');
  // عنوان آخر لنفس المستخدم ما زال محظوراً (الحد على المستخدم)
  const other = await w.call('POST', '/api/login', { ip: '9.9.9.9', body: { gate: 'teacher', username: t.username, password: t.newPassword } });
  assert.equal(other.status, 429);
  // حد العنوان
  for (let i = 0; i < CONFIG.LOGIN_MAX_PER_IP; i += 1) await w.call('POST', '/api/login', { ip: '7.7.7.7', body: { gate: 'teacher', username: `user${i}x`, password: 'x' } });
  const blocked = await w.call('POST', '/api/login', { ip: '7.7.7.7', body: { gate: 'teacher', username: 'another', password: 'x' } });
  assert.equal(blocked.status, 429);
  // بعد انقضاء النافذة يعود الدخول
  w.clock.t = new Date(NOW.getTime() + (CONFIG.LOGIN_WINDOW_MIN * 60 + 5) * 1000);
  assert.equal((await w.login('teacher', t.username, t.newPassword)).r.status, 200);
});

test('Turnstile: عند تفعيله يُشترط الرمز ويُتحقق منه لدى Cloudflare', async () => {
  const w = world({ TURNSTILE_SECRET: 'sec', TURNSTILE_SITE_KEY: 'site' });
  const body = { gate: 'admin', username: 'boss@school.example', password: 'Boss-Pass-123' };
  assert.equal((await w.call('GET', '/api/public')).data.turnstile_site_key, 'site');
  assert.equal((await w.call('POST', '/api/login', { body })).status, 400);
  const real = globalThis.fetch; const seen = [];
  globalThis.fetch = async (url, init) => { seen.push([String(url), String(init.body)]); return new Response(JSON.stringify({ success: seen.length > 1 }), { status: 200 }); };
  try {
    assert.equal((await w.call('POST', '/api/login', { body: { ...body, turnstile: 'tok1' } })).status, 400);
    assert.equal((await w.call('POST', '/api/login', { body: { ...body, turnstile: 'tok2' } })).status, 200);
  } finally { globalThis.fetch = real; }
  assert.match(seen[0][0], /challenges\.cloudflare\.com\/turnstile\/v0\/siteverify/);
  assert.match(seen[0][1], /secret=sec/);
});

// ===================================================================== الصفوف والطلاب
test('الصفوف: إنشاء، ربط المواد المتنقلة بالصف الأساسي عبر رقم الطالب، حذف', async () => {
  const w = world();
  const a = await w.admin();
  const basic = await w.group(a, '10-1', 'basic', [...w.students(3), { number: '٤', name: 'طالب أرقام عربية' }]);
  assert.deepEqual([basic.students, basic.new_students, basic.linked], [4, 4, 0]);
  const mobile = await w.group(a, 'رياضيات', 'mobile', [{ number: '2', name: 'اسم مختلف' }, { number: '4', name: 'x' }, { number: '9', name: 'جديد' }]);
  assert.deepEqual([mobile.students, mobile.new_students, mobile.linked], [3, 1, 2]);
  assert.equal((await w.call('POST', '/api/admin/groups', { cookie: a, body: { name: '10-1', kind: 'basic', students: w.students(1) } })).status, 409);
  const list = (await w.call('GET', '/api/groups', { cookie: a })).data.groups;
  assert.deepEqual(list.map((g) => [g.name, g.kind, g.student_count]), [['10-1', 'basic', 4], ['رياضيات', 'mobile', 3]]);
  const ss = await w.idsOf(basic.id, a);
  assert.equal(ss[3].number, '4');
  assert.equal(ss[1].name, 'طالب 2', 'الاسم الأصلي يبقى عند الربط');
  // إضافة طلاب لاحقاً + تخطي من هو موجود
  const add = await w.call('POST', `/api/admin/groups/${basic.id}/students`, { cookie: a, body: { students: [{ number: '1', name: 'x' }, { number: '77', name: 'جديد' }] } });
  assert.deepEqual([add.data.added, add.data.skipped], [1, 1]);
  assert.equal((await w.call('POST', `/api/admin/groups/${basic.id}/students`, { cookie: a, body: { students: [{ number: '1', name: 'x' }] } })).status, 409);
  // إزالة طالب من الصف الأساسي يبقيه في المادة المتنقلة
  const s2 = ss.find((s) => s.number === '2');
  assert.equal((await w.call('DELETE', `/api/admin/groups/${basic.id}/students/${s2.id}`, { cookie: a })).status, 200);
  assert.equal((await w.idsOf(mobile.id, a)).length, 3);
  // حذف الصف يزيل الطلاب الذين لا ينتمون لغيره فقط
  assert.equal((await w.call('DELETE', `/api/admin/groups/${basic.id}`, { cookie: a })).status, 200);
  assert.equal((await w.idsOf(mobile.id, a)).length, 3);
  assert.equal(w.DB.raw.prepare('SELECT COUNT(*) c FROM students').get().c, 3);
  assert.equal((await w.call('DELETE', `/api/admin/groups/${basic.id}`, { cookie: a })).status, 404);
  assert.equal((await w.call('POST', '/api/admin/groups', { cookie: a, body: { name: 'bad', kind: 'other', students: w.students(1) } })).status, 400);
  assert.equal((await w.call('POST', '/api/admin/groups', { cookie: a, body: { name: 'bad', kind: 'basic', students: [] } })).status, 400);
});

// ===================================================================== الرصد والتقارير
async function school() {
  const w = world();
  const a = await w.admin();
  const [t1, t2] = await w.teachers(a, ['المعلم الأول', 'المعلم الثاني']);
  const basic = await w.group(a, '10-1', 'basic', w.students(5));
  const mobile = await w.group(a, 'علوم', 'mobile', [{ number: '2', name: 'x' }, { number: '3', name: 'x' }]);
  const ids = Object.fromEntries((await w.idsOf(basic.id, a)).map((s) => [s.number, s.id]));
  return { w, a, t1, t2, basic, mobile, ids };
}

test('الرصد: حفظ، قراءة، قفل الحصة 409، وقواعد التاريخ', async () => {
  const { w, t1, t2, basic, ids } = await school();
  const rec = (over = {}) => ({ date: DAY.tue, period: 1, group_id: basic.id, entries: [{ student_id: ids['1'], status: 'absent', note: 'مريض' }, { student_id: ids['2'], status: 'late', note: '' }], ...over });
  const ok = await w.call('POST', '/api/record', { cookie: t1.cookie, body: rec() });
  assert.deepEqual([ok.status, ok.data.absent, ok.data.late], [201, 1, 1]);
  const got = (await w.call('GET', `/api/record?date=${DAY.tue}&period=1&group_id=${basic.id}`, { cookie: t2.cookie })).data.record;
  assert.equal(got.teacher_name, 'المعلم الأول');
  assert.equal(got.entries.length, 5);
  assert.equal(got.entries.find((e) => e.student_id === ids['1']).note, 'مريض');
  assert.equal(got.entries.filter((e) => e.status === 'present').length, 3);
  const dup = await w.call('POST', '/api/record', { cookie: t2.cookie, body: rec() });
  assert.equal(dup.status, 409);
  assert.match(dup.data.message, /المعلم الأول/);
  assert.equal(w.DB.raw.prepare('SELECT COUNT(*) c FROM records').get().c, 1, 'لا سجل نصف مكتمل');
  assert.equal((await w.call('GET', `/api/record?date=${DAY.tue}&period=2&group_id=${basic.id}`, { cookie: t2.cookie })).data.record, null);
  // قواعد التاريخ والمدخلات
  const bads = [
    rec({ period: 2, date: '2026-10-07' }), rec({ period: 2, date: DAY.sat }), rec({ period: 2, date: DAY.fri }),
    rec({ period: 2, date: '2026-09-01' }), rec({ period: 2, date: '2026-02-30' }), rec({ period: 9 }), rec({ period: 0 }), rec({ period: 2, group_id: 9999 }),
    rec({ period: 2, entries: [{ student_id: 99999, status: 'absent' }] }), rec({ period: 2, entries: [{ student_id: ids['1'], status: 'sleeping' }] }),
    rec({ period: 2, entries: 'x' }), rec({ period: 2, entries: [{ student_id: ids['1'], status: 'absent', note: 'x'.repeat(300) }] }),
  ];
  for (const b of bads) assert.equal((await w.call('POST', '/api/record', { cookie: t1.cookie, body: b })).status, b.group_id === 9999 ? 404 : 400, JSON.stringify(b).slice(0, 80));
  assert.equal((await w.call('POST', '/api/record', { cookie: t1.cookie, body: rec({ period: 2, date: DAY.mon }) })).status, 201);
  assert.equal((await w.call('POST', '/api/record', { cookie: t1.cookie, body: rec({ period: 3, date: '2026-09-23' }) })).status, 201, 'قبل 13 يوماً مسموح');
});

test('التقرير اليومي يضم غياب المواد المتنقلة ويربط الطالب بصفه', async () => {
  const { w, t1, t2, basic, mobile, ids } = await school();
  await w.call('POST', '/api/record', { cookie: t1.cookie, body: { date: DAY.tue, period: 1, group_id: basic.id, entries: [{ student_id: ids['2'], status: 'absent', note: 'مريض' }, { student_id: ids['5'], status: 'late', note: '' }] } });
  await w.call('POST', '/api/record', { cookie: t2.cookie, body: { date: DAY.tue, period: 4, group_id: mobile.id, entries: [{ student_id: ids['2'], status: 'absent', note: '' }, { student_id: ids['3'], status: 'absent', note: '' }] } });
  const r = (await w.call('GET', `/api/reports/daily?date=${DAY.tue}&group_id=${basic.id}`, { cookie: t1.cookie })).data;
  assert.deepEqual(r.students.map((s) => s.number), ['2', '3', '5']);
  const s2 = r.students[0];
  assert.deepEqual(s2.items.map((i) => [i.period, i.group_name, i.teacher_name]), [[1, '10-1', 'المعلم الأول'], [4, 'علوم', 'المعلم الثاني']]);
  assert.equal(r.students[2].items[0].status, 'late');
  assert.deepEqual((await w.call('GET', `/api/reports/daily?date=${DAY.mon}&group_id=${basic.id}`, { cookie: t1.cookie })).data.students, []);
});

test('إحصائيات المعلمين الأسبوعية: العدد والنسبة، ومن لم يرصد بصفر', async () => {
  const { w, a, t1, t2, basic, ids } = await school();
  const base = { group_id: basic.id, entries: [] };
  await w.call('POST', '/api/record', { cookie: t1.cookie, body: { ...base, date: DAY.tue, period: 1 } });
  await w.call('POST', '/api/record', { cookie: t1.cookie, body: { ...base, date: DAY.tue, period: 2 } });
  await w.call('POST', '/api/record', { cookie: t1.cookie, body: { ...base, date: DAY.mon, period: 1 } });
  await w.call('POST', '/api/record', { cookie: t2.cookie, body: { ...base, date: DAY.sun, period: 1 } });
  await w.call('POST', '/api/record', { cookie: t2.cookie, body: { ...base, date: '2026-09-29', period: 1 } }); // الأسبوع السابق
  const r = (await w.call('GET', `/api/reports/weekly?date=${DAY.tue}`, { cookie: t2.cookie })).data;
  assert.deepEqual([r.from, r.to, r.total], ['2026-10-04', '2026-10-10', 4]);
  assert.deepEqual(r.teachers.map((t) => [t.name, t.sessions, t.percent]), [['المعلم الأول', 3, 75], ['المعلم الثاني', 1, 25]]);
  const [t3] = await w.teachers(a, ['معلم بلا رصد']);
  const r2 = (await w.call('GET', '/api/reports/weekly', { cookie: t3.cookie })).data;
  assert.deepEqual(r2.teachers.at(-1), { name: 'معلم بلا رصد', sessions: 0, percent: 0 });
  void ids;
});

test('التقرير الشهري: أيام غياب مميّزة، المواد المتنقلة، لائحة الإجراءات، الحذف', async () => {
  const { w, a, t1, t2, basic, mobile, ids } = await school();
  const put = await w.call('PUT', '/api/admin/rules', { cookie: a, body: { rules: [{ min_days: 2, label: 'تنبيه', color: '#0284c7' }, { min_days: 3, label: 'إنذار', color: '#C2410C' }] } });
  assert.equal(put.status, 200);
  const rec = (c, date, period, gid, entries) => w.call('POST', '/api/record', { cookie: c, body: { date, period, group_id: gid, entries } });
  const abs = (n) => ({ student_id: ids[n], status: 'absent', note: '' });
  await rec(t1.cookie, DAY.sun, 1, basic.id, [abs('1'), abs('2')]);
  await rec(t1.cookie, DAY.sun, 2, basic.id, [abs('1')]);                  // نفس اليوم: يُحسب مرة واحدة
  await rec(t1.cookie, DAY.mon, 1, basic.id, [abs('1'), { student_id: ids['3'], status: 'late', note: '' }]);
  await rec(t2.cookie, DAY.mon, 5, mobile.id, [abs('2')]);                 // غياب في مادة متنقلة يُحسب للصف الأساسي
  await rec(t1.cookie, DAY.tue, 1, basic.id, [abs('1')]);
  const m = (await w.call('GET', `/api/admin/reports/monthly?month=2026-10&group_id=${basic.id}`, { cookie: a })).data;
  assert.equal(m.min_days, 2);
  assert.deepEqual(m.students.map((s) => [s.number, s.absence_days, s.action?.label]), [['1', 3, 'إنذار'], ['2', 2, 'تنبيه']]);
  assert.equal(m.students[0].action.color, '#c2410c');
  assert.deepEqual(m.students[0].absences.map((d) => [d.date, d.items.length]), [[DAY.sun, 2], [DAY.mon, 1], [DAY.tue, 1]]);
  assert.equal(m.totals.absence_days, 5);
  assert.equal(m.totals.late_days, 1);
  assert.equal((await w.call('GET', `/api/admin/reports/monthly?month=2026-09&group_id=${basic.id}`, { cookie: a })).data.students.length, 0);
  // حذف غياب يوم واحد
  const clr = await w.call('POST', '/api/admin/entries/clear', { cookie: a, body: { student_id: ids['1'], date: DAY.sun, kind: 'absent' } });
  assert.deepEqual([clr.status, clr.data.cleared], [200, 2]);
  assert.equal((await w.call('POST', '/api/admin/entries/clear', { cookie: a, body: { student_id: ids['1'], date: DAY.sun } })).status, 404);
  const m2 = (await w.call('GET', `/api/admin/reports/monthly?month=2026-10&group_id=${basic.id}`, { cookie: a })).data;
  assert.deepEqual(m2.students.map((s) => [s.number, s.absence_days, s.action?.label]), [['1', 2, 'تنبيه'], ['2', 2, 'تنبيه']]);
  const note = w.DB.raw.prepare("SELECT note FROM entries WHERE student_id = ? AND status = 'present' AND note <> ''").get(ids['1']).note;
  assert.equal(note, CONFIG.CLEARED_NOTE);
  assert.equal((await w.call('GET', `/api/admin/reports/monthly?month=2026-13&group_id=${basic.id}`, { cookie: a })).status, 400);
  assert.equal((await w.call('PUT', '/api/admin/rules', { cookie: a, body: { rules: [{ min_days: 2, label: 'a', color: '#fff' }] } })).status, 400);
  assert.equal((await w.call('PUT', '/api/admin/rules', { cookie: a, body: { rules: [{ min_days: 2, label: 'a', color: '#000000' }, { min_days: 2, label: 'b', color: '#000000' }] } })).status, 400);
});

test('الإدارة تحذف سجل حصة فيستطيع المعلم رصدها من جديد', async () => {
  const { w, a, t1, t2, basic } = await school();
  const body = { date: DAY.tue, period: 1, group_id: basic.id, entries: [] };
  await w.call('POST', '/api/record', { cookie: t1.cookie, body });
  const list = (await w.call('GET', `/api/admin/records?date=${DAY.tue}`, { cookie: a })).data.records;
  assert.equal(list.length, 1);
  assert.equal(list[0].total, 5);
  assert.equal((await w.call('DELETE', `/api/admin/records/${list[0].id}`, { cookie: t1.cookie })).status, 403);
  assert.equal((await w.call('DELETE', `/api/admin/records/${list[0].id}`, { cookie: a })).status, 200);
  assert.equal((await w.call('POST', '/api/record', { cookie: t2.cookie, body })).status, 201);
  assert.equal(w.DB.raw.prepare('SELECT COUNT(*) c FROM entries').get().c, 5, 'سجلات الطلاب القديمة حُذفت مع السجل');
  const audit = (await w.call('GET', '/api/admin/audit', { cookie: a })).data.entries;
  assert.ok(audit.some((e) => e.action === 'record.delete'));
});

test('الإعدادات: الإدارة تعدّل اسم المدرسة ويظهر في الواجهة العامة', async () => {
  const w = world();
  const a = await w.admin();
  assert.equal((await w.call('PUT', '/api/admin/settings', { cookie: a, body: { school_name: 'مدرسة جديدة', principal_name: 'المدير', developer_credit: 'مطور' } })).status, 200);
  assert.equal((await w.call('GET', '/api/public')).data.school_name, 'مدرسة جديدة');
  assert.equal((await w.call('PUT', '/api/admin/settings', { cookie: a, body: { school_name: '' } })).status, 400);
});

// ===================================================================== حقن SQL ومدخلات خبيثة
const PAYLOADS = ["' OR '1'='1", "'; DROP TABLE students; --", '" OR ""="', "1; DELETE FROM records", "x') UNION SELECT uid, role, email, 1 FROM auth_sessions --", '${7*7}', '<img src=x onerror=alert(1)>'];

test('حقن SQL: الحمولات تُخزَّن كنص حرفي ولا تنفَّذ، والجداول سليمة', async () => {
  const { w, a, t1, basic, ids } = await school();
  for (const p of PAYLOADS) {
    const g = await w.call('POST', '/api/admin/groups', { cookie: a, body: { name: p.slice(0, 80), kind: 'mobile', students: [{ number: `n${PAYLOADS.indexOf(p)}`, name: p }] } });
    assert.equal(g.status, 201, p);
    const rec = await w.call('POST', '/api/record', { cookie: t1.cookie, body: { date: DAY.mon, period: 1 + PAYLOADS.indexOf(p), group_id: g.data.id, entries: [{ student_id: (await w.idsOf(g.data.id, a))[0].id, status: 'absent', note: p.slice(0, 200) }] } });
    assert.equal(rec.status, 201, p);
    const back = (await w.call('GET', `/api/reports/daily?date=${DAY.mon}&group_id=${g.data.id}`, { cookie: a })).data;
    assert.equal(back.students.length, 1);
    assert.equal(back.students[0].name, p);
    assert.equal(back.students[0].items[0].note, p.slice(0, 200));
  }
  const names = w.DB.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  for (const t of ['students', 'records', 'entries', 'groups', 'teachers', 'auth_sessions', 'settings']) assert.ok(names.includes(t), t);
  assert.equal(w.DB.raw.prepare('SELECT COUNT(*) c FROM students').get().c, 5 + PAYLOADS.length);
  void basic; void ids;
});

test('حقن SQL عبر الدخول والمعاملات: كلها ترفض أو تفشل بأمان', async () => {
  const { w, a, t1, basic } = await school();
  for (const p of PAYLOADS) {
    const r = await w.call('POST', '/api/login', { body: { gate: 'teacher', username: p, password: p } });
    assert.ok([400, 401, 429].includes(r.status), `${p} -> ${r.status}`);
    const r2 = await w.call('POST', '/api/login', { body: { gate: 'admin', username: 'boss@school.example', password: p } });
    assert.ok([401, 429].includes(r2.status), `admin ${r2.status}`); // 429 = الحد من التخمين بعد 5 محاولات
  }
  const bad = [
    `/api/groups/${encodeURIComponent('1 OR 1=1')}/students`, `/api/groups/${encodeURIComponent("1; DROP TABLE groups")}/students`,
    `/api/record?date=${encodeURIComponent("2026-10-06' OR '1'='1")}&period=1&group_id=${basic.id}`,
    `/api/record?date=${DAY.tue}&period=${encodeURIComponent('1 OR 1=1')}&group_id=${basic.id}`,
    `/api/record?date=${DAY.tue}&period=1&group_id=${encodeURIComponent('1 UNION SELECT 1')}`,
    `/api/reports/daily?date=${DAY.tue}&group_id=${encodeURIComponent('1 OR 1=1')}`,
    `/api/reports/weekly?date=${encodeURIComponent("2026-10-06'--")}`,
  ];
  for (const path of bad) assert.equal((await w.call('GET', path, { cookie: t1.cookie })).status, 400, path);
  assert.equal((await w.call('GET', `/api/admin/reports/monthly?month=${encodeURIComponent("2026-10' OR 1=1")}&group_id=${basic.id}`, { cookie: a })).status, 400);
  assert.equal((await w.call('DELETE', `/api/admin/teachers/${encodeURIComponent("x' OR '1'='1")}`, { cookie: a })).status, 400);
  assert.equal((await w.call('POST', '/api/admin/groups', { cookie: a, body: { name: 'ok', kind: 'basic', students: [{ number: "1' OR '1'='1", name: 'x' }] } })).status, 400);
  assert.equal((await w.call('POST', '/api/admin/groups', { cookie: a, body: { name: 'ok', kind: "basic' OR '1", students: w.students(1) } })).status, 400);
  assert.equal(w.DB.raw.prepare('SELECT COUNT(*) c FROM teachers').get().c, 2);
});

test('فحص ثابت: لا يُبنى أي استعلام SQL بدمج النصوص', () => {
  const templates = WORKER_SRC.match(/`[^`]*`/gs) ?? [];
  const sqlish = /\b(SELECT|INSERT\s+(OR\s+IGNORE\s+)?INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE)\b/;
  for (const t of templates) if (sqlish.test(t)) assert.ok(!t.includes('${'), `SQL يحتوي على دمج: ${t.slice(0, 60)}`);
  assert.ok(!/\.exec\(\s*[^)]*\+/.test(WORKER_SRC));
  assert.ok(!/prepare\(\s*[^'"`)\s]/.test(WORKER_SRC.replace(/db\.prepare\(sql\)/g, '')), 'prepare يجب أن يستقبل نصاً ثابتاً أو المتغير sql من المساعدات فقط');
  // المساعدات الثلاث هي الباب الوحيد: كل استدعاء لها يبدأ بنص حرفي أو ثابت معرّف مسبقاً
  const calls = [...WORKER_SRC.matchAll(/\b(?:all|one|run|st)\(\s*db,\s*([^,)]+)/g)].map((m) => m[1].trim());
  for (const c of calls) assert.ok(/^(['"`]|ORPHANS$|sql$)/.test(c), `وسيط SQL غير ثابت: ${c}`);
});

// ===================================================================== Firebase الحقيقي (بطلبات وهمية) والوضع الوهمي
test('عميل Firebase الحقيقي: عناوين الطلبات، توقيع JWT، وإخفاء الأسرار', async () => {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  const env = { FIREBASE_API_KEY: 'KEY123', FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'proj-1', client_email: 'sa@proj-1.iam.gserviceaccount.com', private_key: pem }) };
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'AT', expires_in: 3600 }));
    if (String(url).includes('accounts:signInWithPassword')) {
      return JSON.parse(init.body).password === 'good' ? new Response(JSON.stringify({ localId: 'U1', email: 'a@b.c' })) : new Response(JSON.stringify({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }), { status: 400 });
    }
    return new Response(JSON.stringify({ localId: 'NEW1' }));
  };
  try {
    const fb = realFirebase(env);
    assert.deepEqual(await fb.signIn('a@b.c', 'good'), { uid: 'U1', email: 'a@b.c' });
    await assert.rejects(fb.signIn('a@b.c', 'bad'), (e) => e.code === 'INVALID_LOGIN_CREDENTIALS');
    assert.equal((await fb.createUser('t01@x.y', 'pw123456', 'اسم')).uid, 'NEW1');
    await fb.setPassword('U1', 'pw2'); await fb.deleteUser('U1');
    assert.match(calls[0].url, /identitytoolkit\.googleapis\.com\/v1\/accounts:signInWithPassword\?key=KEY123$/);
    const tokenCall = calls.find((c) => c.url.startsWith('https://oauth2.googleapis.com'));
    const jwt = new URLSearchParams(String(tokenCall.init.body)).get('assertion').split('.');
    const claims = JSON.parse(Buffer.from(jwt[1], 'base64url'));
    assert.deepEqual([claims.iss, claims.aud], ['sa@proj-1.iam.gserviceaccount.com', 'https://oauth2.googleapis.com/token']);
    assert.ok(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', kp.publicKey, Buffer.from(jwt[2], 'base64url'), new TextEncoder().encode(`${jwt[0]}.${jwt[1]}`)));
    const adminCalls = calls.filter((c) => c.url.includes('/projects/proj-1/'));
    assert.deepEqual(adminCalls.map((c) => c.url.split('/v1/')[1]), ['projects/proj-1/accounts', 'projects/proj-1/accounts:update', 'projects/proj-1/accounts:delete']);
    assert.ok(adminCalls.every((c) => c.init.headers.Authorization === 'Bearer AT'));
    assert.equal(calls.filter((c) => c.url.startsWith('https://oauth2')).length, 1, 'الرمز يُخزَّن مؤقتاً');
  } finally { globalThis.fetch = real; }
});

test('الوضع الوهمي لا يعمل خارج localhost حتى لو فُعّل بالخطأ', async () => {
  const DB = makeD1();
  const env = { DB, ASSETS: { fetch: async () => new Response('x') }, DEV_FAKE_AUTH: '1', DEV_ADMIN_PASSWORD: 'Boss-Pass-123', ADMIN_UIDS: 'dev-admin' };
  const app = createApp(); // بلا حقن: يختار العميل بنفسه
  const real = globalThis.fetch; globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }), { status: 400 });
  try {
    const req = (origin) => new Request(`${origin}/api/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ gate: 'admin', username: 'admin@school.example', password: 'Boss-Pass-123' }) });
    assert.equal((await app.fetch(req('https://school.example.com'), env)).status, 401, 'على نطاق حقيقي: Firebase الحقيقي فقط');
    assert.equal((await app.fetch(req('http://localhost:8787'), env)).status, 200, 'على localhost: الوضع الوهمي');
  } finally { globalThis.fetch = real; }
});

// ===================================================================== فحص الواجهة (ثابت)
test('الواجهة: لا innerHTML ولا eval ولا أكواد أو أنماط مضمّنة ولا موارد خارجية', () => {
  const rd = (f) => readFileSync(new URL(`../site/${f}`, import.meta.url), 'utf8');
  const js = rd('app.js'); const html = rd('index.html'); const css = rd('style.css');
  for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', "setAttribute('style'", 'localStorage.setItem(\'sid']) {
    assert.ok(!js.includes(bad), `app.js يحتوي ${bad}`);
  }
  assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), 'سكربت مضمّن في index.html');
  assert.ok(!/\son\w+\s*=/i.test(html) && !/\sstyle\s*=/i.test(html), 'أحداث/أنماط مضمّنة في index.html');
  assert.ok(!/<style/i.test(html));
  assert.ok(!/https?:\/\//.test(css), 'موارد خارجية في CSS');
  assert.ok(!/https?:\/\//.test(html.replace(/xmlns="[^"]*"/g, '')));
  // الاتصال الخارجي الوحيد المسموح به في الواجهة: Turnstile
  const urls = [...js.matchAll(/https?:\/\/[^\s'")]+/g)].map((m) => m[0]).filter((u) => !u.includes('w3.org'));
  for (const u of urls) assert.ok(u.startsWith('https://challenges.cloudflare.com/'), `رابط خارجي غير متوقع ${u}`);
});

// ===================================================================== دخول المعلم بالاسم
test('المعلم يدخل باسمه (كاملاً أو جزءاً، بأي كتابة للهمزات) أو باسم المستخدم', async () => {
  const w = world();
  const a = await w.admin();
  const made = (await w.call('POST', '/api/admin/teachers', { cookie: a, body: { names: ['الاستاذ احمد اسلامية', 'بسام الشنوفي', 'الأستاذ سامي علي بلهادي عمري', 'احمد البلوشي', 'ناصر أحمد'] } })).data.created;
  const pw = Object.fromEntries(made.map((t) => [t.name, t.password]));
  const ok = async (typed, name) => { const r = await w.login('teacher', typed, pw[name]); assert.equal(r.r.status, 200, `${typed} -> ${r.r.text}`); assert.equal(r.r.data.name, name); };
  await ok('الاستاذ احمد اسلامية', 'الاستاذ احمد اسلامية');
  await ok('احمد اسلامية', 'الاستاذ احمد اسلامية');            // بدون اللقب
  await ok('أحمد إسلامية', 'الاستاذ احمد اسلامية');            // همزات مختلفة
  await ok('  بسام   الشنوفي ', 'بسام الشنوفي');
  await ok('سامي بلهادي', 'الأستاذ سامي علي بلهادي عمري');      // جزء من الاسم
  await ok('الأستاذة ناصر', 'ناصر أحمد');                       // لقب مختلف
  await ok(made[1].username.toUpperCase(), 'بسام الشنوفي');      // اسم المستخدم بأي حالة أحرف
  // اسم مشترك بين أكثر من معلم → رسالة واضحة، وكلمة مرور خاطئة → رفض عام
  const amb = await w.login('teacher', 'احمد', pw['ناصر أحمد']);
  assert.equal(amb.r.status, 401); assert.match(amb.r.data.message, /أكثر من معلم/);
  assert.equal((await w.login('teacher', 'بسام الشنوفي', 'خطأ')).r.status, 401);
  assert.equal((await w.login('teacher', 'معلم غير موجود', 'x')).r.status, 401);
  assert.equal((await w.login('teacher', 'الاستاذ', 'x')).r.status, 401);
  // الإدارة لا تقبل الاسم العربي، والمعلم لا يدخل بوابة الإدارة بأي صيغة
  assert.equal((await w.login('admin', 'بسام الشنوفي', pw['بسام الشنوفي'])).r.status, 401);
  assert.equal((await w.login('admin', made[1].username, pw['بسام الشنوفي'])).r.status, 403);
  // الحد من التخمين يعمل على الاسم المكتوب أيضاً
  for (let i = 0; i < CONFIG.LOGIN_MAX_PER_USER; i += 1) await w.login('teacher', 'ناصر', `bad${i}`);
  assert.equal((await w.login('teacher', 'ناصر', pw['ناصر أحمد'])).r.status, 429);
});

test('الإدارة تدخل باسم مستخدم بسيط (admin) دون كتابة بريد', async () => {
  const w = world({ DEV_ADMIN_EMAIL: 'admin@school.example' });
  const r = await w.login('admin', 'admin', 'Boss-Pass-123');
  assert.equal(r.r.status, 200, r.r.text);
  assert.equal((await w.login('admin', 'ADMIN', 'wrong')).r.status, 401);
});

// ===================================================================== حسابات بأسماء عربية وإنجليزية وتخزين Firebase
test('إنشاء حسابات بأسماء عربية وإنجليزية وحفظها في Google Firebase (Auth + Firestore)', async () => {
  const w = world();
  const a = await w.admin();

  // 1. إنشاء حساب باسم عربي واسم مستخدم عربي
  const arRes = await w.call('POST', '/api/admin/accounts', {
    cookie: a,
    body: {
      name: 'أحمد بن سعيد الحارثي',
      username: 'أحمد_الحارثي',
      role: 'teacher',
      password: 'SafePassword123',
      must_change: false,
    },
  });
  assert.equal(arRes.status, 201, arRes.text);
  assert.equal(arRes.data.account.name, 'أحمد بن سعيد الحارثي');
  assert.equal(arRes.data.account.username, 'أحمد_الحارثي');
  assert.equal(arRes.data.account.role, 'teacher');
  assert.equal(arRes.data.account.firebase_stored, true);

  // 2. إنشاء حساب باسم إنجليزي واسم مستخدم إنجليزي
  const enRes = await w.call('POST', '/api/admin/accounts', {
    cookie: a,
    body: {
      name: 'John Michael Doe',
      username: 'john_doe',
      role: 'teacher',
      password: 'EnglishPass123',
      must_change: true,
    },
  });
  assert.equal(enRes.status, 201, enRes.text);
  assert.equal(enRes.data.account.name, 'John Michael Doe');
  assert.equal(enRes.data.account.username, 'john_doe');

  // 3. التحقق من التخزين في Google Firebase (Auth + Firestore)
  const devUsers = w.DB.raw.prepare('SELECT uid, email, name FROM dev_users').all();
  assert.ok(devUsers.some((u) => u.uid === arRes.data.account.uid && u.name === 'أحمد بن سعيد الحارثي'));
  assert.ok(devUsers.some((u) => u.uid === enRes.data.account.uid && u.name === 'John Michael Doe'));

  const firestoreDocs = w.DB.raw.prepare("SELECT collection, doc_id, data FROM dev_firestore WHERE collection = 'users'").all();
  assert.ok(firestoreDocs.some((d) => d.doc_id === arRes.data.account.uid && d.data.includes('أحمد بن سعيد الحارثي')));
  assert.ok(firestoreDocs.some((d) => d.doc_id === enRes.data.account.uid && d.data.includes('John Michael Doe')));

  // 4. تسجيل الدخول بالاسم أو اسم المستخدم (العربي والإنجليزي)
  const arLoginByUsername = await w.login('teacher', 'أحمد_الحارثي', 'SafePassword123');
  assert.equal(arLoginByUsername.r.status, 200);
  assert.equal(arLoginByUsername.r.data.name, 'أحمد بن سعيد الحارثي');

  const enLoginByUsername = await w.login('teacher', 'john_doe', 'EnglishPass123');
  assert.equal(enLoginByUsername.r.status, 200);
  assert.equal(enLoginByUsername.r.data.name, 'John Michael Doe');
  assert.equal(enLoginByUsername.r.data.must_change, true);

  // 5. إنشاء حساب إداري جديد والتحقق من دخوله لوحة الإدارة
  const adminRes = await w.call('POST', '/api/admin/accounts', {
    cookie: a,
    body: {
      name: 'سالم بن عبد الله (مساعد مدير)',
      username: 'salem_admin',
      role: 'admin',
      password: 'AdminPassword999',
      must_change: false,
    },
  });
  assert.equal(adminRes.status, 201);
  const adminLogin = await w.login('admin', 'salem_admin', 'AdminPassword999');
  assert.equal(adminLogin.r.status, 200);
  assert.equal(adminLogin.r.data.role, 'admin');

  // 6. التحقق من مسار مزامنة Firebase
  const syncRes = await w.call('POST', '/api/admin/firebase/sync', { cookie: a, body: {} });
  assert.equal(syncRes.status, 200);
  assert.ok(syncRes.data.synced.users >= 3);

  // 7. التحقق من حالة Firebase
  const statusRes = await w.call('GET', '/api/admin/firebase/status', { cookie: a });
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.data.service, 'Google Firebase');
  assert.equal(statusRes.data.firestore_enabled, true);
});

// ===================================================================== تسجيل الدخول بواسطة Google / البريد ودور المشاهد والترقية
test('التسجيل الذاتي بواسطة Google أو البريد يعطي دور المشاهد (viewer) فقط ويمكن للإدارة ترقيته لمعلم', async () => {
  const w = world();
  const a = await w.admin();

  // 1. تسجيل مستخدم جديد بواسطة Google / البريد الإلكتروني
  const gRes = await w.call('POST', '/api/auth/google', {
    body: { email: 'visitor@school.example', name: 'زائر تجريبي' },
  });
  assert.equal(gRes.status, 200);
  assert.equal(gRes.data.role, 'viewer');
  assert.equal(gRes.data.name, 'زائر تجريبي');
  const viewerCookie = (gRes.headers.get('Set-Cookie') ?? '').split(';')[0];

  // 2. المشاهد يمكنه استعراض التقارير
  const dailyRes = await w.call('GET', '/api/reports/daily?date=2026-10-04&group_id=1', { cookie: viewerCookie });
  assert.equal(dailyRes.status, 200);

  const weeklyRes = await w.call('GET', '/api/reports/weekly?date=2026-10-04', { cookie: viewerCookie });
  assert.equal(weeklyRes.status, 200);

  // 3. المشاهد لا يستطيع رصد الحصص (403) ولا دخول لوحة الإدارة (403)
  const saveAttempt = await w.call('POST', '/api/record', {
    cookie: viewerCookie,
    body: { date: '2026-10-04', period: 1, group_id: 1, entries: [] },
  });
  assert.equal(saveAttempt.status, 403);

  const adminAttempt = await w.call('GET', '/api/admin/teachers', { cookie: viewerCookie });
  assert.equal(adminAttempt.status, 403);

  // 4. الإدارة تستعرض الحسابات وترى المشاهد
  const listRes = await w.call('GET', '/api/admin/teachers', { cookie: a });
  assert.equal(listRes.status, 200);
  const target = listRes.data.teachers.find((t) => t.email === 'visitor@school.example');
  assert.ok(target, 'المشاهد يظهر في قائمة الحسابات للإدارة');
  assert.equal(target.role, 'viewer');

  // 5. الإدارة ترقي المشاهد إلى معلم
  const promoteRes = await w.call('PUT', `/api/admin/teachers/${target.uid}/role`, {
    cookie: a,
    body: { role: 'teacher' },
  });
  assert.equal(promoteRes.status, 200);
  assert.equal(promoteRes.data.role, 'teacher');

  // 6. الحساب بعد ترقيته أصبح معلماً
  const meRes = await w.call('GET', '/api/me', { cookie: viewerCookie });
  assert.equal(meRes.data.role, 'teacher');
});

test('مسارات Google OAuth الرسمية: التوجيه لـ accounts.google.com أو عرض دليل التهيئة والدخول السريع', async () => {
  // 1. قبل ضبط Client ID: يعرض صفحة الدليل الإرشادي 200
  const wNoId = world();
  const guideRes = await wNoId.call('GET', '/api/auth/google/login');
  assert.equal(guideRes.status, 200);
  assert.ok(guideRes.text.includes('Google'));
  assert.ok(guideRes.text.includes('OAuth'));

  // 2. بعد ضبط Client ID: يوجه المتصفح بـ 302 إلى accounts.google.com مع المعلمات الصحيحة
  const wWithId = world({
    GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-secret',
  });
  const oauthRes = await wWithId.call('GET', '/api/auth/google/login');
  assert.equal(oauthRes.status, 302);
  const location = oauthRes.headers.get('Location') || '';
  assert.ok(location.startsWith('https://accounts.google.com/o/oauth2/v2/auth'));
  assert.ok(location.includes('client_id=test-client-id.apps.googleusercontent.com'));
  assert.ok(location.includes('redirect_uri='));
  assert.ok(location.includes('scope=openid'));

  // 3. الدخول السريع في بيئة التطوير (عند تفعيل DEV_FAKE_AUTH)
  const wDev = world({ DEV_FAKE_AUTH: '1' });
  const devRes = await wDev.call('GET', '/api/auth/google/dev-quick-login?email=real.dev@school.example&name=معلم+تجريبي');
  assert.equal(devRes.status, 302);
  const devCookie = (devRes.headers.get('Set-Cookie') ?? '').split(';')[0];
  assert.ok(devCookie.includes('sid='));
  const me = await wDev.call('GET', '/api/me', { cookie: devCookie });
  assert.equal(me.status, 200);
  assert.equal(me.data.email, 'real.dev@school.example');
  assert.equal(me.data.role, 'viewer');
});
