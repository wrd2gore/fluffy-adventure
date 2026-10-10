// =====================================================================================
//  منصة رصد الغياب — واجهة Vercel Serverless Function
//  تستقبل جميع طلبات /api/* وتنفّذها عبر خادم المنصة مع قاعدة بيانات SQLite مدمجة.
// =====================================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp, ensureSchema } from '../server/worker.js';

const SCHEMA_SQL = `-- قاعدة البيانات (SQLite / D1)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('school_name',           'مدرسة الشيخ سالم الصائغي'),
  ('principal_name',        'الأستاذ يونس الحجري'),
  ('developer_credit',      'الأستاذ منير الصالحي'),
  ('teacher_password_plain', 'tchr-salem-2026');

CREATE TABLE IF NOT EXISTS rules (
  id       INTEGER PRIMARY KEY,
  min_days INTEGER NOT NULL UNIQUE,
  label    TEXT NOT NULL,
  color    TEXT NOT NULL
);
INSERT OR IGNORE INTO rules (min_days, label, color) VALUES
  (5,  'تنبيه طالب',                     '#0284c7'),
  (8,  'إنذار وتعهد الطالب وولي الأمر',  '#c2410c'),
  (10, 'دراسة حالة',                     '#b45309'),
  (15, 'تخفيض درجات 10%',                '#b91c1c'),
  (30, 'الحرمان من دخول الاختبار',       '#7f1d1d');

CREATE TABLE IF NOT EXISTS teachers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO teachers (name, created_at) VALUES
  ('الاستاذ احمد اسلامية', 1700000000000),
  ('بسام الشنوفي', 1700000000000),
  ('محمد صالح محمد علي', 1700000000000),
  ('محمد رمضان عبدالحافظ احمد', 1700000000000),
  ('اسلم سيد محمد إبراهيم', 1700000000000),
  ('يحيى خالد صالح البطاشى', 1700000000000),
  ('هاني صلح عبده ابراهيم عامر', 1700000000000),
  ('عماد حسن دربالي', 1700000000000),
  ('محمد عنتر محمد مصطفى', 1700000000000),
  ('ناصر خالد عبدا الجرداني', 1700000000000),
  ('حسين على احمد على', 1700000000000),
  ('محمد احمد ابراهيم مصباح', 1700000000000),
  ('عبدالله خالد عيسى الفارسي', 1700000000000),
  ('مازن سعيد سليمان القاسمي', 1700000000000),
  ('زايد حماد نصيب الهنائى', 1700000000000),
  ('زايد الهنائي', 1700000000000),
  ('محمد الصغير صالح بوعزيزي', 1700000000000),
  ('حسني بن مسعود سعفي', 1700000000000),
  ('ياسر جمعة أحمد عمر', 1700000000000),
  ('وحيد نورالدين أحمد سعد', 1700000000000),
  ('حسان الطيب', 1700000000000),
  ('محمد معاذ', 1700000000000),
  ('محمد مسلم عيد الريامي', 1700000000000),
  ('مصباح عبد الموجود الشوادفي', 1700000000000),
  ('احمد محمد السيد موسى عبدالله', 1700000000000),
  ('وليد راشد جمعه البلوشى', 1700000000000),
  ('اسامة احمد عبد الجليل احمد', 1700000000000),
  ('حسين علي فاضل العجمي', 1700000000000),
  ('حسان الطيب طعم اللة', 1700000000000),
  ('سالم سعيد محمد السليماني', 1700000000000),
  ('أحمد الحوسني', 1700000000000),
  ('خالد سليمان خميس الحراصي', 1700000000000),
  ('أمجد عيسى أحمد الفوري', 1700000000000),
  ('الاستاذ محمد عبدالله الزين السبع', 1700000000000),
  ('منير مزهود درويش الصالحي', 1700000000000),
  ('عيسى على سعيد العميرى', 1700000000000),
  ('يسار محمد محمود احمد', 1700000000000),
  ('احمد مشهور على احمد', 1700000000000),
  ('كوني العايب', 1700000000000),
  ('مسعود علي مسعود الخياري', 1700000000000),
  ('علي عبيد الخزيمي', 1700000000000),
  ('مرزق لطفي مسعود طوس', 1700000000000),
  ('عادل شحاته عبدالحافظ عبدالرسول', 1700000000000),
  ('بدر خلفان حميد السيابى', 1700000000000),
  ('مصباح عبد الموجود الشوادفي على', 1700000000000),
  ('سلطان الراسبي', 1700000000000),
  ('الاستاذ سامي علي بلهادي عمري', 1700000000000);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id         TEXT PRIMARY KEY,
  uid        TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('teacher', 'admin')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_uid ON auth_sessions (uid);

CREATE TABLE IF NOT EXISTS login_fail (
  k  TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_fail_k ON login_fail (k, at);

CREATE TABLE IF NOT EXISTS students (
  id     INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  name   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('basic', 'mobile'))
);

CREATE TABLE IF NOT EXISTS enrollments (
  group_id   INTEGER NOT NULL REFERENCES groups (id)   ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, student_id)
);

CREATE TABLE IF NOT EXISTS records (
  id           INTEGER PRIMARY KEY,
  date         TEXT NOT NULL,
  period       INTEGER NOT NULL,
  group_id     INTEGER NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  teacher_uid  TEXT NOT NULL,
  teacher_name TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE (date, period, group_id)
);
CREATE INDEX IF NOT EXISTS records_date ON records (date);

CREATE TABLE IF NOT EXISTS entries (
  record_id  INTEGER NOT NULL REFERENCES records (id)  ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late')),
  note       TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (record_id, student_id)
);
CREATE INDEX IF NOT EXISTS entries_student ON entries (student_id);

CREATE TABLE IF NOT EXISTS audit (
  id      INTEGER PRIMARY KEY,
  at      INTEGER NOT NULL,
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT ''
);
`;

