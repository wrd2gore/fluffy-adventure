-- قاعدة البيانات (Cloudflare D1 = SQLite). تُنفَّذ بأمان أكثر من مرة.
-- لا يوجد أي وصول عام إلى هذه القاعدة: لا يصل إليها إلا الـ Worker عبر الربط الداخلي.

PRAGMA foreign_keys = ON;

-- إعدادات المدرسة (الاسم، المدير، حقوق التطوير، وكلمات المرور)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('school_name',           'مدرسة الشيخ سالم الصائغي'),
  ('principal_name',        'الأستاذ يونس الحجري'),
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

-- قائمة المعلمين المسجلين في المدرسة
CREATE TABLE IF NOT EXISTS teachers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- إدراج قائمة المعلمين الـ47 للمدرسة
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
  number TEXT NOT NULL UNIQUE,
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
