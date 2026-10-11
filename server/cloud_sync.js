// =====================================================================================
//  منصة رصد الغياب المدرسي — وحدة المزامنة السحابية الدائمة (Cloud Sync)
//  تضمن استمرارية السجلات وأسماء المعلمين عبر جميع وحدات Vercel Serverless
// =====================================================================================

const SYNC_OBJECT_ID = 'ff808181a09d98f701a12a503d393b9a';
const API_URL = `https://api.restful-api.dev/objects/${SYNC_OBJECT_ID}`;

let lastPullTime = 0;
const PULL_INTERVAL_MS = 3000; // مهدئة سحب كل 3 ثوانٍ كحد أقصى لمنع استدعاءات مفرطة

const isTest = typeof process !== 'undefined' && (process.env?.NODE_TEST_CONTEXT || (process.argv?.[1] && process.argv[1].includes('test.mjs')));

export async function pullCloudState() {
  if (isTest) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(API_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const body = await res.json();
    return body?.data || null;
  } catch (err) {
    return null;
  }
}

export async function pushCloudState(data) {
  if (isTest) return true;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(API_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'school_hafth_data_store',
        data: {
          ...data,
          updated_at: Date.now()
        }
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    return res.ok;
  } catch (err) {
    return false;
  }
}

export async function syncFromCloud(db, force = false) {
  const now = Date.now();
  if (!force && (now - lastPullTime < PULL_INTERVAL_MS)) return;
  lastPullTime = now;

  const cloud = await pullCloudState();
  if (!cloud) return;

  let localChanged = false;

  // 1) مزامنة المعلمين من السحابة إلى المحلي
  if (Array.isArray(cloud.teachers)) {
    for (const t of cloud.teachers) {
      if (t && t.name) {
        try {
          await db.prepare('INSERT OR IGNORE INTO teachers (name, created_at) VALUES (?1, ?2)')
            .bind(t.name.trim(), t.created_at || now)
            .run();
        } catch {}
      }
    }
  }

  // 2) مزامنة سجلات الحصص والغياب من السحابة إلى المحلي
  if (Array.isArray(cloud.records)) {
    for (const r of cloud.records) {
      if (!r || !r.date || !r.period || !r.group_id) continue;
      try {
        const local = await db.prepare('SELECT id, created_at FROM records WHERE date = ?1 AND period = ?2 AND group_id = ?3')
          .bind(r.date, r.period, r.group_id)
          .first();

        let recId = local?.id;
        if (!local) {
          const ins = await db.prepare(`
            INSERT INTO records (date, period, group_id, teacher_uid, teacher_name, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
          `).bind(r.date, r.period, r.group_id, r.teacher_uid || 'teacher', r.teacher_name, r.created_at || now).run();
          recId = ins?.meta?.last_row_id;
          if (!recId) {
            const row = await db.prepare('SELECT id FROM records WHERE date = ?1 AND period = ?2 AND group_id = ?3')
              .bind(r.date, r.period, r.group_id).first();
            recId = row?.id;
          }
          localChanged = true;
        } else if (r.created_at && local.created_at && r.created_at > local.created_at) {
          await db.prepare('UPDATE records SET teacher_name = ?1, created_at = ?2 WHERE id = ?3')
            .bind(r.teacher_name, r.created_at, recId).run();
          await db.prepare('DELETE FROM entries WHERE record_id = ?1').bind(recId).run();
          localChanged = true;
        }

        // إدراج تفاصيل الغياب (entries) إذا كان السجل جديداً أو محدثاً
        if (recId && Array.isArray(r.entries) && (localChanged || !local)) {
          for (const e of r.entries) {
            if (e && e.student_id && e.status) {
              await db.prepare(`
                INSERT OR REPLACE INTO entries (record_id, student_id, status, note)
                VALUES (?1, ?2, ?3, ?4)
              `).bind(recId, e.student_id, e.status, e.note || '').run();
            }
          }
        }
      } catch (err) {
        // تجاهل أخطاء القيود لعدم إيقاف المزامنة
      }
    }
  }

  // 3) التحقق من وجود بيانات محلية غير موجودة بالسحابة (مزامنة عكسية للمحافظة على أي تسجيل محلي)
  try {
    const localTeachers = (await db.prepare('SELECT name, created_at FROM teachers').all()).results || [];
    const localRecords = (await db.prepare(`
      SELECT r.id, r.date, r.period, r.group_id, r.teacher_uid, r.teacher_name, r.created_at
        FROM records r
    `).all()).results || [];

    let cloudNeedsUpdate = false;
    const cloudTeachers = Array.isArray(cloud.teachers) ? [...cloud.teachers] : [];
    const cloudRecords = Array.isArray(cloud.records) ? [...cloud.records] : [];

    for (const lt of localTeachers) {
      if (!cloudTeachers.some((ct) => ct.name === lt.name)) {
        cloudTeachers.push({ name: lt.name, created_at: lt.created_at });
        cloudNeedsUpdate = true;
      }
    }

    for (const lr of localRecords) {
      const idx = cloudRecords.findIndex((cr) => cr.date === lr.date && cr.period === lr.period && cr.group_id === lr.group_id);
      if (idx === -1) {
        // قراءة تفاصيل هذا السجل
        const entries = (await db.prepare('SELECT student_id, status, note FROM entries WHERE record_id = ?1').bind(lr.id).all()).results || [];
        cloudRecords.push({
          date: lr.date,
          period: lr.period,
          group_id: lr.group_id,
          teacher_uid: lr.teacher_uid,
          teacher_name: lr.teacher_name,
          created_at: lr.created_at,
          entries: entries.map((e) => ({ student_id: e.student_id, status: e.status, note: e.note }))
        });
        cloudNeedsUpdate = true;
      }
    }

    if (cloudNeedsUpdate) {
      cloud.teachers = cloudTeachers;
      cloud.records = cloudRecords;
      // دفع غير متزامن للسحابة
      pushCloudState(cloud).catch(() => {});
    }
  } catch {}
}

