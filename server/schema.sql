-- قاعدة البيانات (Cloudflare D1 = SQLite). تُنفَّذ بأمان أكثر من مرة.
-- لا يوجد أي وصول عام إلى هذه القاعدة: لا يصل إليها إلا الـ Worker عبر الربط الداخلي.

PRAGMA foreign_keys = ON;

-- إعدادات المدرسة (الاسم، المدير، حقوق التطوير، وكلمات المرور)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('school_name',           'مدرسة حفص بن راشد'),
  ('principal_name',        'الأستاذ طلال الهنائي'),
  ('developer_credit',      'الأستاذ منير الصالحي'),
  ('teacher_password_plain', 'tchr-salem-2026');

-- لائحة الإجراءات حسب عدد أيام الغياب في الشهر (تُعدَّل من لوحة الإدارة)
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

-- قائمة المعلمين المسجلين في المدرسة (تُضاف وتُدار عبر لوحة الإدارة)
CREATE TABLE IF NOT EXISTS teachers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- جلسات الدخول: نخزّن بصمة SHA-256 للرمز فقط، فلا يفيد تسريب القاعدة في انتحال جلسة
CREATE TABLE IF NOT EXISTS auth_sessions (
  id         TEXT PRIMARY KEY,
  uid        TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('teacher', 'admin')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_uid ON auth_sessions (uid);

-- محاولات الدخول الفاشلة (للحد من تخمين كلمات المرور)
CREATE TABLE IF NOT EXISTS login_fail (
  k  TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_fail_k ON login_fail (k, at);

-- الطلاب: الرقم هو المفتاح، لذلك يرتبط الطالب تلقائياً بصفه الأساسي وبالمواد المتنقلة
CREATE TABLE IF NOT EXISTS students (
  id     INTEGER PRIMARY KEY,
  number TEXT NOT NULL,
  name   TEXT NOT NULL
);

-- الصفوف الأساسية والمواد المتنقلة
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

-- سجل رصد حصة واحدة. القيد UNIQUE هو الذي "يقفل" الحصة بعد الحفظ.
CREATE TABLE IF NOT EXISTS records (
  id           INTEGER PRIMARY KEY,
  date         TEXT NOT NULL,              -- YYYY-MM-DD
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

-- سجل العمليات الإدارية
CREATE TABLE IF NOT EXISTS audit (
  id      INTEGER PRIMARY KEY,
  at      INTEGER NOT NULL,
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT ''
);

-- الجلسات الملغاة
CREATE TABLE IF NOT EXISTS session_revocations (
  id         TEXT PRIMARY KEY,
  revoked_at INTEGER NOT NULL
);

