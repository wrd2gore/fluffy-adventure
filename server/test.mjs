// =====================================================================================
//  اختبارات الخادم الشاملة — منصة رصد الغياب المدرسي
//  تتحقق من نظام البوابتين بكلمات المرور فقط (بدون أسماء مستخدمين)،
//  تشفير PBKDF2، حماية هجمات التخمين، تحكم الإدارة بكلمة المعلمين،
//  دليل المعلمين، رصد الحضور، التقارير، والأمان الصارم (SQL Injection, CSP, CSRF).
// =====================================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  createApp,
  fakeFirebase,
  realFirebase,
  ROUTES,
  sha256,
  CONFIG,
  pbkdf2Hash,
  constantTimeEqual,
  verifyPassword,
} from './worker.js';

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const WORKER_SRC = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
const ORIGIN = 'https://school.test';
const NOW = new Date('2026-10-06T08:00:00Z'); // الثلاثاء 2026-10-06
const DAY = { tue: '2026-10-06', mon: '2026-10-05', sun: '2026-10-04', sat: '2026-10-03', fri: '2026-10-02' };

// بديل D1 فوق node:sqlite
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
    DB,
    ASSETS: { fetch: async () => new Response('<!doctype html><title>x</title>', { headers: { 'Content-Type': 'text/html' } }) },
    DEV_ADMIN_PASSWORD: 'Boss-Pass-123',
    ...extraEnv,
  };
  const app = createApp({ now: () => clock.t });

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

  // الدخول بكلمة المرور فقط دون أي اسم مستخدم
  async function login(gate, password, extra = {}) {
    const r = await call('POST', '/api/login', { body: { gate, password, ...extra } });
    return { r, cookie: cookieOf(r) };
  }

  async function admin() {
    const { r, cookie } = await login('admin', 'Boss-Pass-123');
    assert.equal(r.status, 200, r.text);
    return cookie;
  }

  async function teacher() {
    const { r, cookie } = await login('teacher', 'tchr-salem-2026');
    assert.equal(r.status, 200, r.text);
    return cookie;
  }

  const students = (n, from = 1) => Array.from({ length: n }, (_, i) => ({ number: String(from + i), name: `طالب ${from + i}` }));
  async function group(adminCookie, name, kind, list) {
    const r = await call('POST', '/api/admin/groups', { cookie: adminCookie, body: { name, kind, students: list } });
    assert.equal(r.status, 201, r.text);
    return r.data;
  }
  const idsOf = async (gid, c) => (await call('GET', `/api/groups/${gid}/students`, { cookie: c })).data.students;

  return { env, call, login, admin, teacher, group, students, idsOf, cookieOf, DB, clock };
}