export async function syncRecordSaved(db, { date, period, group_id, teacher_name, entries, created_at }) {
  try {
    const cloud = (await pullCloudState()) || { teachers: [], records: [] };
    cloud.teachers = Array.isArray(cloud.teachers) ? cloud.teachers : [];
    cloud.records = Array.isArray(cloud.records) ? cloud.records : [];

    // تأكيد وجود المعلم في قائمة المعلمين
    if (teacher_name && !cloud.teachers.some((t) => t.name === teacher_name)) {
      cloud.teachers.push({ name: teacher_name, created_at: created_at || Date.now() });
    }

    // تحديث أو إضافة السجل
    const recIdx = cloud.records.findIndex((r) => r.date === date && r.period === period && r.group_id === group_id);
    const recData = {
      date,
      period,
      group_id,
      teacher_uid: 'teacher',
      teacher_name,
      created_at: created_at || Date.now(),
      entries: (entries || []).map((e) => ({
        student_id: e.student_id || e.sid,
        status: e.status,
        note: e.note || ''
      }))
    };

    if (recIdx >= 0) {
      cloud.records[recIdx] = recData;
    } else {
      cloud.records.push(recData);
    }

    await pushCloudState(cloud);
  } catch {}
}

export async function syncTeacherAdded(name, createdAt = Date.now()) {
  try {
    const cloud = (await pullCloudState()) || { teachers: [], records: [] };
    cloud.teachers = Array.isArray(cloud.teachers) ? cloud.teachers : [];
    cloud.records = Array.isArray(cloud.records) ? cloud.records : [];

    const trimmed = name.trim();
    if (!cloud.teachers.some((t) => t.name === trimmed)) {
      cloud.teachers.push({ name: trimmed, created_at: createdAt });
      await pushCloudState(cloud);
    }
  } catch {}
}

export async function syncRecordDeleted(date, period, group_id) {
  try {
    const cloud = (await pullCloudState()) || { teachers: [], records: [] };
    if (!Array.isArray(cloud.records)) return;
    cloud.records = cloud.records.filter((r) => !(r.date === date && r.period === period && r.group_id === group_id));
    await pushCloudState(cloud);
  } catch {}
}

export async function syncTeacherDeleted(name) {
  try {
    const cloud = (await pullCloudState()) || { teachers: [], records: [] };
    if (!Array.isArray(cloud.teachers)) return;
    cloud.teachers = cloud.teachers.filter((t) => t.name !== name);
    await pushCloudState(cloud);
  } catch {}
}