function makeD1(raw) {
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

let dbInstance = null;

function getDb() {
  if (dbInstance) return dbInstance;
  const tempDir = process.env.TEMP || process.env.TMPDIR || '/tmp';
  const dbPath = process.env.DB_PATH || join(tempDir, 'school.db');
  const existed = existsSync(dbPath);
  const raw = new DatabaseSync(dbPath);
  if (!existed) {
    let sql = SCHEMA_SQL;
    try {
      sql = readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8');
    } catch {}
    raw.exec(sql);
  }
  dbInstance = makeD1(raw);
  return dbInstance;
}

const app = createApp({ now: () => new Date() });

export default async function handler(req, res) {
  try {
    const db = getDb();
    const env = {
      DB: db,
      DEV_ADMIN_PASSWORD: process.env.DEV_ADMIN_PASSWORD || 'Boss-Pass-123',
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'Boss-Pass-123',
    };

    // Vercel Web Standard / Edge Request
    if (req && typeof req.headers?.get === 'function' && !res) {
      return app.fetch(req, env);
    }

    // Vercel Node.js Serverless Function (req, res)
    // Resolve request URL (handling Vercel rewrites, x-matched-path, and __path parameter)
    let rawPath = req.url || '/api';
    const tempUrl = new URL(rawPath, `${proto}://${host}`);
    let targetPath = tempUrl.pathname;
    if (tempUrl.searchParams.has('__path')) {
      targetPath = tempUrl.searchParams.get('__path');
      tempUrl.searchParams.delete('__path');
    } else if (req.headers['x-matched-path'] && !req.headers['x-matched-path'].includes('api/index')) {
      targetPath = req.headers['x-matched-path'];
    }
    const finalSearch = tempUrl.search;
    const finalUrl = new URL(targetPath + finalSearch, `${proto}://${host}`);

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) v.forEach((val) => headers.append(k, val));
      else if (v !== undefined) headers.set(k, String(v));
    }

    let body = undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.body) {
        body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      } else {
        body = await getBody(req);
      }
    }

    const request = new Request(finalUrl.href, {
      method: req.method,
      headers,
      body,
    });

    const response = await app.fetch(request, env);

    res.statusCode = response.status;
    for (const [k, v] of response.headers.entries()) {
      if (k.toLowerCase() === 'set-cookie') continue;
      res.setHeader(k, v);
    }
    const cookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    if (cookies.length) {
      res.setHeader('set-cookie', cookies);
    }

    const buf = Buffer.from(await response.arrayBuffer());
    res.end(buf);
  } catch (err) {
    console.error('Vercel API error:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: 'Internal Server Error: ' + (err?.message || err) }));
  }
}

function getBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