// ===================================================================== 1) الأساسيات والأمان العام
test('الواجهة العامة تعرض اسم المدرسة فقط، وبقية المسارات تتطلب دخولاً', async () => {
  const w = world();
  const p = await w.call('GET', '/api/public');
  assert.equal(p.status, 200);
  assert.deepEqual(Object.keys(p.data).sort(), ['developer_credit', 'principal_name', 'school_name', 'turnstile_site_key']);
  for (const path of ['/api/me', '/api/groups', '/api/reports/daily?date=2026-10-06&group_id=1', '/api/admin/teachers', '/api/admin/passwords', '/api/admin/audit']) {
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
  const body = { gate: 'admin', password: 'Boss-Pass-123' };
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
  const { r, cookie } = await w.login('admin', 'Boss-Pass-123');
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

// ===================================================================== 2) نظام الدخول بكلمة المرور فقط
test('الدخول بكلمة المرور فقط: المعلم يدخل بكلمة المعلمين والإدارة بكلمة الإدارة', async () => {
  const w = world();

  // دخول المعلم بكلمة المرور فقط
  const tLog = await w.login('teacher', 'tchr-salem-2026');
  assert.equal(tLog.r.status, 200);
  assert.equal(tLog.r.data.role, 'teacher');
  assert.equal(tLog.r.data.name, 'المعلم');

  // دخول الإدارة بكلمة المرور فقط
  const aLog = await w.login('admin', 'Boss-Pass-123');
  assert.equal(aLog.r.status, 200);
  assert.equal(aLog.r.data.role, 'admin');
  assert.equal(aLog.r.data.name, 'الإدارة');

  // كلمة المعلمين تُرفض في بوابة الإدارة
  assert.equal((await w.login('admin', 'tchr-salem-2026')).r.status, 401);

  // كلمة الإدارة تُرفض في بوابة المعلمين
  assert.equal((await w.login('teacher', 'Boss-Pass-123')).r.status, 401);

  // كلمة مرور خاطئة
  assert.equal((await w.login('teacher', 'wrong-pass')).r.status, 401);
  assert.equal((await w.login('admin', 'wrong-pass')).r.status, 401);

  // بوابة غير صالحة
  assert.equal((await w.login('hacker', '123456')).r.status, 400);
});

test('المعلم يحصل على 403 في كل مسارات الإدارة', async () => {
  const w = world();
  const tCookie = await w.teacher();
  const adminRoutes = ROUTES.filter((r) => r.path.startsWith('/api/admin/'));
  assert.ok(adminRoutes.length >= 8);
  for (const r of adminRoutes) {
    const path = r.path.replace(':id', '1').replace(':sid', '1');
    const opts = { body: r.method === 'GET' ? undefined : {} };
    const res = await w.call(r.method, path, { ...opts, cookie: tCookie });
    assert.equal(res.status, 403, `${r.method} ${r.path} يجب أن تعطي 403 للمعلم`);
  }
});

test('الإدارة لا ترصد الغياب (الرصد للمعلمين فقط)', async () => {
  const w = world();
  const a = await w.admin();
  const g = await w.group(a, 'الصف 1', 'basic', w.students(2));
  const r = await w.call('POST', '/api/record', { cookie: a, body: { date: DAY.tue, period: 1, group_id: g.id, entries: [] } });
  assert.equal(r.status, 403);
});

// ===================================================================== 3) تحكم الإدارة بكلمات المرور
test('تحكم الإدارة بكلمة مرور المعلمين: عرض، تغيير، وتوليد عشوائي مع إبطال الجلسات السابقة', async () => {
  const w = world();
  const a = await w.admin();

  // 1. استرجاع كلمة المرور الحالية للمعلمين
  const curRes = await w.call('GET', '/api/admin/passwords', { cookie: a });
  assert.equal(curRes.status, 200);
  assert.equal(curRes.data.teacher_password, 'tchr-salem-2026');

  // 2. جلسة معلم تعمل بكلمة المرور الحالية
  const tCookie = await w.teacher();
  assert.equal((await w.call('GET', '/api/me', { cookie: tCookie })).status, 200);

  // 3. الإدارة تولّد كلمة مرور عشوائية جديدة للمعلمين
  const genRes = await w.call('PUT', '/api/admin/passwords/teacher', { cookie: a, body: { generate: true } });
  assert.equal(genRes.status, 200);
  assert.ok(genRes.data.teacher_password.startsWith('tchr-'));
  const newPass = genRes.data.teacher_password;

  // 4. إبطال جلسة المعلم السابقة فوراً
  assert.equal((await w.call('GET', '/api/me', { cookie: tCookie })).status, 401, 'يجب إبطال الجلسة القديمة للمعلم');

  // 5. كلمة المرور القديمة لم تعد تعمل
  assert.equal((await w.login('teacher', 'tchr-salem-2026')).r.status, 401);

  // 6. كلمة المرور الجديدة العشوائية تعمل بنجاح
  const tNewLogin = await w.login('teacher', newPass);
  assert.equal(tNewLogin.r.status, 200);

  // 7. الإدارة تضع كلمة مرور مخصصة للمعلمين
  const customRes = await w.call('PUT', '/api/admin/passwords/teacher', { cookie: a, body: { password: 'NewCustomTchrPass!' } });
  assert.equal(customRes.status, 200);
  assert.equal((await w.login('teacher', 'NewCustomTchrPass!')).r.status, 200);
  assert.equal((await w.login('teacher', newPass)).r.status, 401);
});

test('تغيير كلمة مرور الإدارة: التحقق من الحالية والتحديث الآمن', async () => {
  const w = world();
  const a = await w.admin();

  // محاولة بكلمة مرور حالية خاطئة
  const badRes = await w.call('PUT', '/api/admin/passwords/admin', { cookie: a, body: { current: 'Wrong-Pass', next: 'New-Boss-Pass-2026' } });
  assert.equal(badRes.status, 401);

  // تحديث ناجح
  const okRes = await w.call('PUT', '/api/admin/passwords/admin', { cookie: a, body: { current: 'Boss-Pass-123', next: 'New-Boss-Pass-2026' } });
  assert.equal(okRes.status, 200);

  // القديمة لم تعد تعمل
  assert.equal((await w.login('admin', 'Boss-Pass-123')).r.status, 401);

  // الجديدة تعمل
  assert.equal((await w.login('admin', 'New-Boss-Pass-2026')).r.status, 200);
});

// ===================================================================== 4) دليل وقائمة المعلمين
test('قائمة المعلمين: إتاحة القائمة للمعلم، وإدارة الدليل (إضافة وحذف) من الإدارة', async () => {
  const w = world();
  const a = await w.admin();
  const t = await w.teacher();

  // المعلم يستطيع قراءة قائمة المعلمين لاختيار هويته
  const list1 = await w.call('GET', '/api/teachers', { cookie: t });
  assert.equal(list1.status, 200);
  assert.equal(list1.data.teachers.length, 0, 'القاعدة تبدأ بقائمة معلمين نظيفة فارغة');

  // الإدارة تضيف معلماً جديداً
  const addRes = await w.call('POST', '/api/admin/teachers', { cookie: a, body: { name: 'الأستاذ ناصر الشكيلي' } });
  assert.equal(addRes.status, 201);
  assert.deepEqual(addRes.data.created, ['الأستاذ ناصر الشكيلي']);

  // تخطي الاسم المكرر
  const dupRes = await w.call('POST', '/api/admin/teachers', { cookie: a, body: { name: 'الأستاذ ناصر الشكيلي' } });
  assert.equal(dupRes.status, 201);
  assert.deepEqual(dupRes.data.skipped, ['الأستاذ ناصر الشكيلي']);

  // الإدارة تضيف دفعة معلمين
  const bulkRes = await w.call('POST', '/api/admin/teachers', { cookie: a, body: { names: ['معلم تجريبي 1', 'معلم تجريبي 2'] } });
  assert.equal(bulkRes.status, 201);
  assert.equal(bulkRes.data.created.length, 2);

  // الإدارة تحذف معلماً
  const updatedList = (await w.call('GET', '/api/admin/teachers', { cookie: a })).data.teachers;
  const target = updatedList.find((x) => x.name === 'معلم تجريبي 1');
  assert.ok(target);
  const delRes = await w.call('DELETE', `/api/admin/teachers/${target.id}`, { cookie: a });
  assert.equal(delRes.status, 200);

  // المعلم غير مصرح له بالإضافة أو الحذف
  assert.equal((await w.call('POST', '/api/admin/teachers', { cookie: t, body: { name: 'ممنوع' } })).status, 403);
  assert.equal((await w.call('DELETE', `/api/admin/teachers/${target.id}`, { cookie: t })).status, 403);
});

// ===================================================================== 5) حماية التخمين والتشفير
test('الحد من تخمين كلمات المرور (لكل عنوان IP ولكل بوابة)', async () => {
  const w = world();

  // 5 محاولات فاشلة
  for (let i = 0; i < CONFIG.LOGIN_MAX_PER_IP; i++) {
    const r = await w.login('teacher', `wrong-pw-${i}`);
    assert.equal(r.r.status, 401);
  }

  // المحاولة التالية تُحظر بـ 429 حتى لو كانت كلمة المرور صحيحة
  const blocked = await w.login('teacher', 'tchr-salem-2026');
  assert.equal(blocked.r.status, 429);

  // بعد انقضاء نافذة الحظر، يعود الدخول بشكل طبيعي
  w.clock.t = new Date(NOW.getTime() + (CONFIG.LOGIN_WINDOW_MIN * 60 + 5) * 1000);
  const unblocked = await w.login('teacher', 'tchr-salem-2026');
  assert.equal(unblocked.r.status, 200);
});

test('تشفير PBKDF2 والمقارنة في زمن ثابت', async () => {
  const hash1 = await pbkdf2Hash('test-password-123');
  assert.equal(hash1.iterations, 100000);
  assert.equal(hash1.hashHex.length, 64); // 32 bytes in hex
  assert.equal(hash1.saltHex.length, 64);

  // التحقق الصحيح
  assert.equal(await verifyPassword('test-password-123', hash1.hashHex, hash1.saltHex), true);
  // التحقق الخاطئ
  assert.equal(await verifyPassword('wrong-password', hash1.hashHex, hash1.saltHex), false);

  // المقارنة في زمن ثابت
  assert.equal(constantTimeEqual('abcdef', 'abcdef'), true);
  assert.equal(constantTimeEqual('abcdef', 'abcdeg'), false);
  assert.equal(constantTimeEqual('abcdef', 'abc'), false);
});

test('Turnstile: عند تفعيله يُشترط الرمز ويُتحقق منه لدى Cloudflare', async () => {
  const w = world({ TURNSTILE_SECRET: 'sec', TURNSTILE_SITE_KEY: 'site' });
  const body = { gate: 'admin', password: 'Boss-Pass-123' };
  assert.equal((await w.call('GET', '/api/public')).data.turnstile_site_key, 'site');
  assert.equal((await w.call('POST', '/api/login', { body })).status, 400);

  const real = globalThis.fetch; const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push([String(url), String(init.body)]);
    return new Response(JSON.stringify({ success: seen.length > 1 }), { status: 200 });
  };
  try {
    assert.equal((await w.call('POST', '/api/login', { body: { ...body, turnstile: 'tok1' } })).status, 400);
    assert.equal((await w.call('POST', '/api/login', { body: { ...body, turnstile: 'tok2' } })).status, 200);
  } finally { globalThis.fetch = real; }
  assert.match(seen[0][0], /challenges\.cloudflare\.com\/turnstile\/v0\/siteverify/);
  assert.match(seen[0][1], /secret=sec/);
});

// ===================================================================== 6) الصفوف والرصد والتقارير
test('الصفوف: إنشاء وحذف وإضافة طلاب', async () => {
  const w = world();
  const a = await w.admin();
  const basic = await w.group(a, '10-1', 'basic', w.students(3));
  assert.equal(basic.group.name, '10-1');
  assert.equal(basic.student_count, 3);

  const list = (await w.call('GET', '/api/groups', { cookie: a })).data.groups;
  assert.equal(list.length, 1);
  assert.equal(list[0].name, '10-1');

  // إضافة طالب
  const add = await w.call('POST', `/api/admin/groups/${basic.group.id}/students`, { cookie: a, body: { students: [{ number: '99', name: 'طالب إضافي' }] } });
  assert.equal(add.status, 200);

  // تعديل طالب
  const studentsList = (await w.call('GET', `/api/groups/${basic.group.id}/students`, { cookie: a })).data.students;
  const addedStudent = studentsList.find((s) => s.number === '99');
  assert.ok(addedStudent);
  const up = await w.call('PUT', `/api/admin/groups/${basic.group.id}/students/${addedStudent.id}`, { cookie: a, body: { number: '100', name: 'طالب معدل' } });
  assert.equal(up.status, 200);
  assert.equal(up.data.student.number, '100');

  // حذف الصف
  const del = await w.call('DELETE', `/api/admin/groups/${basic.group.id}`, { cookie: a });
  assert.equal(del.status, 200);
  assert.equal((await w.call('GET', '/api/groups', { cookie: a })).data.groups.length, 0);
});

test('رصد الحضور باسم المعلم المختار وقفل الحصة 409', async () => {
  const w = world();
  const a = await w.admin();
  const t = await w.teacher();

  const g = await w.group(a, '10-1', 'basic', w.students(3));
  const sList = await w.idsOf(g.group.id, t);

  // رصد الحصة مع تحديد اسم المعلم المختار
  const saveRes = await w.call('POST', '/api/record', {
    cookie: t,
    body: {
      date: DAY.tue,
      period: 1,
      group_id: g.group.id,
      teacher_name: 'الاستاذ احمد اسلامية',
      entries: [{ student_id: sList[0].id, status: 'absent', note: 'مريض' }],
    },
  });
  assert.equal(saveRes.status, 201);

  // استرجاع السجل والتأكد من اسم المعلم
  const recRes = await w.call('GET', `/api/record?date=${DAY.tue}&period=1&group_id=${g.group.id}`, { cookie: t });
  assert.equal(recRes.status, 200);
  assert.equal(recRes.data.record.teacher_name, 'الاستاذ احمد اسلامية');

  // محاولة رصد نفس الحصة مرة أخرى من معلم آخر → تعطي 409 مع اسم المعلم الذي رصدها
  const dupRes = await w.call('POST', '/api/record', {
    cookie: t,
    body: {
      date: DAY.tue,
      period: 1,
      group_id: g.group.id,
      teacher_name: 'معلم آخر',
      entries: [],
    },
  });
  assert.equal(dupRes.status, 409);
  assert.match(dupRes.data.message, /الاستاذ احمد اسلامية/);

  // قيام نفس المعلم بتحديث الرصد → ينجح 200 ويُحدث السجل
  const updateRes = await w.call('POST', '/api/record', {
    cookie: t,
    body: {
      date: DAY.tue,
      period: 1,
      group_id: g.group.id,
      teacher_name: 'الاستاذ احمد اسلامية',
      entries: [
        { student_id: sList[0].id, status: 'absent', note: 'مريض' },
        { student_id: sList[1].id, status: 'late', note: 'تأخر بالباص' },
      ],
    },
  });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.data.updated, true);

  const recUpdated = await w.call('GET', `/api/record?date=${DAY.tue}&period=1&group_id=${g.group.id}`, { cookie: t });
  assert.equal(recUpdated.data.record.entries.length, 2);
});

test('التقرير اليومي والأسبوعي والشهري', async () => {
  const w = world();
  const a = await w.admin();
  const t = await w.teacher();

  const g = await w.group(a, '10-1', 'basic', w.students(3));
  const sList = await w.idsOf(g.group.id, t);

  await w.call('POST', '/api/record', {
    cookie: t,
    body: {
      date: DAY.tue,
      period: 1,
      group_id: g.group.id,
      teacher_name: 'الاستاذ احمد اسلامية',
      entries: [{ student_id: sList[0].id, status: 'absent', note: 'غائب' }],
    },
  });

  // التقرير اليومي
  const daily = await w.call('GET', `/api/reports/daily?date=${DAY.tue}&group_id=${g.group.id}`, { cookie: t });
  assert.equal(daily.status, 200);
  assert.equal(daily.data.teachers_by_period[1], 'الاستاذ احمد اسلامية');

  // التقرير الأسبوعي
  const weekly = await w.call('GET', `/api/reports/weekly?date=${DAY.tue}`, { cookie: t });
  assert.equal(weekly.status, 200);
  assert.ok(weekly.data.teachers.some((x) => x.name === 'الاستاذ احمد اسلامية' && x.sessions === 1));

  // التقرير الشهري
  const monthly = await w.call('GET', `/api/admin/reports/monthly?month=2026-10&group_id=${g.group.id}`, { cookie: a });
  assert.equal(monthly.status, 200);
  assert.equal(monthly.data.totals.absence_days, 1);
});

// ===================================================================== 7) الفحص الثابت وحقن SQL
test('فحص ثابت: لا يُبنى أي استعلام SQL بدمج النصوص', () => {
  const templates = WORKER_SRC.match(/`[^`]*`/gs) ?? [];
  const sqlish = /\b(SELECT|INSERT\s+(OR\s+IGNORE\s+)?INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE)\b/;
  for (const item of templates) if (sqlish.test(item)) assert.ok(!item.includes('${'), `SQL يحتوي على دمج: ${item.slice(0, 60)}`);
  assert.ok(!/\.exec\(\s*[^)]*\+/.test(WORKER_SRC));
});

test('الواجهة: لا innerHTML ولا eval ولا موارد خارجية', () => {
  const rd = (f) => readFileSync(new URL(`../site/${f}`, import.meta.url), 'utf8');
  const js = rd('app.js'); const html = rd('index.html');
  for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', "setAttribute('style'"]) {
    assert.ok(!js.includes(bad), `app.js يحتوي ${bad}`);
  }
  assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), 'سكربت مضمّن في index.html');
});
