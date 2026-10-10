// تشغيل تجريبي على جهازك بنقرة واحدة.
// يجهّز كل شيء: الحزم، قاعدة البيانات المحلية، وقائمة المعلمين، ثم يشغّل الموقع.
import { existsSync, copyFileSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';

const run = (cmd) => {
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\nفشل الأمر: ${cmd}`);
    process.exit(1);
  }
};

if (!existsSync('node_modules')) run('npm install');
if (!existsSync('.dev.vars')) copyFileSync('.dev.vars.example', '.dev.vars');
run('npm run db:local');

console.log('\n========================================================');
console.log(' الموقع يعمل على:  http://localhost:8787');
console.log(' بوابة المعلمين:   كلمة المرور: tchr-salem-2026');
console.log(' لوحة الإدارة:     كلمة المرور: Boss-Pass-123 (أو من .dev.vars)');
console.log(' ملاحظة: يمكنك تغيير وتوليد كلمات المرور وقائمة المعلمين من لوحة الإدارة');
console.log(' لإيقاف الموقع اضغط Ctrl+C');
console.log('========================================================\n');

setTimeout(() => {
  const open = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(`${open} http://localhost:8787`, { shell: true, stdio: 'ignore' }).on('error', () => {});
}, 3000);

run('npm run dev');
