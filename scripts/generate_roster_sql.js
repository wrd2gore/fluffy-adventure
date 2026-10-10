import fs from 'node:fs';

const rawData = JSON.parse(fs.readFileSync('scripts/all_students.json', 'utf8'));

// Format class code:
// "عاشر / 1" -> classId: 1001, code: "10-1"
// "حادي عشر / 1" -> classId: 1101, code: "11-1"
// "ثاني عشر / 1" -> classId: 1201, code: "12-1"

function getClassMeta(cname) {
  if (cname.startsWith('عاشر')) {
    const num = cname.split('/')[1].trim();
    return { id: 1000 + parseInt(num), code: `10/${num}`, grade: 10, num: parseInt(num) };
  } else if (cname.startsWith('حادي عشر')) {
    const num = cname.split('/')[1].trim();
    return { id: 1100 + parseInt(num), code: `11/${num}`, grade: 11, num: parseInt(num) };
  } else if (cname.startsWith('ثاني عشر')) {
    const num = cname.split('/')[1].trim();
    return { id: 1200 + parseInt(num), code: `12/${num}`, grade: 12, num: parseInt(num) };
  }
  throw new Error('Unknown class: ' + cname);
}

// Sort classes logically: Grade 10 (1-5), Grade 11 (1-12), Grade 12 (1-13)
const sortedClassNames = Object.keys(rawData).sort((a, b) => {
  const ma = getClassMeta(a);
  const mb = getClassMeta(b);
  if (ma.grade !== mb.grade) return ma.grade - mb.grade;
  return ma.num - mb.num;
});

const groups = [];
const students = [];
const enrollments = [];

let studentAutoId = 1;

for (const cname of sortedClassNames) {
  const meta = getClassMeta(cname);
  groups.push({
    id: meta.id,
    name: cname,
    kind: 'basic'
  });

  const list = rawData[cname];
  list.forEach((st, idx) => {
    const seatNum = parseInt(st.num) || (idx + 1);
    const uniqueNumber = `${meta.code}-${seatNum}`;
    const sId = studentAutoId++;

    students.push({
      id: sId,
      number: uniqueNumber,
      name: st.name
    });

    enrollments.push({
      group_id: meta.id,
      student_id: sId
    });
  });
}

console.log(`Generated ${groups.length} groups, ${students.length} students, ${enrollments.length} enrollments.`);

// Build SQL file
let sql = `-- إدراج صفوف المدرسة وطلابها (30 صفاً و893 طالباً)\n`;
sql += `PRAGMA foreign_keys = ON;\n\n`;

// Insert Groups
sql += `-- 1) الصفوف الدراسية الأساسية\n`;
sql += `INSERT OR IGNORE INTO groups (id, name, kind) VALUES\n`;
sql += groups.map(g => `  (${g.id}, '${g.name.replace(/'/g, "''")}', '${g.kind}')`).join(',\n') + ';\n\n';

// Insert Students in chunks of 100
sql += `-- 2) الطلاب المسجلون\n`;
for (let i = 0; i < students.length; i += 100) {
  const chunk = students.slice(i, i + 100);
  sql += `INSERT OR IGNORE INTO students (id, number, name) VALUES\n`;
  sql += chunk.map(s => `  (${s.id}, '${s.number.replace(/'/g, "''")}', '${s.name.replace(/'/g, "''")}')`).join(',\n') + ';\n\n';
}

// Insert Enrollments in chunks of 100
sql += `-- 3) توزيع الطلاب على الصفوف\n`;
for (let i = 0; i < enrollments.length; i += 100) {
  const chunk = enrollments.slice(i, i + 100);
  sql += `INSERT OR IGNORE INTO enrollments (group_id, student_id) VALUES\n`;
  sql += chunk.map(e => `  (${e.group_id}, ${e.student_id})`).join(',\n') + ';\n\n';
}

fs.writeFileSync('scripts/seed_roster.sql', sql, 'utf8');
console.log('SQL generated at scripts/seed_roster.sql');
