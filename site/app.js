/* =============================================================================
   منصة رصد الغياب — الواجهة (ملف واحد)
   لا يُستخدم HTML خام في أي مكان: كل النصوص تُدرج بـ textContent فلا يمكن لأي بيانات أن تتحول إلى كود.
   فهرس الملف:
    1) أدوات DOM والأيقونات والرسائل   2) الاتصال بالخادم   3) الحالة واختيار المعلم
    4) الرئيسية والدخول بكلمة المرور فقط   5) هيكل الصفحة (ترويسة + تبويبات)
    6) رصد الغياب (المعلم)   7) التقارير (يومي/أسبوعي/شهري)
    8) لوحة الإدارة: الصفوف، المعلمون، كلمات المرور، الإعدادات   9) التشغيل
   ============================================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- 1) أدوات DOM */
  function h(tag, props) {
    var el = document.createElement(tag);
    var value;
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'value') value = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'disabled' || k === 'hidden' || k === 'checked' || k === 'selected') el[k] = true;
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    add(el, Array.prototype.slice.call(arguments, 2));
    if (value !== undefined) el.value = value;
    return el;
  }
  function add(el, kids) {
    kids.forEach(function (k) {
      if (Array.isArray(k)) add(el, k);
      else if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    });
    return el;
  }
  function mount(el) { while (el.firstChild) el.removeChild(el.firstChild); return add(el, Array.prototype.slice.call(arguments, 1)); }

  var ICONS = {
    school: 'M2 10 12 4l10 6M5 10v9M19 10v9M9 19v-5h6v5M3 19h18',
    check: 'M20 6 9 17l-5-5', x: 'M18 6 6 18M6 6l12 12', plus: 'M12 5v14M5 12h14',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2',
    trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6',
    print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z', download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
    logout: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9', key: 'M14 10a4 4 0 1 1-3.5 6L3 16v-3h3v-2h3l1.5-1.5A4 4 0 0 1 14 10Z',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z', back: 'M9 5l7 7-7 7', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM21 21l-5-5',
    book: 'M5 4h13v16H7a2 2 0 0 1-2-2V4ZM5 18a2 2 0 0 1 2-2h11', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
    shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z', code: 'M8 7 3 12l5 5M16 7l5 5-5 5M14 4l-4 16',
    users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.2a6.5 6.5 0 0 1 3.5 5.8',
    copy: 'M8 4v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.242a2 2 0 0 0-.602-1.43L16.083 2.57A2 2 0 0 0 14.685 2H10a2 2 0 0 0-2 2Zm-4 4h2v12h10v2H6a2 2 0 0 1-2-2V8Z',
    userPlus: 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8.5 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM20 8v6M23 11h-6',
    database: 'M12 2C6.48 2 2 4.02 2 6.5v11C2 19.98 6.48 22 12 22s10-2.02 10-4.5v-11C22 4.02 17.52 2 12 2Zm0 3c4.41 0 8 1.34 8 2s-3.59 2-8 2-8-1.34-8-2 3.59-2 8-2Zm0 15c-4.41 0-8-1.34-8-2v-2.13C5.64 16.57 8.65 17 12 17s6.36-.43 8-1.13V18c0 .66-3.59 2-8 2Zm0-5c-4.41 0-8-1.34-8-2v-2.13C5.64 11.57 8.65 12 12 12s6.36-.43 8-1.13V13c0 .66-3.59 2-8 2Z',
    refresh: 'M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l6.73-5.19',
    shieldCheck: 'M12 2 4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3Zm-1 14.5-4-4 1.41-1.41L11 13.67l6.59-6.59L19 8.5l-8 8Z',
    checkCircle: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8Z',
    sparkles: 'm12 3 1.91 5.09L19 10l-5.09 1.91L12 17l-1.91-5.09L5 10l5.09-1.91L12 3Z',
    filter: 'M22 3H2l8 9.46V19l4 2v-8.54L22 3Z',
    fileText: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
    info: 'M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20zm0-2a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm-1-5h2v2h-2v-2zm0-8h2v6h-2V7z',
    eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zm11 5a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
    edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
    lock: 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2Zm-7 6a2 2 0 1 1 2-2 2 2 0 0 1-2 2Zm5-6V7a5 5 0 0 0-10 0v4Z'
  };

  function icon(name) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'i'); svg.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(ns, 'path'); p.setAttribute('d', ICONS[name] || ICONS.check);
    svg.append(p);
    return svg;
  }
  function btn(label, o) {
    o = o || {};
    var tip = o.tooltip || o.title;
    var attrs = { type: o.type || 'button', class: 'btn ' + (o.kind || '') + (o.sm ? ' sm' : '') + (o.block ? ' block' : ''), onclick: o.on, disabled: o.disabled };
    if (tip) attrs['data-tooltip'] = tip;
    if (o.title) attrs.title = o.title;
    return h('button', attrs, o.ic && icon(o.ic), label);
  }
  function field(label, control, hint) {
    return h('label', { class: 'field' }, h('span', { text: label }), control, hint && h('small', { class: 'muted', text: hint }));
  }
  var ltr = function (t) { return h('span', { class: 'ltr', text: t }); };

  function toast(msg, bad) {
    var t = h('div', { class: 'toast' + (bad ? ' err' : ''), text: msg });
    document.getElementById('toasts').append(t);
    setTimeout(function () { t.remove(); }, bad ? 6000 : 3000);
  }
  function copyText(str, msg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(str).then(function () {
        toast(msg || 'تم النسخ إلى الحافظة');
      }).catch(function () {
        fallbackCopy(str, msg);
      });
    } else {
      fallbackCopy(str, msg);
    }
  }
  function fallbackCopy(str, msg) {
    var ta = document.createElement('textarea');
    ta.value = str;
    ta.setAttribute('readonly', '');
    document.body.append(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast(msg || 'تم النسخ إلى الحافظة');
    } catch (e) {
      toast('يرجى تحديد النص ونسخه يدوياً', true);
    }
    ta.remove();
  }
  function overlay(content) {
    var ov = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'dlg' }, content));
    function close() { ov.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    document.body.append(ov);
    var first = ov.querySelector('button, input'); if (first) first.focus();
    return { close: close };
  }
  function confirmBox(title, message, okLabel, danger) {
    return new Promise(function (resolve) {
      var box;
      function done(v) { box.close(); resolve(v); }
      box = overlay([h('h3', { text: title }), message && h('p', { class: 'muted', text: message }),
        h('div', { class: 'acts' }, btn('إلغاء', { on: function () { done(false); } }),
          btn(okLabel || 'تأكيد', { kind: danger ? 'danger' : 'primary', on: function () { done(true); } }))]);
    });
  }
  function busy(button, fn) {
    button.disabled = true;
    return Promise.resolve().then(fn).then(function (r) { button.disabled = false; return r; }, function (e) { button.disabled = false; throw e; });
  }
  var fail = function (e) { toast((e && e.message) || 'حدث خطأ', true); };
  var empty = function (t, hint) { return h('div', { class: 'empty' }, h('b', { text: t }), hint && h('span', { text: hint })); };
  var skeleton = function (n) { var d = h('div', { 'aria-hidden': 'true' }); for (var i = 0; i < (n || 3); i++) d.append(h('div', { class: 'skel' })); return d; };

  /* ---- التواريخ ---- */
  var DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var dow = function (d) { return new Date(d + 'T00:00:00Z').getUTCDay(); };
  function addDays(d, n) { var t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
  var isWeekend = function (d) { return S.config.weekend_days.indexOf(dow(d)) >= 0; };
  var STATUS = { present: ['حاضر', 'check'], absent: ['غائب', 'x'], late: ['متأخر', 'clock'] };

  function stamp(status) {
    var s = STATUS[status] || STATUS.present;
    return h('span', { class: 'stamp ' + status }, icon(s[1]), ' ' + s[0]);
  }

  function downloadCSV(name, rows) {
    var text = '﻿' + rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n');
    var a = h('a', { download: name, href: URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })) });
    document.body.append(a); a.click(); a.remove();
  }

  /* ---------------------------------------------------------------- 2) الاتصال بالخادم */
  function ApiError(message, status) { this.message = message; this.status = status; }
  function api(method, path, body) {
    var opt = { method: method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          if (res.status === 401 && S.user && path !== '/api/login') { S.user = null; toast('انتهت الجلسة، سجّل الدخول من جديد', true); location.hash = '#/'; render(); }
          throw new ApiError(data.message || 'حدث خطأ غير متوقع', res.status);
        }
        return data;
      });
    }, function () { throw new ApiError('تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.', 0); });
  }
  var get = function (p) { return api('GET', p); };
  var post = function (p, b) { return api('POST', p, b || {}); };
  var put = function (p, b) { return api('PUT', p, b || {}); };
  var qs = function (o) { return Object.keys(o).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&'); };

  /* ---------------------------------------------------------------- 3) الحالة واختيار المعلم */
  var S = {
    pub: {},
    user: null,
    config: null,
    rules: [],
    groups: null,
    teachersList: [],
    selectedTeacher: ''
  };

  try {
    S.selectedTeacher = localStorage.getItem('selected_teacher_name') || '';
  } catch (e) {
    S.selectedTeacher = '';
  }

  var stops = [];
  function onStop(fn) { stops.push(fn); }
  function stopAll() { stops.splice(0).forEach(function (f) { f(); }); }
  function poll(fn, ms) {
    var id = setInterval(function () { if (!document.hidden) fn(); }, ms);
    onStop(function () { clearInterval(id); });
  }
  var app = document.getElementById('app');

  function getGroupGradeInfo(g) {
    var name = (g && g.name) ? g.name : '';
    if (g && g.kind === 'mobile') return { order: 90, label: 'المواد المتنقلة' };
    if (name.indexOf('حادي عشر') >= 0) return { order: 11, label: 'الصف الحادي عشر' };
    if (name.indexOf('ثاني عشر') >= 0) return { order: 12, label: 'الصف الثاني عشر' };
    if (name.indexOf('عاشر') >= 0) return { order: 10, label: 'الصف العاشر' };
    if (name.indexOf('تاسع') >= 0) return { order: 9, label: 'الصف التاسع' };
    if (name.indexOf('ثامن') >= 0) return { order: 8, label: 'الصف الثامن' };
    if (name.indexOf('سابع') >= 0) return { order: 7, label: 'الصف السابع' };
    if (name.indexOf('سادس') >= 0) return { order: 6, label: 'الصف السادس' };
    if (name.indexOf('خامس') >= 0) return { order: 5, label: 'الصف الخامس' };
    return { order: 99, label: (g && g.kind === 'basic') ? 'صفوف أخرى' : 'مواد أخرى' };
  }

  function getGroupNumber(name) {
    var m = (name || '').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  function sortGroupsList(list) {
    return (list || []).slice().sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind === 'basic' ? -1 : 1;
      var ga = getGroupGradeInfo(a);
      var gb = getGroupGradeInfo(b);
      if (ga.order !== gb.order) return ga.order - gb.order;
      var na = getGroupNumber(a.name);
      var nb = getGroupNumber(b.name);
      if (na !== nb) return na - nb;
      return (a.name || '').localeCompare(b.name || '', 'ar');
    });
  }

  function loadGroups(force) {
    if (S.groups && !force) return Promise.resolve(S.groups);
    return get('/api/groups').then(function (r) {
      S.groups = sortGroupsList(r.groups);
      return S.groups;
    });
  }

  function loadTeachersRoster(force) {
    if (S.teachersList.length && !force) return Promise.resolve(S.teachersList);
    return get('/api/teachers').then(function (r) {
      S.teachersList = r.teachers || [];
      return S.teachersList;
    });
  }

  function loadMe() {
    return get('/api/me').then(function (r) {
      S.user = r;
      S.config = r.config;
      S.rules = r.rules || [];
      return r;
    });
  }

  var home = function () {
    if (S.user.role === 'admin') return '#/a/monthly';
    return '#/t/attendance';
  };

  var TEACHER_TABS = [
    ['attendance', 'رصد الحضور', 'check'],
    ['daily', 'تقرير اليوم', 'book'],
    ['weekly', 'نشاط المعلمين', 'users']
  ];

  var ADMIN_CATEGORIES = [
    {
      id: 'reports',
      label: 'التقارير والإحصائيات',
      shortLabel: 'التقارير',
      icon: 'book',
      defaultTab: 'daily',
      tabs: [
        ['daily', 'التقرير اليومي', 'book'],
        ['monthly', 'التقرير الشهري', 'book'],
        ['weekly', 'إحصائيات المعلمين', 'users']
      ]
    },
    {
      id: 'classes_records',
      label: 'الصفوف وسجلات الحصص',
      shortLabel: 'الصفوف والحصص',
      icon: 'school',
      defaultTab: 'classes',
      tabs: [
        ['classes', 'الصفوف والطلاب', 'users'],
        ['records', 'سجلات الحصص', 'check']
      ]
    },
    {
      id: 'admin_management',
      label: 'المعلمون وكلمات المرور',
      shortLabel: 'المعلمون والتحكم',
      icon: 'shieldCheck',
      defaultTab: 'teachers',
      tabs: [
        ['teachers', 'دليل المعلمين وكلمات المرور', 'userPlus'],
        ['settings', 'إعدادات المنصة واللائحة', 'database']
      ]
    }
  ];

  var ADMIN_ALL_TABS = [];
  ADMIN_CATEGORIES.forEach(function (c) {
    c.tabs.forEach(function (t) { ADMIN_ALL_TABS.push(t); });
  });

  function getAdminCategoryForTab(tab) {
    for (var i = 0; i < ADMIN_CATEGORIES.length; i++) {
      if (ADMIN_CATEGORIES[i].tabs.some(function (t) { return t[0] === tab; })) {
        return ADMIN_CATEGORIES[i];
      }
    }
    return ADMIN_CATEGORIES[0];
  }

  function subNavigation(tab, isAdmin) {
    if (!isAdmin) return null;
    var cat = getAdminCategoryForTab(tab);
    return h('div', { class: 'subtabs-bar' },
      h('div', { class: 'subtabs' },
        cat.tabs.map(function (t) {
          return h('a', {
            class: 'subtab',
            role: 'tab',
            href: '#/a/' + t[0],
            'aria-selected': t[0] === tab ? 'true' : 'false',
            text: t[1]
          });
        })));
  }

  // نافذة اختيار المعلم (تظهر للمرة الأولى أو عند النقر على تغيير المعلم)
  function openTeacherSelectorModal(onDone) {
    loadTeachersRoster().then(function (teachers) {
      var box;
      var nameIn = h('input', {
        type: 'text',
        placeholder: 'اكتب اسمك هنا (مثال: أ. محمد السعدي)…',
        value: S.selectedTeacher || '',
        maxlength: '100',
        style: 'width: 100%; font-size: 1.05rem; padding: 10px 14px; margin-bottom: 8px;'
      });
      var submitBtn = btn('حفظ الاسم والمتابعة', {
        kind: 'primary',
        ic: 'check',
        on: function () {
          var val = nameIn.value.trim();
          if (!val) return toast('يرجى كتابة اسم المعلم أولاً للمتابعة', true);
          S.selectedTeacher = val;
          try { localStorage.setItem('selected_teacher_name', val); } catch (e) {}
          toast('أهلاً بك: ' + val);
          box.close();
          if (onDone) {
            onDone(val);
            var bLabels = document.querySelectorAll('.teacher-name-label');
            bLabels.forEach(function (b) { b.textContent = val; });
          } else {
            render();
          }
        }
      });
      nameIn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); submitBtn.click(); }
      });

      var rosterSection = null;
      if (teachers && teachers.length) {
        var chips = teachers.map(function (t) {
          var isCur = S.selectedTeacher === t.name;
          return h('button', {
            type: 'button',
            class: 'teacher-grid-btn' + (isCur ? ' selected' : ''),
            onclick: function () {
              nameIn.value = t.name;
              submitBtn.click();
            }
          }, h('span', { text: t.name }), isCur ? icon('check') : null);
        });
        rosterSection = h('div', { style: 'margin-top: 14px;' },
          h('p', { class: 'muted small', style: 'margin-bottom: 6px;', text: 'أو اختر اسمك المسجل في دليل المدرسة:' }),
          h('div', { class: 'teacher-grid' }, chips));
      }

      box = overlay([
        h('h3', { text: 'من أنت؟ حدد هويتك للمتابعة' }),
        h('p', { class: 'muted small', text: 'اكتب اسمك لحفظ هويتك في هذا المتصفح ورصد الحصص باسمك المعتمد.' }),
        h('div', { style: 'margin: 14px 0 8px 0;' }, nameIn),
        rosterSection,
        h('div', { class: 'acts' },
          S.selectedTeacher && btn('إلغاء', { on: function () { box.close(); } }),
          submitBtn)
      ]);
      setTimeout(function () { nameIn.focus(); }, 60);
    }).catch(fail);
  }

  // نافذة تغيير كلمة مرور لوحة الإدارة
  function openAdminPasswordModal() {
    var curIn = h('input', {
      type: 'password',
      dir: 'ltr',
      required: true,
      autocomplete: 'current-password',
      placeholder: 'أدخل كلمة المرور الحالية للإدارة'
    });
    var newIn = h('input', {
      type: 'password',
      dir: 'ltr',
      required: true,
      minlength: '6',
      autocomplete: 'new-password',
      placeholder: 'أدخل كلمة المرور الجديدة (6 أحرف فأكثر)'
    });
    var confirmIn = h('input', {
      type: 'password',
      dir: 'ltr',
      required: true,
      minlength: '6',
      autocomplete: 'new-password',
      placeholder: 'أعد إدخال كلمة المرور الجديدة للتأكيد'
    });

    var errMsg = h('div', { class: 'err', hidden: true });

    function rowWithEye(inputEl) {
      var eyeBtn = h('button', {
        type: 'button',
        class: 'btn icon-btn',
        title: 'إظهار / إخفاء',
        'aria-label': 'إظهار أو إخفاء كلمة المرور',
        onclick: function () {
          inputEl.type = inputEl.type === 'text' ? 'password' : 'text';
        }
      }, icon('eye'));
      return h('div', { class: 'pw-input-wrap' }, inputEl, eyeBtn);
    }

    var box;
    var saveBtn = btn('تحديث كلمة المرور', {
      kind: 'primary',
      ic: 'check',
      on: function () {
        errMsg.hidden = true;
        errMsg.textContent = '';
        var c = curIn.value.trim();
        var n = newIn.value.trim();
        var cf = confirmIn.value.trim();
        if (!c) {
          errMsg.textContent = 'يرجى إدخال كلمة المرور الحالية للإدارة أولاً';
          errMsg.hidden = false;
          curIn.focus();
          return;
        }
        if (n.length < 6) {
          errMsg.textContent = 'كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف';
          errMsg.hidden = false;
          newIn.focus();
          return;
        }
        if (n === c) {
          errMsg.textContent = 'كلمة المرور الجديدة يجب أن تختلف عن كلمة المرور الحالية';
          errMsg.hidden = false;
          newIn.focus();
          return;
        }
        if (n !== cf) {
          errMsg.textContent = 'كلمتا المرور الجديدتان غير متطابقتين';
          errMsg.hidden = false;
          confirmIn.focus();
          return;
        }

        busy(saveBtn, function () {
          return put('/api/admin/passwords/admin', { current: c, next: n });
        }).then(function () {
          toast('تم تحديث كلمة مرور الإدارة بنجاح وبأمان تام');
          box.close();
        }).catch(function (err) {
          errMsg.textContent = err.message || 'فشل تحديث كلمة المرور. تأكد من صحة كلمة المرور الحالية.';
          errMsg.hidden = false;
        });
      }
    });

    box = overlay([
      h('div', { class: 'pw-modal-header' },
        icon('lock'),
        h('h3', { text: 'تغيير كلمة مرور لوحة الإدارة' })),
      h('p', { class: 'muted small', text: 'لحماية لوحة إدارة المدرسة، يتم التحقق المشفر في الخادم من كلمة المرور الحالية أولاً، ثم تُشفر الكلمة الجديدة بـ 100,000 دورة PBKDF2 لحمايتها ضد أي اختراق.' }),
      errMsg,
      h('div', { class: 'stack' },
        field('كلمة المرور الحالية للإدارة', rowWithEye(curIn), 'أدخل الكلمة الحالية لتأكيد هويتك'),
        field('كلمة المرور الجديدة', rowWithEye(newIn), 'يجب ألا تقل عن 6 أحرف'),
        field('تأكيد كلمة المرور الجديدة', rowWithEye(confirmIn), 'أعد إدخال الكلمة للتأكد من مطابقتها')),
      h('div', { class: 'acts' },
        btn('إلغاء', { on: function () { box.close(); } }),
        saveBtn)
    ]);
    setTimeout(function () { curIn.focus(); }, 60);
  }

  function render() {
    stopAll();
    var parts = location.hash.replace(/^#\/?/, '').split('/');
    document.title = (S.pub.school_name || 'منصة رصد الغياب') + ' | رصد الغياب';
    window.scrollTo(0, 0);

    if (!S.user) {
      if (parts[0] === 'login' && (parts[1] === 'teacher' || parts[1] === 'admin')) {
        return viewLogin(parts[1]);
      }
      return viewHome();
    }

    var isAdmin = S.user.role === 'admin';
    var allTabs = isAdmin ? ADMIN_ALL_TABS : TEACHER_TABS;
    var prefix = isAdmin ? 'a' : 't';
    var tab = parts[0] === prefix && allTabs.some(function (t) { return t[0] === parts[1]; }) ? parts[1] : null;

    if (!tab) {
      history.replaceState(null, '', home());
      tab = allTabs[0][0];
    }

    var views = {
      attendance: viewAttendance,
      daily: viewDaily,
      weekly: viewWeekly,
      monthly: viewMonthly,
      classes: viewClasses,
      teachers: viewTeachers,
      records: viewRecords,
      settings: viewSettings
    };

    var body = h('div');
    mount(app, frame(tab, isAdmin), h('main', { class: 'wrap' }, subNavigation(tab, isAdmin), body, siteFooter()));
    views[tab](body);

    // إذا كان معلماً ولم يسبق له اختيار اسمه، نفتح نافذة الاختيار فوراً
    if (!isAdmin && !S.selectedTeacher) {
      setTimeout(function () { openTeacherSelectorModal(); }, 300);
    }
  }

  /* ---------------------------------------------------------------- 4) الرئيسية والدخول */
  function themeButton() {
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    var tip = isDark ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الداكن';
    return h('button', { type: 'button', class: 'btn icon-btn', title: tip, 'aria-label': tip, 'data-tooltip': tip, onclick: toggleTheme },
      icon(isDark ? 'sun' : 'moon'));
  }
  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    var next = cur === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) {}
    render();
  }

  function siteFooter() {
    var p = S.pub;
    return h('footer', { class: 'site-foot' },
      p.principal_name && h('span', null, icon('user'), ' مدير المدرسة: ', h('b', { class: 'cy', text: p.principal_name })),
      p.developer_credit && h('span', null, icon('code'), ' تطوير وبرمجة: ', h('b', { class: 'gold', text: p.developer_credit })));
  }

  function offlineNote() {
    if (!S.offline) return null;
    return h('div', { class: 'note', role: 'alert' }, h('b', { text: 'الخادم غير متصل. ' }),
      'تعذر الوصول إلى الخادم. تأكد من تشغيل خادم المنصة أو الاتصال بالإنترنت.');
  }

  function viewHome() {
    var p = S.pub;
    mount(app, h('div', { class: 'hero' }, h('div', { class: 'corner' }, themeButton()),
      h('div', { class: 'hero-card' },
        h('span', { class: 'emblem' }, icon('school')),
        offlineNote(),
        h('div', { class: 'badge' }, icon('book'), p.school_name || 'المدرسة'),
        h('h1', { text: 'منصة رصد الغياب الذكية' }),
        h('p', { class: 'lead', text: 'نظام إلكتروني موحد لتتبع حضور وغياب الطلاب بكل دقة وسهولة، مع دعم المواد المتنقلة والتقارير الشهرية الفورية.' }),
        h('div', { class: 'pills' }, p.principal_name && h('div', { class: 'pill' }, icon('user'), ' مدير المدرسة: ', h('b', { text: p.principal_name }))),
        h('div', { class: 'gates' },
          h('a', { class: 'btn primary', href: '#/login/teacher' }, icon('users'), 'بوابة المعلمين'),
          h('a', { class: 'btn', href: '#/login/admin' }, icon('shield'), 'لوحة إدارة المدرسة')),
        p.developer_credit && h('div', { class: 'credit' }, icon('code'), ' تطوير وبرمجة: ', h('b', { text: p.developer_credit })))));
  }

  // شاشة الدخول بكلمة المرور فقط دون أي اسم مستخدم أو بريد
  function viewLogin(gate) {
    var isAdmin = gate === 'admin';
    var pass = h('input', {
      type: 'password',
      autocomplete: 'current-password',
      required: true,
      dir: 'ltr',
      maxlength: '200',
      placeholder: isAdmin ? 'أدخل كلمة مرور الإدارة…' : 'أدخل كلمة مرور المعلمين…'
    });
    var msg = h('p', { class: 'err', role: 'alert' });
    var tsBox = h('div'); var tsToken = '';
    var submit = h('button', { class: 'btn primary block', type: 'submit' }, 'دخول');

    var form = h('form', { onsubmit: function (e) {
      e.preventDefault(); msg.textContent = '';
      busy(submit, function () {
        return post('/api/login', { gate: gate, password: pass.value, turnstile: tsToken })
          .then(function () { S.user = null; return loadMe(); })
          .then(function () { location.hash = home(); render(); });
      }).catch(function (err) {
        msg.textContent = err.message;
        pass.value = '';
        if (window.turnstile && tsBox.firstChild) window.turnstile.reset();
        tsToken = '';
      });
    } },
      field(isAdmin ? 'كلمة مرور الإدارة' : 'كلمة مرور المعلمين', pass, isAdmin ? 'أدخل كلمة المرور المخصصة لإدارة المنصة.' : 'أدخل كلمة المرور الموحدة للمعلمين للوصول إلى لوحة الرصد.'),
      tsBox,
      msg,
      submit);

    mount(app, h('div', { class: 'hero' }, h('div', { class: 'corner' }, themeButton()),
      h('div', { class: 'login-card' },
        h('h2', { text: isAdmin ? 'لوحة إدارة المدرسة' : 'بوابة المعلمين' }),
        h('p', { class: 'muted', text: isAdmin ? 'لوحة التحكم الإدارية، التقارير الشاملة، وإعدادات المنصة.' : 'تسجيل دخول موحد للمعلمين لرصد الحصص والغياب اليومي.' }),
        offlineNote(),
        form,
        h('p', { class: 'small' }, h('a', { href: '#/', text: 'العودة للرئيسية' })),
        siteFooter())));

    pass.focus();
    if (S.pub.turnstile_site_key) loadTurnstile(tsBox, S.pub.turnstile_site_key, function (t) { tsToken = t; });
  }

  function loadTurnstile(box, key, onToken) {
    function draw() { window.turnstile.render(box, { sitekey: key, callback: onToken, 'expired-callback': function () { onToken(''); } }); }
    if (window.turnstile) return draw();
    var s = h('script', { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', async: true, defer: true });
    s.onload = draw; document.head.append(s);
  }

  function logout() {
    post('/api/logout').catch(function () {}).then(function () {
      S.user = null; S.groups = null; location.hash = '#/'; render();
    });
  }

  /* ---------------------------------------------------------------- 5) هيكل الصفحة */
  function frame(tab, isAdmin) {
    var logoutBtn = h('button', {
      class: 'btn icon-btn logout-btn',
      type: 'button',
      title: 'تسجيل الخروج',
      'aria-label': 'تسجيل الخروج',
      'data-tooltip': 'تسجيل الخروج',
      onclick: logout
    }, icon('logout'), h('span', { class: 'logout-text', text: 'خروج' }));

    var navItems;
    if (isAdmin) {
      var currentCat = getAdminCategoryForTab(tab);
      navItems = ADMIN_CATEGORIES.map(function (c) {
        var isCurrentCat = c.id === currentCat.id;
        return h('a', {
          class: 'tab',
          role: 'tab',
          href: '#/a/' + (isCurrentCat ? tab : c.defaultTab),
          'aria-selected': isCurrentCat ? 'true' : 'false'
        }, icon(c.icon), h('span', { text: c.shortLabel }));
      });
    } else {
      navItems = TEACHER_TABS.map(function (t) {
        return h('a', {
          class: 'tab',
          role: 'tab',
          href: '#/t/' + t[0],
          'aria-selected': t[0] === tab ? 'true' : 'false'
        }, icon(t[2]), h('span', { text: t[1] }));
      });
    }

    // شريحة هوية المستخدم في الأعلى
    var userBadge;
    if (isAdmin) {
      userBadge = h('div', { class: 'who-chip' },
        icon('shieldCheck'),
        h('b', { text: 'إدارة المدرسة' }),
        h('span', { class: 'small muted', text: '(تحكم كامل)' }),
        btn('تغيير كلمة المرور', {
          sm: true,
          ic: 'lock',
          title: 'تغيير كلمة مرور الإدارة',
          on: openAdminPasswordModal
        }));
    } else {
      var curTeacherName = S.selectedTeacher || 'اختر اسم المعلم';
      var isChosen = !!S.selectedTeacher;
      userBadge = h('div', { class: 'teacher-select-chip' + (isChosen ? '' : ' highlight') },
        icon('user'),
        h('span', null, 'المعلم: ', h('b', { class: 'teacher-name-label', text: curTeacherName })),
        btn(isChosen ? 'تغيير' : 'اختيار الاسم', {
          sm: true,
          ic: 'edit',
          title: 'تغيير هوية المعلم',
          on: function () { openTeacherSelectorModal(); }
        }));
    }

    return h('div', null,
      h('header', { class: 'topbar' }, h('div', { class: 'wrap' },
        h('div', { class: 'brand' },
          h('div', { class: 'logo' }, icon('school')),
          h('span', { text: S.pub.school_name || 'رصد الغياب' })),
        userBadge,
        h('div', { class: 'topbar-btns' },
          isAdmin && h('button', {
            type: 'button',
            class: 'btn icon-btn',
            title: 'تغيير كلمة مرور الإدارة',
            'aria-label': 'تغيير كلمة مرور الإدارة',
            onclick: openAdminPasswordModal
          }, icon('lock')),
          themeButton(),
          logoutBtn))),
      h('nav', { class: 'tabbar', role: 'tablist', 'aria-label': 'التنقل الرئيسي' }, navItems));
  }

  function groupSelect(kinds, value, onchange) {
    var sel = h('select', { 'aria-label': 'الصف أو المادة', onchange: function () { onchange(sel.value); } },
      h('option', { value: '', text: '— اختر الصف أو المادة —' }));

    var filtered = (S.groups || []).filter(function (g) {
      return kinds.indexOf(g.kind) !== -1;
    });
    var sorted = sortGroupsList(filtered);

    var categoryMap = {};
    var categoryOrder = [];

    sorted.forEach(function (g) {
      var info = getGroupGradeInfo(g);
      var catLabel = info.label;
      if (!categoryMap[catLabel]) {
        categoryMap[catLabel] = [];
        categoryOrder.push(catLabel);
      }
      categoryMap[catLabel].push(g);
    });

    categoryOrder.forEach(function (catLabel) {
      var list = categoryMap[catLabel];
      if (list && list.length) {
        sel.append(h('optgroup', { label: catLabel }, list.map(function (g) {
          return h('option', { value: g.id, text: g.name + ' (' + g.student_count + ')' });
        })));
      }
    });

    sel.value = value || '';
    return sel;
  }
  function periodSelect(value, onchange) {
    var names = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة', 'العاشرة'];
    var count = (S.config && S.config.periods) ? S.config.periods : 8;
    var box = h('div', { class: 'periods', role: 'radiogroup', 'aria-label': 'الحصة' });
    for (var i = 1; i <= count; i++) {
      (function (p) {
        var b = h('button', {
          type: 'button',
          class: 'period',
          role: 'radio',
          'aria-checked': String(p === value),
          onclick: function () {
            box.querySelectorAll('.period').forEach(function (x) { x.setAttribute('aria-checked', 'false'); });
            b.setAttribute('aria-checked', 'true');
            onchange(p);
          }
        }, names[p - 1] || ('الحصة ' + p));
        box.append(b);
      })(i);
    }
    return box;
  }
  function lastSchoolDay(d) { while (isWeekend(d)) d = addDays(d, -1); return d; }
  function printButton() { return btn('طباعة', { ic: 'print', sm: true, on: function () { window.print(); } }); }

  /* ---------------------------------------------------------------- 6) رصد الغياب (المعلم) */
  function viewAttendance(host) {
    var savedGid = '';
    try { savedGid = localStorage.getItem('last_selected_gid') || ''; } catch (e) {}
    var st = { date: lastSchoolDay(S.config.today), period: 1, gid: savedGid, students: [], marks: {}, notes: {}, record: null, loaded: false };
    var minDate = addDays(S.config.today, -S.config.max_backdate_days);
    var out = h('div');
    var dayLabel = h('span', { class: 'muted small' });
    var dateIn = h('input', { type: 'date', value: st.date, min: minDate, max: S.config.today, onchange: function () { st.date = dateIn.value || st.date; load(); } });
    var per = periodSelect(1, function (p) { st.period = p; load(); });
    var grpHolder = h('div');

    function header() {
      dayLabel.textContent = DAYS[dow(st.date)];
    }
    host.append(
      h('div', { class: 'page-head' }, h('h2', { text: 'رصد الحضور' })),
      h('div', { class: 'card picker-panel' },
        h('div', { class: 'picker-row' },
          field('التاريخ', dateIn, null),
          field('الصف أو المادة', grpHolder)),
        h('p', { class: 'small muted day-row' }, 'اليوم: ', dayLabel),
        h('div', { class: 'period-picker' },
          h('span', { class: 'small muted', text: 'الحصة' }),
          per)),
      out);
    loadGroups().then(function (groups) {
      if (savedGid && !groups.some(function (g) { return String(g.id) === String(savedGid); })) {
        st.gid = '';
      }
      mount(grpHolder, groupSelect(['basic', 'mobile'], st.gid, function (v) {
        st.gid = v;
        try { localStorage.setItem('last_selected_gid', v); } catch (e) {}
        load();
      }));
      header();
      if (st.gid) load();
      else mount(out, empty('اختر الصف لعرض الطلاب', 'ثم اختر الحصة وسجّل الغياب والتأخير فقط؛ الباقون يُحسبون حاضرين.'));
    }).catch(fail);

    function counts() {
      var c = { present: 0, absent: 0, late: 0 };
      st.students.forEach(function (s) { c[st.marks[s.id] || 'present']++; });
      return c;
    }
    function load(silent) {
      header();
      if (!st.gid) { mount(out, empty('اختر الصف لعرض الطلاب', 'ثم اختر الحصة وسجّل الغياب والتأخير فقط؛ الباقون يُحسبون حاضرين.')); return; }
      var token = (st.token = {});
      if (!silent) mount(out, skeleton(4));
      Promise.all([
        get('/api/groups/' + st.gid + '/students'),
        get('/api/record?' + qs({ date: st.date, period: st.period, group_id: st.gid }))
      ]).then(function (r) {
        if (st.token !== token) return;
        st.students = r[0].students;
        st.record = r[1].record;
        st.marks = {};
        st.notes = {};
        if (st.record && st.record.entries) {
          st.record.entries.forEach(function (e) {
            st.marks[e.student_id] = e.status;
            st.notes[e.student_id] = e.note;
          });
        }
        paint();
      }).catch(function (e) {
        if (st.token === token) mount(out, h('div', { class: 'note' }, h('b', { text: 'تعذر تحميل البيانات' }), h('p', { text: e.message }), btn('إعادة المحاولة', { sm: true, on: function () { load(); } })));
      });
    }

    function paint() {
      if (!st.students.length) { mount(out, empty('لا يوجد طلاب في هذا الصف', 'تضيف الإدارة الطلاب من لوحة الإدارة.')); return; }
      var isRecorded = !!st.record;
      var canEdit = !isRecorded || !st.record.teacher_name || st.record.teacher_name === S.selectedTeacher || (S.user && S.user.role === 'admin');
      var list = h('ul', { class: 'roll' });
      st.students.forEach(function (s) {
        var cur = st.marks[s.id] || 'present';
        var seg = h('div', { class: 'seg' + (isRecorded ? ' recorded' : ''), role: 'radiogroup', 'aria-label': 'حالة ' + s.name },
          ['present', 'absent', 'late'].map(function (v) {
            return h('button', {
              type: 'button',
              role: 'radio',
              'data-v': v,
              'aria-checked': v === cur ? 'true' : 'false',
              disabled: !canEdit
            }, icon(STATUS[v][1]), STATUS[v][0]);
          }));
        var why = h('input', {
          class: 'why',
          type: 'text',
          maxlength: '200',
          placeholder: 'العذر / ملاحظات',
          'aria-label': 'ملاحظة ' + s.name,
          value: st.notes[s.id] || '',
          hidden: cur === 'present',
          disabled: !canEdit,
          'data-n': s.id
        });
        var seatDisplay = s.number.includes('-') ? s.number.split('-').slice(1).join('-') : s.number;
        list.append(h('li', { 'data-id': s.id, 'data-s': cur },
          h('span', { class: 'num', text: seatDisplay, title: s.number }),
          h('span', { class: 'nm', text: s.name }),
          seg,
          why));
      });
      var cntOk = h('span', { class: 'count ok' }), cntBad = h('span', { class: 'count bad' }), cntLate = h('span', { class: 'count warn' });
      function paintCounts() {
        var c = counts();
        cntOk.textContent = 'حاضر ' + c.present;
        cntBad.textContent = 'غائب ' + c.absent;
        cntLate.textContent = 'متأخر ' + c.late;
      }
      paintCounts();

      var weekendAlert = isWeekend(st.date) ? h('div', { class: 'note warn', text: 'تنبيه: التاريخ المحدد يصادف عطلة أسبوعية.' }) : null;
      var banner = null;
      if (isRecorded) {
        banner = h('div', { class: 'note ' + (canEdit ? 'ok' : 'info') },
          h('b', { text: canEdit ? '✓ تم حفظ رصد هذه الحصة' : 'مغلق: رُصدت هذه الحصة سابقاً' }),
          h('p', { text: canEdit
            ? ('رُصدت باسم «' + st.record.teacher_name + '». يمكنك تعديل أي حالة ثم الضغط على «تحديث الرصد».')
            : ('رصدها الأستاذ «' + st.record.teacher_name + '». للتعديل تواصل مع الإدارة.') }));
      }

      var save = btn(isRecorded ? 'تحديث الرصد' : 'حفظ الرصد', {
        kind: 'primary',
        ic: 'check',
        type: 'button',
        disabled: !canEdit
      });
      save.onclick = function () {
        if (!S.selectedTeacher) {
          openTeacherSelectorModal(function () { save.click(); });
          return;
        }
        var c = counts();
        var confirmMsg = isRecorded
          ? ('تحديث رصد الحصة باسم «' + S.selectedTeacher + '»؟ غائب: ' + c.absent + '، متأخر: ' + c.late + '، حاضر: ' + c.present + '.')
          : ('حفظ رصد الحصة باسم «' + S.selectedTeacher + '»؟ غائب: ' + c.absent + '، متأخر: ' + c.late + '، حاضر: ' + c.present + '.');
        confirmBox(isRecorded ? 'تأكيد تحديث الرصد' : 'تأكيد حفظ الرصد', confirmMsg, isRecorded ? 'تحديث' : 'حفظ').then(function (ok) {
          if (!ok) return;
          var entries = st.students.filter(function (s) { return (st.marks[s.id] || 'present') !== 'present'; })
            .map(function (s) { return { student_id: s.id, status: st.marks[s.id], note: st.notes[s.id] || '' }; });
          busy(save, function () {
            return post('/api/record', {
              date: st.date,
              period: st.period,
              group_id: Number(st.gid),
              teacher_name: S.selectedTeacher,
              entries: entries
            });
          }).then(function () {
            toast(isRecorded ? 'تم تحديث الرصد بنجاح' : 'تم حفظ الرصد بنجاح');
            st.record = {
              id: (st.record && st.record.id) || 1,
              teacher_name: S.selectedTeacher,
              created_at: Date.now(),
              entries: entries
            };
            paint();
            load(true);
          }).catch(fail);
        });
      };

      mount(out, weekendAlert, banner, list,
        h('div', { class: 'savebar' },
          h('div', { class: 'counts' }, cntOk, cntBad, cntLate),
          canEdit ? save : null));

      if (canEdit) {
        list.addEventListener('click', function (e) {
          var b = e.target.closest('button[data-v]'); if (!b) return;
          var li = b.closest('li'); var id = Number(li.getAttribute('data-id')); var v = b.getAttribute('data-v');
          st.marks[id] = v; li.setAttribute('data-s', v);
          li.querySelectorAll('button[data-v]').forEach(function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
          var note = li.querySelector('input'); note.hidden = v === 'present';
          if (v !== 'present') note.focus();
          paintCounts();
        });
        list.addEventListener('input', function (e) {
          if (e.target.hasAttribute('data-n')) {
            st.notes[Number(e.target.getAttribute('data-n'))] = e.target.value;
          }
        });
      }
    }

    poll(function () {
      if (st.gid && !st.record) {
        get('/api/record?' + qs({ date: st.date, period: st.period, group_id: st.gid })).then(function (r) {
          if (r.record && !st.record) {
            toast('رصد معلم آخر هذه الحصة للتو، تم تحديث الصفحة');
            load(true);
          }
        }).catch(function () {});
      }
    }, 15000);
  }

  /* ---------------------------------------------------------------- 7) التقارير */
  function viewDaily(host) {
    var date = lastSchoolDay(S.config.today);
    var gid = '';
    var out = h('div');
    var dateIn = h('input', { type: 'date', value: date, onchange: function () { date = dateIn.value || date; load(); } });
    var grpHolder = h('div');

    host.append(
      h('div', { class: 'page-head' }, h('h2', { text: 'التقرير اليومي' }), printButton()),
      h('div', { class: 'card noprint' },
        h('div', { class: 'grid' }, field('التاريخ', dateIn), field('الصف الأساسي', grpHolder))),
      out);

    loadGroups().then(function (groups) {
      var basic = groups.filter(function (g) { return g.kind === 'basic'; });
      if (basic.length && !gid) gid = String(basic[0].id);
      mount(grpHolder, groupSelect(['basic'], gid, function (v) { gid = v; load(); }));
      load();
    }).catch(fail);

    function load() {
      if (!gid) { mount(out, empty('اختر الصف لعرض التقرير')); return; }
      mount(out, skeleton(4));
      get('/api/reports/daily?' + qs({ date: date, group_id: gid })).then(function (r) {
        var t = h('table');
        var headRow = h('tr', null, h('th', { text: 'م' }), h('th', { text: 'الرقم' }), h('th', { text: 'اسم الطالب' }));
        for (var p = 1; p <= r.periods_count; p++) {
          var tchr = r.teachers_by_period[p];
          headRow.append(h('th', { class: 'period-th' + (tchr ? ' has-teacher' : ''), title: tchr ? ('رصد: ' + tchr) : 'لم ترصد' },
            h('div', { class: 'period-th-wrap' },
              tchr
                ? h('span', { class: 'period-th-teacher', text: tchr, title: tchr })
                : h('span', { class: 'period-th-empty' }),
              h('span', { class: 'period-th-num', text: 'ح' + p })
            )
          ));
        }
        headRow.append(h('th', { text: 'المواد المتنقلة' }));
        t.append(h('thead', null, headRow));
        var tbody = h('tbody');
        r.students.forEach(function (s, idx) {
          var row = h('tr', null, h('td', { text: idx + 1 }), h('td', null, ltr(s.number)), h('td', null, h('b', { text: s.name })));
          for (var pi = 1; pi <= r.periods_count; pi++) {
            var ent = s.periods[pi];
            var isPeriodRecorded = !!(r.teachers_by_period && r.teachers_by_period[pi]);
            var cellContent = ent ? stamp(ent.status) : (isPeriodRecorded ? stamp('present') : '—');
            row.append(h('td', { class: 'center' }, cellContent));
          }
          var mob = s.mobile.map(function (m) { return m.group_name + ' (ح' + m.period + '): ' + STATUS[m.status][0]; }).join(' • ');
          row.append(h('td', { class: 'small' }, mob || '—'));
          tbody.append(row);
        });
        t.append(tbody);
        mount(out, h('div', { class: 'card' },
          h('div', { class: 'print-head' }, h('h3', { text: (S.pub.school_name || '') + ' — كشف الغياب اليومي' }),
            h('p', { class: 'muted' }, 'الصف: ' + r.group.name + ' | التاريخ: ' + r.date + ' (' + DAYS[dow(r.date)] + ')')),
          h('div', { class: 't-wrap' }, t)));
      }).catch(fail);
    }
  }

  function viewWeekly(host) {
    var date = S.config.today;
    var out = h('div');
    var dateIn = h('input', { type: 'date', value: date, onchange: function () { date = dateIn.value || date; load(); } });
    host.append(
      h('div', { class: 'page-head' }, h('h2', { text: 'نشاط وإحصائيات المعلمين الأسبوعية' }), printButton()),
      h('div', { class: 'card noprint' }, field('اختر أي يوم ضمن الأسبوع المطلوب', dateIn)),
      out);
    function load() {
      mount(out, skeleton(4));
      get('/api/reports/weekly?' + qs({ date: date })).then(function (r) {
        mount(out, h('div', { class: 'card' },
          h('h3', { text: 'إجمالي الحصص المرصودة خلال الأسبوع: ' + r.total }),
          h('p', { class: 'muted small' }, 'من ' + r.from + ' إلى ' + r.to),
          h('div', { class: 't-wrap' }, h('table', null,
            h('thead', null, h('tr', null, h('th', { text: 'المعلم' }), h('th', { text: 'عدد الحصص المرصودة' }), h('th', { text: 'النسبة' }))),
            h('tbody', null, r.teachers.map(function (t) {
              return h('tr', null, h('td', null, h('b', { text: t.name })), h('td', { text: t.sessions }), h('td', null, t.percent + '%'));
            }))))));
      }).catch(fail);
    }
    load();
  }

  function viewMonthly(host) {
    var curMonth = S.config.today.slice(0, 7);
    var gid = '';
    var out = h('div');
    var monthIn = h('input', { type: 'month', value: curMonth, onchange: function () { curMonth = monthIn.value || curMonth; load(); } });
    var grpHolder = h('div');

    host.append(
      h('div', { class: 'page-head' }, h('h2', { text: 'التقرير الشهري ومتابعة الغياب' }), printButton()),
      h('div', { class: 'card noprint' },
        h('div', { class: 'grid' }, field('الشهر', monthIn), field('الصف الأساسي', grpHolder))),
      out);

    loadGroups().then(function (groups) {
      var basic = groups.filter(function (g) { return g.kind === 'basic'; });
      if (basic.length && !gid) gid = String(basic[0].id);
      mount(grpHolder, groupSelect(['basic'], gid, function (v) { gid = v; load(); }));
      load();
    }).catch(fail);

    function load() {
      if (!gid) { mount(out, empty('اختر الصف لعرض التقرير')); return; }
      mount(out, skeleton(4));
      get('/api/admin/reports/monthly?' + qs({ month: curMonth, group_id: gid })).then(function (r) {
        mount(out, h('div', { class: 'card' },
          h('h3', { text: 'كشف متابعة الغياب لشهر: ' + r.month + ' (' + r.group.name + ')' }),
          h('p', { class: 'muted small' }, 'إجمالي أيام الغياب: ' + r.totals.absence_days + ' يوم | الطلاب الذين بلغوا حد الإنذار: ' + r.students.length),
          h('div', { class: 't-wrap' }, h('table', null,
            h('thead', null, h('tr', null, h('th', { text: 'الرقم' }), h('th', { text: 'اسم الطالب' }), h('th', { text: 'أيام الغياب' }), h('th', { text: 'الإجراء المستحق' }))),
            h('tbody', null, r.students.map(function (s) {
              return h('tr', null,
                h('td', null, ltr(s.number)),
                h('td', null, h('b', { text: s.name })),
                h('td', { class: 'count bad' }, s.absence_days),
                h('td', null, s.action ? h('span', { class: 'badge', style: 'color:' + s.action.color + ';border-color:' + s.action.color, text: s.action.label }) : '—'));
            }))))));
      }).catch(fail);
    }
  }

  /* ---------------------------------------------------------------- 8) لوحة الإدارة */
  function viewClasses(host) {
    var nameIn = h('input', { type: 'text', placeholder: 'مثال: التاسع / 1 أو فيزياء متنقلة' });
    var kindSel = h('select', null, h('option', { value: 'basic', text: 'صف أساسي' }), h('option', { value: 'mobile', text: 'مادة متنقلة' }));
    var addBtn = btn('إضافة الصف', { kind: 'primary', ic: 'plus' });
    var list = h('div', { class: 'grid' });
    var studentsPanel = h('div');

    addBtn.onclick = function () {
      var n = nameIn.value.trim();
      if (!n) return toast('اكتب اسم الصف', true);
      busy(addBtn, function () { return post('/api/admin/groups', { name: n, kind: kindSel.value }); })
        .then(function () { nameIn.value = ''; toast('تمت إضافة الصف'); loadGroups(true).then(paint).catch(fail); }).catch(fail);
    };

    function paint(groups) {
      mount(list, groups.map(function (g) {
        return h('div', { class: 'card' },
          h('div', { class: 'row between' },
            h('b', { text: g.name }),
            h('span', { class: 'badge', text: g.kind === 'basic' ? 'أساسي' : 'متنقل' })),
          h('p', { class: 'muted small' }, 'عدد الطلاب: ' + g.student_count),
          h('div', { class: 'row end' },
            btn('إدارة الطلاب', { sm: true, on: function () { openStudentsModal(g); } }),
            btn('حذف الصف', { sm: true, kind: 'danger', ic: 'trash', on: function () {
              confirmBox('حذف الصف؟', 'سيُحذف صف «' + g.name + '» وجميع تسجيلات طلابه.', 'حذف نهائي', true).then(function (ok) {
                if (ok) api('DELETE', '/api/admin/groups/' + g.id).then(function () { toast('تم حذف الصف'); loadGroups(true).then(paint).catch(fail); }).catch(fail);
              });
            } })));
      }));
    }

    function openStudentsModal(g) {
      get('/api/groups/' + g.id + '/students').then(function (r) {
        function calcNextNum() {
          var maxNum = 0;
          (r.students || []).forEach(function (s) {
            var val = parseInt(s.number, 10);
            if (!isNaN(val) && val > maxNum) maxNum = val;
          });
          return String(maxNum > 0 ? maxNum + 1 : ((r.students ? r.students.length : 0) + 1));
        }

        var numIn = h('input', { type: 'text', placeholder: 'رقم الطالب', value: calcNextNum() });
        var nameIn = h('input', { type: 'text', placeholder: 'اسم الطالب' });
        var addOne = btn('إضافة طالب', { sm: true, kind: 'primary', ic: 'plus' });
        var rowsHost = h('div', { class: 't-wrap' });

        function drawRows() {
          mount(rowsHost, h('table', null,
            h('thead', null, h('tr', null, h('th', { text: 'الرقم' }), h('th', { text: 'الاسم' }), h('th', { text: 'تعديل' }), h('th', { text: 'حذف' }))),
            h('tbody', null, (r.students || []).map(function (s) {
              return h('tr', null,
                h('td', null, ltr(s.number)),
                h('td', null, h('b', { text: s.name })),
                h('td', null, btn('تعديل', { sm: true, ic: 'sparkles', on: function () {
                  var editNum = h('input', { type: 'text', value: s.number, placeholder: 'الرقم الجديد' });
                  var editName = h('input', { type: 'text', value: s.name, placeholder: 'الاسم الجديد' });
                  var saveEdit = btn('حفظ التعديل', { sm: true, kind: 'primary', on: function () {
                    var nextN = editNum.value.trim();
                    var nextNm = editName.value.trim();
                    if (!nextN || !nextNm) return toast('يرجى كتابة الرقم والاسم', true);
                    busy(saveEdit, function () {
                      return api('PUT', '/api/admin/groups/' + g.id + '/students/' + s.id, { number: nextN, name: nextNm });
                    }).then(function () {
                      s.number = nextN;
                      s.name = nextNm;
                      r.students.sort(function (a, b) { return (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0); });
                      drawRows();
                      numIn.value = calcNextNum();
                      editBox.close();
                      toast('تم تعديل بيانات الطالب بنجاح');
                    }).catch(fail);
                  } });
                  var editBox = overlay([
                    h('h3', { text: 'تعديل بيانات الطالب في «' + g.name + '»' }),
                    h('div', { class: 'grid', style: 'margin: 14px 0;' }, field('الرقم في الصف', editNum), field('اسم الطالب', editName)),
                    h('div', { class: 'acts' }, btn('إلغاء', { on: function () { editBox.close(); } }), saveEdit)
                  ]);
                } })),
                h('td', null, btn('حذف', { sm: true, kind: 'danger', ic: 'trash', on: function () {
                  confirmBox('حذف الطالب؟', 'سيُحذف «' + s.name + '» من صف «' + g.name + '».', 'حذف', true).then(function (ok) {
                    if (ok) api('DELETE', '/api/admin/groups/' + g.id + '/students/' + s.id).then(function () {
                      r.students = r.students.filter(function (x) { return x.id !== s.id; });
                      drawRows();
                      numIn.value = calcNextNum();
                      loadGroups(true).then(paint).catch(fail);
                    }).catch(fail);
                  });
                } })));
            }))));
        }

        addOne.onclick = function () {
          var num = numIn.value.trim(); var nm = nameIn.value.trim();
          if (!num || !nm) return toast('اكتب رقم الطالب واسمه', true);
          busy(addOne, function () { return post('/api/admin/groups/' + g.id + '/students', { students: [{ number: num, name: nm }] }); })
            .then(function () {
              toast('تمت إضافة الطالب بنجاح'); nameIn.value = '';
              get('/api/groups/' + g.id + '/students').then(function (res) {
                r.students = res.students;
                drawRows();
                numIn.value = calcNextNum();
                nameIn.focus();
                loadGroups(true).then(paint).catch(fail);
              });
            }).catch(fail);
        };

        drawRows();
        overlay([
          h('h3', { text: 'إدارة طلاب: ' + g.name }),
          h('div', { class: 'grid', style: 'margin: 14px 0;' }, field('رقم الطالب', numIn), field('اسم الطالب', nameIn)),
          h('div', { class: 'row end', style: 'margin-bottom: 14px;' }, addOne),
          rowsHost,
          h('div', { class: 'acts' }, btn('إغلاق', { on: function () { document.querySelector('.overlay')?.remove(); } }))
        ]);
      }).catch(fail);
    }

    host.append(
      h('div', { class: 'card' },
        h('h2', { text: 'إضافة صف أو مادة متنقلة' }),
        h('div', { class: 'grid' }, field('اسم الصف / المادة', nameIn), field('نوع الصف', kindSel)),
        h('div', { class: 'row end' }, addBtn)),
      h('div', { class: 'page-head' }, h('h3', { text: 'قائمة الصفوف' })),
      list);

    loadGroups().then(paint).catch(fail);
  }

  // إدارة المعلمين والتحكم بكلمات المرور في لوحة الإدارة
  function viewTeachers(host) {
    var pwCard = h('div', { class: 'pw-card' });
    var adminPwCard = h('div', { class: 'card' });
    var rosterCard = h('div', { class: 'card' });
    var teachersRoster = [];

    // 1) بطاقة التحكم بكلمة مرور المعلمين
    function paintTeacherPwControl() {
      mount(pwCard, skeleton(3));
      get('/api/admin/passwords').then(function (res) {
        var pw = res.teacher_password || '';
        var isMasked = true;
        var pwSpan = h('span', { class: 'pw-val', text: '••••••••••••' });
        var toggleMaskBtn = btn('إظهار', { sm: true, ic: 'eye', on: function () {
          isMasked = !isMasked;
          pwSpan.textContent = isMasked ? '••••••••••••' : pw;
          toggleMaskBtn.textContent = isMasked ? 'إظهار' : 'إخفاء';
        } });
        var copyBtn = btn('نسخ كلمة المرور', { sm: true, ic: 'copy', kind: 'primary', on: function () {
          copyText(pw, 'تم نسخ كلمة مرور المعلمين: ' + pw);
        } });

        var genBtn = btn('توليد كلمة مرور عشوائية جديدة', { sm: true, ic: 'sparkles', on: function () {
          confirmBox('توليد كلمة مرور عشوائية جديدة للمعلمين؟', 'سيتم توليد كلمة مرور جديدة فوراً وإنهاء الجلسات الحالية للمعلمين لضمان الأمان.', 'توليد وتحديث').then(function (ok) {
            if (!ok) return;
            busy(genBtn, function () { return put('/api/admin/passwords/teacher', { generate: true }); })
              .then(function (upRes) {
                toast('تم توليد وتحديث كلمة المرور للمعلمين بنجاح');
                paintTeacherPwControl();
              }).catch(fail);
          });
        } });

        var customPwIn = h('input', { type: 'text', dir: 'ltr', placeholder: 'اكتب كلمة مرور مخصصة (6 أحرف فأكثر)…' });
        var saveCustomBtn = btn('حفظ المخصصة', { sm: true, on: function () {
          var val = customPwIn.value.trim();
          if (val.length < 4) return toast('كلمة المرور يجب ألا تقل عن 4 أحرف', true);
          busy(saveCustomBtn, function () { return put('/api/admin/passwords/teacher', { password: val }); })
            .then(function () {
              toast('تم تحديث كلمة مرور المعلمين بنجاح');
              customPwIn.value = '';
              paintTeacherPwControl();
            }).catch(fail);
        } });

        mount(pwCard,
          h('div', { class: 'row between' },
            h('h2', { text: 'كلمة مرور بوابة المعلمين (الموحدة)' }),
            h('span', { class: 'badge accent', text: 'دخول موحد' })),
          h('p', { class: 'muted small', text: 'يستخدم جميع المعلمين هذه الكلمة للدخول إلى بوابة المعلمين واختيار أسمائهم من القائمة. عند تغيير الكلمة تنتهي جلسات المعلمين السابقة فوراً لضمان الأمان.' }),
          h('div', { class: 'pw-display-box' },
            pwSpan,
            h('div', { class: 'row' }, toggleMaskBtn, copyBtn)),
          h('div', { class: 'row', style: 'margin-top: 14px; flex-wrap: wrap;' },
            genBtn,
            h('div', { class: 'grow row', style: 'margin-inline-start: 12px;' },
              customPwIn, saveCustomBtn)));
      }).catch(fail);
    }

    // 2) بطاقة تغيير كلمة مرور الإدارة
    function paintAdminPwChange() {
      var curIn = h('input', { type: 'password', dir: 'ltr', required: true, autocomplete: 'current-password', placeholder: 'أدخل كلمة المرور الحالية للإدارة' });
      var newIn = h('input', { type: 'password', dir: 'ltr', required: true, minlength: '6', autocomplete: 'new-password', placeholder: 'أدخل كلمة المرور الجديدة (6 أحرف فأكثر)' });
      var confirmIn = h('input', { type: 'password', dir: 'ltr', required: true, minlength: '6', autocomplete: 'new-password', placeholder: 'أعد إدخال كلمة المرور الجديدة' });
      var saveBtn = btn('تحديث كلمة مرور الإدارة', { kind: 'primary', ic: 'check' });

      function rowWithEye(inputEl) {
        var eyeBtn = h('button', {
          type: 'button',
          class: 'btn icon-btn',
          title: 'إظهار / إخفاء',
          'aria-label': 'إظهار أو إخفاء كلمة المرور',
          onclick: function () {
            inputEl.type = inputEl.type === 'text' ? 'password' : 'text';
          }
        }, icon('eye'));
        return h('div', { class: 'pw-input-wrap' }, inputEl, eyeBtn);
      }

      saveBtn.onclick = function () {
        var c = curIn.value.trim(); var n = newIn.value.trim(); var cf = confirmIn.value.trim();
        if (!c) return toast('اكتب كلمة المرور الحالية', true);
        if (n.length < 6) return toast('كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف', true);
        if (n === c) return toast('كلمة المرور الجديدة يجب أن تختلف عن الحالية', true);
        if (n !== cf) return toast('كلمتا المرور الجديدتان غير متطابقتين', true);
        busy(saveBtn, function () { return put('/api/admin/passwords/admin', { current: c, next: n }); })
          .then(function () {
            toast('تم تحديث كلمة مرور الإدارة بنجاح وبأمان تام');
            curIn.value = ''; newIn.value = ''; confirmIn.value = '';
          }).catch(fail);
      };

      mount(adminPwCard,
        h('h2', { text: 'تغيير كلمة مرور لوحة الإدارة' }),
        h('p', { class: 'muted small', text: 'يتم التحقق المشفر من كلمة المرور الحالية في الخادم، وتُشفر الكلمة الجديدة فوراً بأعلى معايير الأمان (PBKDF2).' }),
        h('div', { class: 'stack' },
          field('كلمة المرور الحالية', rowWithEye(curIn)),
          h('div', { class: 'grid' },
            field('كلمة المرور الجديدة', rowWithEye(newIn)),
            field('تأكيد كلمة المرور الجديدة', rowWithEye(confirmIn))),
          h('div', { class: 'row end' }, saveBtn)));
    }

    // 3) بطاقة دليل وقائمة المعلمين
    function paintTeachersRoster() {
      var searchIn = h('input', { type: 'search', placeholder: 'ابحث بالاسم في دليل المعلمين…', 'aria-label': 'بحث في دليل المعلمين' });
      var countSpan = h('span', { class: 'badge', text: 'عدد المعلمين: 0' });
      var tableHost = h('div', { class: 't-wrap' });

      var singleNameIn = h('input', { type: 'text', placeholder: 'مثال: الأستاذ محمد بن سعيد السعدي' });
      var addSingleBtn = btn('إضافة معلم', { sm: true, kind: 'primary', ic: 'plus' });

      addSingleBtn.onclick = function () {
        var n = singleNameIn.value.trim();
        if (!n) return toast('اكتب اسم المعلم أولاً', true);
        busy(addSingleBtn, function () { return post('/api/admin/teachers', { name: n }); })
          .then(function () {
            toast('تمت إضافة المعلم «' + n + '» بنجاح');
            singleNameIn.value = '';
            loadRoster();
          }).catch(fail);
      };

      var bulkText = h('textarea', { placeholder: 'لصق قائمة أسماء المعلمين (اسم في كل سطر)', rows: '4' });
      var addBulkBtn = btn('إضافة القائمة', { sm: true, kind: 'primary', ic: 'plus' });

      addBulkBtn.onclick = function () {
        var lines = bulkText.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        if (!lines.length) return toast('اكتب أسماء المعلمين', true);
        busy(addBulkBtn, function () { return post('/api/admin/teachers', { names: lines }); })
          .then(function (res) {
            toast('تمت إضافة ' + (res.created ? res.created.length : lines.length) + ' معلماً بنجاح');
            bulkText.value = '';
            loadRoster();
          }).catch(fail);
      };

      function renderTable() {
        var q = searchIn.value.trim().toLowerCase();
        var hits = teachersRoster.filter(function (t) {
          return !q || t.name.toLowerCase().indexOf(q) >= 0;
        });
        countSpan.textContent = 'عدد المعلمين: ' + teachersRoster.length;

        mount(tableHost, hits.length ? h('table', null,
          h('thead', null, h('tr', null, h('th', { text: '#' }), h('th', { text: 'اسم المعلم' }), h('th', { text: 'تاريخ الإضافة' }), h('th', { text: 'حذف' }))),
          h('tbody', null, hits.map(function (t, i) {
            var dateStr = t.created_at ? new Date(t.created_at).toLocaleDateString('ar-OM') : '—';
            return h('tr', null,
              h('td', null, i + 1),
              h('td', null, h('b', { text: t.name })),
              h('td', { class: 'small muted' }, dateStr),
              h('td', null, btn('حذف', { sm: true, kind: 'danger', ic: 'trash', on: function () {
                confirmBox('حذف المعلم من الدليل؟', 'سيُحذف المعلم «' + t.name + '» من قائمة الاختيار في المنصة.', 'حذف', true).then(function (ok) {
                  if (ok) api('DELETE', '/api/admin/teachers/' + t.id).then(function () {
                    toast('تم حذف المعلم');
                    loadRoster();
                  }).catch(fail);
                });
              } })));
          }))) : empty('لا يوجد معلمون مطابقون للبحث'));
      }

      function loadRoster() {
        get('/api/admin/teachers').then(function (res) {
          teachersRoster = res.teachers || [];
          S.teachersList = teachersRoster;
          renderTable();
        }).catch(fail);
      }

      searchIn.addEventListener('input', renderTable);

      mount(rosterCard,
        h('div', { class: 'row between' },
          h('h2', { text: 'دليل وقائمة المعلمين في المدرسة' }),
          countSpan),
        h('p', { class: 'muted small', text: 'تظهر هذه الأسماء للمعلمين عند اختيار هويتهم في بوابة المعلمين.' }),
        h('div', { class: 'grid', style: 'margin: 14px 0;' },
          field('إضافة معلم واحد', h('div', { class: 'row' }, h('div', { class: 'grow' }, singleNameIn), addSingleBtn)),
          field('إضافة دفعة معلمين (اسم في كل سطر)', h('div', { class: 'stack' }, bulkText, h('div', { class: 'row end' }, addBulkBtn)))),
        h('div', { style: 'margin: 12px 0;' }, searchIn),
        tableHost);

      loadRoster();
    }

    paintTeacherPwControl();
    paintAdminPwChange();
    paintTeachersRoster();

    host.append(pwCard, adminPwCard, rosterCard);
  }

  function viewRecords(host) {
    var date = S.config.today;
    var out = h('div');
    var dateIn = h('input', { type: 'date', value: date, onchange: function () { date = dateIn.value || date; load(); } });
    host.append(h('div', { class: 'card' },
      h('h2', null, h('span', { text: 'سجلات الحصص والرصد' }), icon('check')),
      field('التاريخ', dateIn, 'احذف سجل حصة ليتمكن المعلم من رصدها من جديد.')), out);
    function load() {
      get('/api/admin/records?' + qs({ date: date })).then(function (r) {
        mount(out, h('div', { class: 'card' }, r.records.length ? r.records.map(function (x) {
          return h('div', { class: 'list-row' }, h('b', { text: 'الحصة ' + x.period }), h('span', { class: 'grow', text: x.group_name + ' — ' + x.teacher_name }),
            h('span', { class: 'count bad', text: 'غائب ' + (x.absent || 0) }), h('span', { class: 'count warn', text: 'متأخر ' + (x.late || 0) }),
            btn('حذف', { sm: true, kind: 'danger', ic: 'trash', on: function () {
              confirmBox('حذف سجل الحصة؟', x.group_name + ' — الحصة ' + x.period + ' (' + x.teacher_name + ')', 'حذف', true).then(function (ok) {
                if (ok) api('DELETE', '/api/admin/records/' + x.id).then(function () { toast('تم الحذف'); load(); }).catch(fail);
              });
            } }));
        }) : empty('لا توجد حصص مرصودة في هذا اليوم')));
      }).catch(fail);
    }
    load();
  }

  function viewSettings(host) {
    var school = h('input', { type: 'text', maxlength: '120', value: S.pub.school_name || '' });
    var principal = h('input', { type: 'text', maxlength: '120', value: S.pub.principal_name || '' });
    var dev = h('input', { type: 'text', maxlength: '120', value: S.pub.developer_credit || '' });
    var saveInfo = btn('حفظ', { kind: 'primary', ic: 'check' });
    saveInfo.onclick = function () {
      busy(saveInfo, function () { return api('PUT', '/api/admin/settings', { school_name: school.value, principal_name: principal.value, developer_credit: dev.value }); })
        .then(function () { S.pub.school_name = school.value; S.pub.principal_name = principal.value; S.pub.developer_credit = dev.value; document.title = school.value; toast('تم الحفظ'); }).catch(fail);
    };
    var rules = S.rules.map(function (r) { return { min_days: r.min_days, label: r.label, color: r.color }; });
    var rulesBox = h('div');
    function paintRules() {
      mount(rulesBox, rules.map(function (r, i) {
        return h('div', { class: 'rule-row' },
          h('input', { type: 'number', min: '1', max: '365', value: r.min_days, 'aria-label': 'عدد الأيام', oninput: function (e) { r.min_days = Number(e.target.value); } }),
          h('input', { class: 'lbl', type: 'text', maxlength: '80', value: r.label, 'aria-label': 'الإجراء', oninput: function (e) { r.label = e.target.value; } }),
          h('input', { type: 'color', value: r.color, 'aria-label': 'اللون', oninput: function (e) { r.color = e.target.value; } }),
          h('button', { class: 'btn icon-btn danger', type: 'button', 'aria-label': 'حذف القاعدة', title: 'حذف هذه القاعدة', 'data-tooltip': 'حذف هذه القاعدة', onclick: function () { rules.splice(i, 1); paintRules(); } }, icon('trash')));
      }));
    }
    paintRules();
    var saveRules = btn('حفظ اللائحة', { kind: 'primary', ic: 'check' });
    saveRules.onclick = function () {
      busy(saveRules, function () { return api('PUT', '/api/admin/rules', { rules: rules }); })
        .then(function () { return loadMe(); }).then(function () { toast('تم حفظ اللائحة'); }).catch(fail);
    };

    var auditBox = h('div');
    var auditBtn = btn('عرض آخر العمليات', { sm: true, on: function () {
      mount(auditBox, skeleton(3));
      get('/api/admin/audit').then(function (r) {
        mount(auditBox, h('div', { class: 't-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: 'الوقت' }), h('th', { text: 'المنفّذ' }), h('th', { text: 'العملية' }), h('th', { text: 'التفاصيل' }))),
          h('tbody', null, r.entries.map(function (e) { return h('tr', null, h('td', null, ltr(new Date(e.at).toLocaleString('en-GB', { timeZone: S.config.timezone }))), h('td', { text: e.actor }), h('td', { text: e.action }), h('td', { class: 'small', text: e.details })); })))));
      }).catch(fail);
    } });
    host.append(
      h('div', { class: 'card' },
        h('div', { class: 'row between' },
          h('h2', { text: 'أمان لوحة الإدارة وكلمة المرور' }),
          icon('lock')),
        h('p', { class: 'muted small', text: 'يمكنك تغيير وتحديث كلمة مرور لوحة إدارة المدرسة في أي وقت بأمان تام وتشفير PBKDF2 عالي الحماية.' }),
        h('div', { class: 'row' },
          btn('تغيير كلمة مرور الإدارة الآن', {
            kind: 'primary',
            ic: 'lock',
            on: openAdminPasswordModal
          }))),
      h('div', { class: 'card' }, h('h2', { text: 'بيانات المدرسة' }), h('div', { class: 'stack' }, field('اسم المدرسة', school), field('مدير المدرسة', principal), field('حقوق التطوير والبرمجة', dev), h('div', { class: 'row end' }, saveInfo))),
      h('div', { class: 'card' }, h('h2', { text: 'لائحة الإجراءات حسب أيام الغياب' }), h('p', { class: 'muted small', text: 'يُطبَّق أعلى إجراء بلغه الطالب خلال الشهر. أقل رقم هنا هو حد ظهور الطالب في التقرير الشهري.' }), rulesBox,
        h('div', { class: 'row' }, btn('إضافة قاعدة', { sm: true, ic: 'plus', on: function () { rules.push({ min_days: 1, label: '', color: '#06b6d4' }); paintRules(); } }), saveRules)),
      h('div', { class: 'card' }, h('h2', { text: 'سجل العمليات' }), h('div', { class: 'stack' }, auditBtn, auditBox)));
  }

  /* ---------------------------------------------------------------- 9) التشغيل */
  window.addEventListener('hashchange', render);
  try { var saved = localStorage.getItem('theme'); if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved); } catch (e) {}
  var DEFAULT_PUB = { school_name: 'مدرسة حفص بن راشد', principal_name: 'الأستاذ طلال الهنائي', developer_credit: 'الأستاذ منير الصالحي' };
  Promise.all([get('/api/public').catch(function () { return null; }), loadMe().catch(function () { return null; })]).then(function (r) {
    S.offline = !r[0]; S.pub = r[0] || DEFAULT_PUB; render();
  });
})();
