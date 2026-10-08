// تشغيل تجريبي على جهازك بنقرة واحدة (يعمل على localhost فقط، بحسابات وهمية ولا يتصل بـ Firebase الحقيقي).
// يجهّز كل شيء: الحزم، قاعدة البيانات المحلية، حسابات المعلمين الـ47 من teachers.txt، ثم يشغّل الموقع.
import { existsSync, copyFileSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';

const run = (cmd) => { const r = spawnSync(cmd, { shell: true, stdio: 'inherit' }); if (r.status !== 0) { console.error(`\nفشل الأمر: ${cmd}`); process.exit(1); } };

if (!existsSync('node_modules')) run('npm install');
if (!existsSync('.dev.vars')) copyFileSync('.dev.vars.example', '.dev.vars');
run('npm run db:local');

if (!existsSync('teachers-login.csv')) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const names = [...new Set(readFileSync('teachers.txt', 'utf8').split(/\r?\n/).map((l) => l.replace(/^[\s\d.\-–)(،:]+/, '').trim()).filter(Boolean))];
  const q = (s) => `'${s.replace(/'/g, "''")}'`;
  const rows = []; let sql = 'CREATE TABLE IF NOT EXISTS dev_users (uid TEXT PRIMARY KEY, email TEXT UNIQUE, pw TEXT, name TEXT);\n';
  names.forEach((name, i) => {
    const username = `t${String(i + 1).padStart(2, '0')}`;
    const password = Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join('');
    const hash = createHash('sha256').update(password).digest('hex');
    sql += `INSERT OR IGNORE INTO dev_users (uid, email, pw, name) VALUES (${q('dev-' + username)}, ${q(username + '@school.example')}, ${q(hash)}, ${q(name)});\n`;
    sql += `INSERT OR IGNORE INTO teachers (uid, username, name, must_change, created_at) VALUES (${q('dev-' + username)}, ${q(username)}, ${q(name)}, 1, ${Date.now()});\n`;
    rows.push([name, username, password]);
  });
  writeFileSync('seed-local.sql', sql);
  run('npx wrangler d1 execute school-db --local --file=seed-local.sql');
  unlinkSync('seed-local.sql');
  writeFileSync('teachers-login.csv', '﻿' + [['الاسم', 'اسم المستخدم', 'كلمة المرور'], ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\r\n'));
  console.log(`\nتم إنشاء ${rows.length} حساب معلم. كلمات المرور المؤقتة في الملف: teachers-login.csv`);
}

console.log('\n========================================================');
console.log(' الموقع يعمل على:  http://localhost:8787');
console.log(' الإدارة:  اسم المستخدم admin  وكلمة المرور من الملف .dev.vars');
console.log(' المعلمون: اسم كل معلم + كلمة مروره من الملف teachers-login.csv');
console.log(' لإيقاف الموقع اضغط Ctrl+C');
console.log('========================================================\n');
setTimeout(() => {
  const open = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(`${open} http://localhost:8787`, { shell: true, stdio: 'ignore' }).on('error', () => {});
}, 6000);
run('npm run dev');
