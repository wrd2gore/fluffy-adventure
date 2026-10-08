/* =============================================================================
   منصة رصد الغياب — الواجهة (ملف واحد)
   لا يُستخدم HTML خام في أي مكان: كل النصوص تُدرج بـ textContent فلا يمكن لأي بيانات أن تتحول إلى كود.
   فهرس الملف:
    1) أدوات DOM والأيقونات والرسائل   2) الاتصال بالخادم   3) الحالة والمسارات
    4) الرئيسية وتسجيل الدخول وتغيير كلمة المرور   5) هيكل الصفحة (ترويسة + تبويبات)
    6) رصد الغياب (المعلم)   7) التقارير (يومي/أسبوعي/شهري)
    8) لوحة الإدارة: الصفوف، المعلمون، السجلات، الإعدادات   9) التشغيل
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
    google: 'M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z',
    info: 'M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20zm0-2a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm-1-5h2v2h-2v-2zm0-8h2v6h-2V7z'
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
  function infoBox(title, content) {
    var box = overlay([h('h3', { text: title }), content, h('div', { class: 'acts' }, btn('إغلاق', { kind: 'primary', on: function () { box.close(); } }))]);
    return box;
  }
  function busy(button, fn) {
    button.disabled = true;
    return Promise.resolve().then(fn).then(function (r) { button.disabled = false; return r; }, function (e) { button.disabled = false; throw e; });
  }
  var fail = function (e) { toast((e && e.message) || 'حدث خطأ', true); };
  var empty = function (t, hint) { return h('div', { class: 'empty' }, h('b', { text: t }), hint && h('span', { text: hint })); };
  var skeleton = function (n) { var d = h('div', { 'aria-hidden': 'true' }); for (var i = 0; i < (n || 3); i++) d.append(h('div', { class: 'skel' })); return d; };
  function newRandomPassword(len) {
    len = len || 10;
    var alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    var out = '';
    var vals = new Uint8Array(len);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(vals);
      for (var i = 0; i < len; i++) out += alpha[vals[i] % alpha.length];
    } else {
      for (var j = 0; j < len; j++) out += alpha.charAt(Math.floor(Math.random() * alpha.length));
    }
    return out;
  }

  /* ---- التواريخ (نستخدم تاريخ الخادم لا ساعة الجهاز) ---- */
  var DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var dow = function (d) { return new Date(d + 'T00:00:00Z').getUTCDay(); };
  function addDays(d, n) { var t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
  var isWeekend = function (d) { return S.config.weekend_days.indexOf(dow(d)) >= 0; };
  var STATUS = { present: ['حاضر', 'check'], absent: ['غائب', 'x'], late: ['متأخر', 'clock'] };
  function stamp(s) { return h('span', { class: 'stamp ' + s }, icon(STATUS[s][1]), STATUS[s][0]); }
  var arNum = function (s) { return String(s).replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }); };

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
  var qs = function (o) { return Object.keys(o).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&'); };

  /* ---------------------------------------------------------------- 3) الحالة والمسارات */
  var S = { pub: {}, user: null, config: null, rules: [], groups: null };
  var stops = [];
  function onStop(fn) { stops.push(fn); }
  function stopAll() { stops.splice(0).forEach(function (f) { f(); }); }
  function poll(fn, ms) {
    var id = setInterval(function () { if (!document.hidden) fn(); }, ms);
    onStop(function () { clearInterval(id); });
  }
  var app = document.getElementById('app');

  function loadGroups(force) {
    if (S.groups && !force) return Promise.resolve(S.groups);
    return get('/api/groups').then(function (r) { S.groups = r.groups; return S.groups; });
  }
  function loadMe() {
    return get('/api/me').then(function (r) { S.user = r; S.config = r.config; S.rules = r.rules || []; return r; });
  }
  var home = function () {
    if (S.user.role === 'admin') return '#/a/monthly';
    if (S.user.role === 'viewer') return '#/v/daily';
    return '#/t/attendance';
  };

  var VIEWER_TABS = [
    ['daily', 'الغياب اليومي', 'book'],
    ['weekly', 'نشاط المعلمين', 'users']
  ];

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
      defaultTab: 'monthly',
      tabs: [
        ['monthly', 'التقرير الشهري', 'calendar'],
        ['daily', 'التقرير اليومي', 'book'],
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
      id: 'admin_accounts',
      label: 'الحسابات وإعدادات المنصة',
      shortLabel: 'الإدارة والحسابات',
      icon: 'shieldCheck',
      defaultTab: 'teachers',
      tabs: [
        ['teachers', 'المعلمون والحسابات', 'userPlus'],
        ['settings', 'إعدادات المنصة وFirebase', 'database']
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

  function render() {
    stopAll();
    var parts = location.hash.replace(/^#\/?/, '').split('/');
    document.title = (S.pub.school_name || 'منصة رصد الغياب') + ' | رصد الغياب';
    window.scrollTo(0, 0);
    if (!S.user) {
      if (parts[0] === 'login' && (parts[1] === 'teacher' || parts[1] === 'admin')) return viewLogin(parts[1]);
      return viewHome();
    }
    if (S.user.must_change || parts[0] === 'pw') return viewPassword();
    var isAdmin = S.user.role === 'admin';
    var isViewer = S.user.role === 'viewer';
    var allTabs = isAdmin ? ADMIN_ALL_TABS : (isViewer ? VIEWER_TABS : TEACHER_TABS);
    var prefix = isAdmin ? 'a' : (isViewer ? 'v' : 't');
    var tab = parts[0] === prefix && allTabs.some(function (t) { return t[0] === parts[1]; }) ? parts[1] : null;
    if (!tab) { history.replaceState(null, '', home()); tab = allTabs[0][0]; }
    var views = { attendance: viewAttendance, daily: viewDaily, weekly: viewWeekly, monthly: viewMonthly, classes: viewClasses, teachers: viewTeachers, records: viewRecords, settings: viewSettings };
    var body = h('div');
    var viewerBanner = isViewer ? h('div', { class: 'note info small', role: 'status' },
      icon('info'),
      h('b', { text: ' حسابك بصلاحية (مشاهد - للاطلاع فقط): ' }),
      'يمكنك استعراض كشوف الغياب اليومية ونشاط المعلمين في المدرسة. إذا كنت معلماً وترغب في رصد الحضور والغياب لطلابك، يرجى التواصل مع إدارة المدرسة لترقية حسابك.') : null;
    mount(app, frame(tab, isAdmin, isViewer), h('main', { class: 'wrap' }, viewerBanner, subNavigation(tab, isAdmin), body, siteFooter()));
    views[tab](body);
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
    try { localStorage.setItem('theme', next); } catch (e) { /* التخزين غير متاح */ }
    render();
  }

  // سطر المدير والتطوير: يظهر في أسفل كل الصفحات
  function siteFooter() {
    var p = S.pub;
    return h('footer', { class: 'site-foot' },
      p.principal_name && h('span', null, icon('user'), ' مدير المدرسة: ', h('b', { class: 'cy', text: p.principal_name })),
      p.developer_credit && h('span', null, icon('code'), ' تطوير وبرمجة: ', h('b', { class: 'gold', text: p.developer_credit })));
  }

  // تنبيه واضح حين تُفتح الصفحة بلا خادم (مثلاً بالنقر المزدوج على index.html)
  function offlineNote() {
    if (!S.offline) return null;
    return h('div', { class: 'note', role: 'alert' }, h('b', { text: 'الخادم غير متصل. ' }),
      location.protocol === 'file:' ? 'أنت تفتح الملف مباشرة من الجهاز، والمنصة تحتاج الخادم. شغّل الملف start-local.bat الموجود في مجلد server ثم افتح العنوان الذي يظهر.'
        : 'تعذر الوصول إلى الخادم. تحقق من الاتصال أو من أن الموقع منشور بشكل صحيح.');
  }

  function googleColoredIcon() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'g-icon');
    svg.setAttribute('aria-hidden', 'true');

    var p1 = document.createElementNS(ns, 'path');
    p1.setAttribute('fill', '#4285F4');
    p1.setAttribute('d', 'M23.49 12.27c0-.8-.07-1.57-.2-2.31H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58l3.66 2.84c2.14-1.98 3.76-4.9 3.76-8.62z');

    var p2 = document.createElementNS(ns, 'path');
    p2.setAttribute('fill', '#34A853');
    p2.setAttribute('d', 'M12 23c3.24 0 5.95-1.07 7.93-2.91l-3.66-2.84c-1.07.72-2.45 1.16-4.27 1.16-3.21 0-5.9-2.54-6.77-5.18L1.57 16.02C3.51 19.78 7.42 22.36 12 23z');

    var p3 = document.createElementNS(ns, 'path');
    p3.setAttribute('fill', '#FBBC05');
    p3.setAttribute('d', 'M1.57 7.34C.99 8.76.67 10.34.67 12s.32 3.24.9 4.66l3.66-2.84c-.2-.58-.33-1.2-.33-1.82s.13-1.24.33-1.82L1.57 7.34z');

    var p4 = document.createElementNS(ns, 'path');
    p4.setAttribute('fill', '#EA4335');
    p4.setAttribute('d', 'M12 5c1.57 0 2.98.54 4.09 1.6l3.07-3.07C17.3 1.73 14.86 1 12 1 7.42 1 3.51 3.58 1.57 7.34l3.66 2.84C6.1 7.54 8.79 5 12 5z');

    svg.append(p1, p2, p3, p4);
    return svg;
  }

  function googleLoginBtn() {
    return h('a', {
      class: 'btn-google',
      href: '/api/auth/google/login',
      role: 'button'
    }, googleColoredIcon(), h('span', { text: 'Continue with Google' }));
  }

  function openGoogleAuthModal() {
    var savedAccounts = [];
    try {
      var raw = localStorage.getItem('g_saved_accounts');
      if (raw) savedAccounts = JSON.parse(raw);
    } catch (e) { savedAccounts = []; }

    if (!savedAccounts || !savedAccounts.length) {
      savedAccounts = [
        { name: 'حساب Google تجريبي', email: 'user.google@gmail.com' }
      ];
    }

    var box;
    var contentHost = h('div');

    function performLogin(email, name, btnEl) {
      var act = btnEl ? busy(btnEl, function () { return doCall(); }) : doCall();
      function doCall() {
        return post('/api/auth/google', { email: email, name: name || undefined })
          .then(function () {
            try {
              var list = (savedAccounts || []).filter(function (x) { return x.email.toLowerCase() !== email.toLowerCase(); });
              list.unshift({ name: name || email.split('@')[0], email: email });
              localStorage.setItem('g_saved_accounts', JSON.stringify(list.slice(0, 5)));
            } catch (err) {}
            if (box) box.close();
            S.user = null;
            return loadMe();
          })
          .then(function () {
            var roleMsg = S.user.role === 'viewer' ? 'مشاهد (اطلاع فقط)' : (S.user.role === 'teacher' ? 'معلم' : 'إدارة');
            toast('مرحباً بك ' + S.user.name + '! تم الدخول بنجاح بصلاحية: ' + roleMsg);
            location.hash = home();
            render();
          });
      }
      return act.catch(function (err) {
        toast(err.message, true);
      });
    }

    function renderChooser() {
      var accountsList = h('div', { class: 'g-accounts-list' });

      savedAccounts.forEach(function (acc) {
        var initial = (acc.name || acc.email || 'G').slice(0, 1).toUpperCase();
        var row = h('button', {
          type: 'button',
          class: 'g-account-item',
          onclick: function () {
            performLogin(acc.email, acc.name, row);
          }
        },
          h('div', { class: 'g-avatar', text: initial }),
          h('div', { class: 'g-account-text' },
            h('div', { class: 'g-account-name', text: acc.name }),
            h('div', { class: 'g-account-email', text: acc.email })
          )
        );
        accountsList.append(row);
      });

      var useOtherBtn = h('button', {
        type: 'button',
        class: 'g-other-btn',
        onclick: renderCustomEmailForm
      }, icon('userPlus'), h('span', { text: 'Use another account / استخدام حساب آخر' }));

      mount(contentHost,
        h('div', { class: 'g-brand-box' },
          h('div', { class: 'g-app-icon' }, icon('school')),
          h('h2', { text: 'Choose an account' }),
          h('p', null, 'to continue to ', h('b', { text: S.pub.school_name || 'منصة رصد الغياب' }))
        ),
        accountsList,
        useOtherBtn,
        h('p', { class: 'g-footer-note', text: 'الحسابات المنشأة تمنح تلقائياً صلاحية (مشاهد للاطلاع فقط)، وتستطيع إدارة المدرسة ترقية الحساب إلى معلم من لوحة الإدارة.' }),
        h('div', { class: 'acts' },
          btn('إلغاء / Cancel', { on: function () { if (box) box.close(); } })
        )
      );
    }

    function renderCustomEmailForm() {
      var emailIn = h('input', { type: 'email', required: true, dir: 'ltr', placeholder: 'your.name@gmail.com أو name@school.edu' });
      var nameIn = h('input', { type: 'text', dir: 'auto', maxlength: '100', placeholder: 'اسمك الكامل (عربي أو إنجليزي)' });
      var msg = h('p', { class: 'err', role: 'alert' });
      var submitBtn = h('button', { class: 'btn primary block', type: 'submit' }, 'التالي / Next');

      var form = h('form', { onsubmit: function (e) {
        e.preventDefault(); msg.textContent = '';
        var em = emailIn.value.trim();
        var nm = nameIn.value.trim();
        if (!em) { msg.textContent = 'يرجى إدخال البريد الإلكتروني'; return; }
        busy(submitBtn, function () {
          return performLogin(em, nm);
        }).catch(function (err) {
          msg.textContent = err.message;
        });
      } },
        field('البريد الإلكتروني (Google Account Email)', emailIn, 'أدخل البريد الإلكتروني المعتمد للدخول والمصادقة.'),
        field('الاسم الكامل (اختياري للحسابات الجديدة)', nameIn, 'اسمك الذي سيظهر للمدرسة وللإدارة.'),
        msg,
        h('div', { class: 'acts' },
          btn('رجوع / Back', { on: renderChooser }),
          submitBtn
        )
      );

      mount(contentHost,
        h('div', { class: 'g-brand-box' },
          h('div', { class: 'g-app-icon' }, icon('school')),
          h('h2', { text: 'Sign in with Google' }),
          h('p', null, 'Enter your email to continue to ', h('b', { text: S.pub.school_name || 'منصة رصد الغياب' }))
        ),
        form
      );
      emailIn.focus();
    }

    renderChooser();

    var modalWrapper = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'g-modal' },
        h('div', { class: 'g-modal-header' },
          googleColoredIcon(),
          h('span', { text: 'Sign in with Google' })
        ),
        contentHost
      )
    );

    function close() {
      modalWrapper.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    document.body.append(modalWrapper);
    box = { close: close };
  }

  function viewHome() {
    var p = S.pub;
    mount(app, h('div', { class: 'hero' }, h('div', { class: 'corner' }, themeButton()),
      h('div', { class: 'hero-card' },
        h('span', { class: 'emblem' }, icon('school')),
        offlineNote(),
        h('div', { class: 'badge' }, icon('book'), p.school_name || 'المدرسة'),
        h('h1', { text: 'منصة رصد الغياب الذكية' }),
        h('p', { class: 'lead', text: 'نظام إلكتروني متطور لتتبع حضور وغياب الطلاب بكل مرونة، مع دعم الصفوف المتنقلة والربط التلقائي، ومزامنة فورية كاملة.' }),
        h('div', { class: 'pills' }, p.principal_name && h('div', { class: 'pill' }, icon('user'), ' مدير المدرسة: ', h('b', { text: p.principal_name }))),
        h('div', { class: 'gates' },
          h('a', { class: 'btn primary', href: '#/login/teacher' }, icon('users'), 'بوابة المعلمين'),
          h('a', { class: 'btn', href: '#/login/admin' }, icon('shield'), 'لوحة الإدارة')),
        h('div', { class: 'login-sep' }, h('span', { text: 'أو الدخول والمصادقة عبر Google' })),
        googleLoginBtn(),
        p.developer_credit && h('div', { class: 'credit' }, icon('code'), ' تطوير وبرمجة: ', h('b', { text: p.developer_credit })))));
  }

  function viewLogin(gate) {
    var isAdmin = gate === 'admin';
    var user = h('input', { type: 'text', autocomplete: 'username', required: true, dir: 'auto', autocapitalize: 'none', spellcheck: 'false', maxlength: '100', placeholder: isAdmin ? 'مثال: admin أو المدير العام' : 'مثال: أحمد الصالحي أو t01' });
    var pass = h('input', { type: 'password', autocomplete: 'current-password', required: true, dir: 'ltr', maxlength: '200' });
    var msg = h('p', { class: 'err', role: 'alert' });
    var tsBox = h('div'); var tsToken = '';
    var submit = h('button', { class: 'btn primary block', type: 'submit' }, 'دخول');
    var form = h('form', { onsubmit: function (e) {
      e.preventDefault(); msg.textContent = '';
      busy(submit, function () {
        return post('/api/login', { gate: gate, username: user.value, password: pass.value, turnstile: tsToken })
          .then(function (r) { S.user = null; return loadMe(); })
          .then(function () { location.hash = home(); render(); });
      }).catch(function (err) { msg.textContent = err.message; pass.value = ''; if (window.turnstile && tsBox.firstChild) window.turnstile.reset(); tsToken = ''; });
    } }, field(isAdmin ? 'اسم مستخدم الإدارة' : 'اسم المعلم (أو اسم المستخدم)', user, isAdmin ? 'أدخل اسم المستخدم أو الاسم المسجل (عربي أو إنجليزي).' : 'اكتب اسمك كما هو مسجل (عربي أو إنجليزي) أو اسم المستخدم.'), field('كلمة المرور', pass), tsBox, msg, submit);
    mount(app, h('div', { class: 'hero' }, h('div', { class: 'corner' }, themeButton()),
      h('div', { class: 'login-card' },
        h('h2', { text: isAdmin ? 'لوحة إدارة المدرسة' : 'بوابة المعلمين' }),
        h('p', { class: 'muted', text: isAdmin ? 'للإدارة فقط.' : 'أدخل اسمك وكلمة المرور التي سلّمتها لك الإدارة. يمكنك تغييرها بعد الدخول.' }), offlineNote(),
        form,
        h('div', { class: 'login-sep' }, h('span', { text: 'أو الدخول عبر Google / البريد' })),
        googleLoginBtn(),
        h('p', { class: 'small' }, h('a', { href: '#/', text: 'العودة للرئيسية' })), siteFooter())));
    user.focus();
    if (S.pub.turnstile_site_key) loadTurnstile(tsBox, S.pub.turnstile_site_key, function (t) { tsToken = t; });
  }
  function loadTurnstile(box, key, onToken) {
    function draw() { window.turnstile.render(box, { sitekey: key, callback: onToken, 'expired-callback': function () { onToken(''); } }); }
    if (window.turnstile) return draw();
    var s = h('script', { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', async: true, defer: true });
    s.onload = draw; document.head.append(s);
  }

  function viewPassword() {
    var forced = S.user.must_change;
    var cur = h('input', { type: 'password', autocomplete: 'current-password', required: true, dir: 'ltr' });
    var nw = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '8', dir: 'ltr' });
    var again = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '8', dir: 'ltr' });
    var msg = h('p', { class: 'err', role: 'alert' });
    var submit = h('button', { class: 'btn primary block', type: 'submit' }, 'حفظ كلمة المرور');
    var form = h('form', { onsubmit: function (e) {
      e.preventDefault(); msg.textContent = '';
      if (nw.value !== again.value) { msg.textContent = 'كلمتا المرور الجديدتان غير متطابقتين'; return; }
      busy(submit, function () {
        return post('/api/password', { current: cur.value, next: nw.value }).then(loadMe).then(function () { toast('تم تغيير كلمة المرور'); location.hash = home(); render(); });
      }).catch(function (err) { msg.textContent = err.message; });
    } }, field(forced ? 'كلمة المرور المؤقتة' : 'كلمة المرور الحالية', cur), field('كلمة المرور الجديدة (8 أحرف أو أكثر)', nw), field('تأكيد كلمة المرور الجديدة', again), msg, submit);
    mount(app, h('div', { class: 'hero' }, h('div', { class: 'login-card' },
      h('h2', { text: forced ? 'اختر كلمة مرور خاصة بك' : 'تغيير كلمة المرور' }),
      forced && h('p', { class: 'muted', text: 'هذه أول مرة تدخل فيها. كلمة المرور المؤقتة لا تصلح للاستخدام الدائم.' }),
      form,
      h('p', { class: 'small' }, forced ? btn('تسجيل الخروج', { sm: true, on: logout }) : h('a', { href: home(), text: 'رجوع' })), siteFooter())));
    cur.focus();
  }
  function logout() {
    post('/api/logout').catch(function () {}).then(function () { S.user = null; S.groups = null; location.hash = '#/'; render(); });
  }

  /* ---------------------------------------------------------------- 5) هيكل الصفحة */
  function frame(tab, isAdmin, isViewer) {
    var pwBtn = h('a', { class: 'btn icon-btn', href: '#/pw', title: 'تغيير كلمة المرور', 'aria-label': 'تغيير كلمة المرور', 'data-tooltip': 'تغيير كلمة المرور' }, icon('key'));
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
    } else if (isViewer) {
      navItems = VIEWER_TABS.map(function (t) {
        return h('a', {
          class: 'tab',
          role: 'tab',
          href: '#/v/' + t[0],
          'aria-selected': t[0] === tab ? 'true' : 'false'
        }, icon(t[2]), h('span', { text: t[1] }));
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

    var roleLabel = isAdmin ? '(الإدارة)' : (isViewer ? '(مشاهد - اطلاع فقط)' : '(معلم)');
    var roleIcon = isAdmin ? 'shieldCheck' : (isViewer ? 'info' : 'user');

    return h('div', null,
      h('header', { class: 'topbar' }, h('div', { class: 'wrap' },
        h('div', { class: 'brand' },
          h('div', { class: 'logo' }, icon('school')),
          h('span', { text: S.pub.school_name || 'رصد الغياب' })),
        h('div', { class: 'who-chip' },
          icon(roleIcon),
          h('b', { text: S.user.name }),
          h('span', { class: 'small muted', text: roleLabel })),
        h('div', { class: 'topbar-btns' },
          themeButton(),
          pwBtn,
          logoutBtn))),
      h('nav', { class: 'tabbar', role: 'tablist', 'aria-label': 'التنقل الرئيسي' }, navItems));
  }

  // قائمة اختيار الصف: الفئات (الصفوف الأساسية / المواد المتنقلة) كمجموعات
  function groupSelect(kinds, value, onchange) {
    var sel = h('select', { 'aria-label': 'الصف أو المادة', onchange: function () { onchange(sel.value); } }, h('option', { value: '', text: '— اختر الصف أو المادة —' }));
    var cats = { basic: 'الصفوف الأساسية', mobile: 'المواد المتنقلة' };
    kinds.forEach(function (k) {
      var list = (S.groups || []).filter(function (g) { return g.kind === k; });
      if (list.length) sel.append(h('optgroup', { label: cats[k] }, list.map(function (g) { return h('option', { value: g.id, text: g.name + ' (' + g.student_count + ')' }); })));
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

  /* ---------------------------------------------------------------- 6) رصد الغياب */
  function viewAttendance(host) {
    var st = { date: lastSchoolDay(S.config.today), period: 1, gid: '', students: [], marks: {}, notes: {}, record: null, loaded: false };
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
    loadGroups().then(function () {
      mount(grpHolder, groupSelect(['basic', 'mobile'], st.gid, function (v) { st.gid = v; load(); }));
      header();
    }).catch(fail);

    function counts() {
      var c = { present: 0, absent: 0, late: 0 };
      st.students.forEach(function (s) { c[st.marks[s.id] || 'present']++; });
      return c;
    }
    function load() {
      header();
      if (!st.gid) { mount(out, empty('اختر الصف لعرض الطلاب', 'ثم اختر الحصة وسجّل الغياب والتأخير فقط؛ الباقون يُحسبون حاضرين.')); return; }
      if (isWeekend(st.date)) { mount(out, h('div', { class: 'note', text: 'هذا اليوم عطلة أسبوعية، اختر يوماً دراسياً.' })); return; }
      var token = (st.token = {});
      mount(out, skeleton(4));
      Promise.all([get('/api/groups/' + st.gid + '/students'), get('/api/record?' + qs({ date: st.date, period: st.period, group_id: st.gid }))]).then(function (r) {
        if (st.token !== token) return;
        st.students = r[0].students; st.record = r[1].record; st.marks = {}; st.notes = {};
        if (st.record) st.record.entries.forEach(function (e) { st.marks[e.student_id] = e.status; st.notes[e.student_id] = e.note; });
        paint();
      }).catch(function (e) { if (st.token === token) mount(out, h('div', { class: 'note' }, h('b', { text: 'تعذر تحميل البيانات' }), h('p', { text: e.message }), btn('إعادة المحاولة', { sm: true, on: load }))); });
    }

    function paint() {
      if (!st.students.length) { mount(out, empty('لا يوجد طلاب في هذا الصف', 'تضيف الإدارة الطلاب من لوحة الإدارة.')); return; }
      var locked = !!st.record;
      var list = h('ul', { class: 'roll' });
      st.students.forEach(function (s) {
        var cur = st.marks[s.id] || 'present';
        var seg = h('div', { class: 'seg' + (locked ? ' locked' : ''), role: 'radiogroup', 'aria-label': 'حالة ' + s.name },
          ['present', 'absent', 'late'].map(function (v) {
            return h('button', { type: 'button', role: 'radio', 'data-v': v, 'aria-checked': v === cur ? 'true' : 'false', disabled: locked && v !== cur }, icon(STATUS[v][1]), STATUS[v][0]);
          }));
        var why = h('input', { class: 'why', type: 'text', maxlength: '200', placeholder: 'العذر / ملاحظات', 'aria-label': 'ملاحظة ' + s.name, value: st.notes[s.id] || '', hidden: cur === 'present', disabled: locked, 'data-n': s.id });
        list.append(h('li', { 'data-id': s.id, 'data-s': cur }, h('span', { class: 'num', text: s.number }), h('span', { class: 'nm', text: s.name }), seg, why));
      });
      var cntOk = h('span', { class: 'count ok' }), cntBad = h('span', { class: 'count bad' }), cntLate = h('span', { class: 'count warn' });
      function paintCounts() { var c = counts(); cntOk.textContent = 'حاضر ' + c.present; cntBad.textContent = 'غائب ' + c.absent; cntLate.textContent = 'متأخر ' + c.late; }
      paintCounts();
      var save = btn('حفظ الرصد', { kind: 'primary', ic: 'check', type: 'button' });
      save.onclick = function () {
        var c = counts();
        confirmBox('حفظ رصد الحصة؟', 'غائب: ' + c.absent + '، متأخر: ' + c.late + '. بعد الحفظ لا يمكن للمعلم تعديل الحصة، ويتطلب ذلك الإدارة.', 'حفظ').then(function (ok) {
          if (!ok) return;
          var entries = st.students.filter(function (s) { return (st.marks[s.id] || 'present') !== 'present'; })
            .map(function (s) { return { student_id: s.id, status: st.marks[s.id], note: st.notes[s.id] || '' }; });
          busy(save, function () { return post('/api/record', { date: st.date, period: st.period, group_id: Number(st.gid), entries: entries }); })
            .then(function () { toast('تم حفظ الرصد'); load(); }).catch(function (e) { fail(e); if (e.status === 409) load(); });
        });
      };
      var banner = locked ? h('div', { class: 'note info', text: 'تم رصد هذه الحصة بواسطة ' + st.record.teacher_name + '. للتعديل تواصل مع الإدارة.' }) : null;
      mount(out, banner, list, !locked && h('div', { class: 'savebar' }, h('div', { class: 'counts' }, cntOk, cntBad, cntLate), save),
        locked && h('div', { class: 'savebar' }, h('div', { class: 'counts' }, cntOk, cntBad, cntLate)));

      // تفويض الأحداث: مستمع واحد للقائمة كلها (أسرع على الأجهزة الضعيفة)
      if (!locked) {
        list.addEventListener('click', function (e) {
          var b = e.target.closest('button[data-v]'); if (!b) return;
          var li = b.closest('li'); var id = Number(li.getAttribute('data-id')); var v = b.getAttribute('data-v');
          st.marks[id] = v; li.setAttribute('data-s', v);
          li.querySelectorAll('button[data-v]').forEach(function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
          var note = li.querySelector('input'); note.hidden = v === 'present';
          if (v !== 'present') note.focus();
          paintCounts();
        });
        list.addEventListener('input', function (e) { if (e.target.hasAttribute('data-n')) st.notes[Number(e.target.getAttribute('data-n'))] = e.target.value; });
      }
    }
    // مزامنة: إن سجّل معلم آخر هذه الحصة أثناء عملك ننبّهك
    poll(function () {
      if (!st.gid || st.record || isWeekend(st.date) || !st.students.length) return;
      get('/api/record?' + qs({ date: st.date, period: st.period, group_id: st.gid })).then(function (r) {
        if (r.record && !st.record) { toast('رُصدت هذه الحصة للتو بواسطة ' + r.record.teacher_name, true); load(); }
      }).catch(function () {});
    }, 20000);
  }

  /* ---------------------------------------------------------------- 7) التقارير */
  function viewDaily(host) {
    var st = { date: lastSchoolDay(S.config.today), gid: '' };
    var out = h('div');
    var dateIn = h('input', { type: 'date', value: st.date, max: S.config.today, onchange: function () { st.date = dateIn.value || st.date; load(); } });
    var grp = h('div');
    host.append(h('div', { class: 'card noprint' },
      h('h2', null, h('span', { text: 'تقرير الغياب اليومي' }), icon('book')),
      h('div', { class: 'grid' }, field('الصف الأساسي', grp), field('التاريخ', dateIn))), out);
    loadGroups().then(function () { mount(grp, groupSelect(['basic'], st.gid, function (v) { st.gid = v; load(); })); }).catch(fail);
    function load() {
      if (!st.gid) { mount(out, empty('اختر الصف الأساسي لعرض التقرير اليومي')); return; }
      mount(out, skeleton(3));
      get('/api/reports/daily?' + qs({ date: st.date, group_id: st.gid })).then(function (r) {
        var g = S.groups.filter(function (x) { return String(x.id) === String(st.gid); })[0];
        if (!r.students.length) { mount(out, empty('جميع طلاب الصف حاضرون في هذا التاريخ!', 'لا توجد حالات غياب أو تأخر.')); return; }
        mount(out, h('div', { class: 'row' }, h('h2', { text: 'تقرير ' + (g ? g.name : '') + ' — ' + DAYS[dow(st.date)] + ' ' + st.date }), printButton()),
          h('p', { class: 'muted small', text: 'إجمالي الحالات: ' + r.students.length + ' طالب' }),
          r.students.map(function (s) {
            return h('article', { class: 'stu' }, h('header', null, h('span', { class: 'num', text: s.number }), h('span', { class: 'nm', text: s.name })),
              s.items.map(function (i) {
                return h('div', { class: 'line' }, h('b', { text: 'الحصة ' + i.period }), stamp(i.status), h('span', { class: 'muted', text: i.group_name }), h('span', { text: i.teacher_name }), i.note && h('span', { class: 'muted', text: '— ' + i.note }));
              }));
          }));
      }).catch(function (e) { mount(out, h('div', { class: 'note', text: e.message })); });
    }
    load();
    poll(function () { if (st.gid) load(); }, 45000);
  }

  function viewWeekly(host) {
    var date = S.config.today;
    var out = h('div');
    var dateIn = h('input', { type: 'date', value: date, onchange: function () { date = dateIn.value || date; load(); } });
    host.append(h('div', { class: 'card noprint' },
      h('h2', null, h('span', { text: 'إحصائيات ونشاط المعلمين الأسبوعي' }), icon('users')),
      field('اختر أي يوم ضمن الأسبوع', dateIn)), out);
    function load() {
      get('/api/reports/weekly?' + qs({ date: date })).then(function (r) {
        if (!r.teachers.length) { mount(out, empty('لا يوجد معلمون مسجلون')); return; }
        mount(out, h('div', { class: 'row' }, h('h2', { text: 'من ' + r.from + ' إلى ' + r.to }), printButton()),
          h('p', { class: 'muted small', text: 'إجمالي الحصص المرصودة: ' + r.total }),
          h('div', { class: 'card' }, r.teachers.map(function (t) {
            var bar = h('div', { class: 'bar' }, h('i')); bar.firstChild.style.setProperty('--w', t.percent + '%');
            return h('div', { class: 'bar-row' }, h('span', { text: t.name }), h('b', { text: t.sessions + ' حصة · ' + t.percent + '%' }), bar);
          })));
      }).catch(function (e) { mount(out, h('div', { class: 'note', text: e.message })); });
    }
    load();
    poll(load, 45000);
  }

  function viewMonthly(host) {
    var st = { month: S.config.today.slice(0, 7), gid: '' };
    var out = h('div');
    var monthIn = h('input', { type: 'month', value: st.month, placeholder: 'YYYY-MM', onchange: function () { if (/^\d{4}-\d{2}$/.test(monthIn.value)) { st.month = monthIn.value; load(); } } });
    var grp = h('div');
    host.append(h('div', { class: 'card noprint' },
      h('h2', null, h('span', { text: 'تقرير الغياب الشهري' }), icon('calendar')),
      h('div', { class: 'grid' }, field('الصف الأساسي', grp), field('الشهر', monthIn))), out);
    loadGroups().then(function () { mount(grp, groupSelect(['basic'], st.gid, function (v) { st.gid = v; load(); })); }).catch(fail);
    function load() {
      if (!st.gid) { mount(out, empty('اختر الشهر والصف لعرض الغائبين')); return; }
      mount(out, skeleton(3));
      get('/api/admin/reports/monthly?' + qs({ month: st.month, group_id: st.gid })).then(function (r) {
        mount(out, h('div', { class: 'row' }, h('h2', { text: 'تقرير ' + r.group.name + ' — ' + r.month }), printButton()),
          h('div', { class: 'tiles' }, tile(r.totals.absence_days, 'إجمالي أيام الغياب'), tile(r.totals.late_days, 'إجمالي أيام التأخر'), tile(r.totals.students, 'عدد طلاب الصف')),
          h('p', { class: 'muted small', text: 'يظهر الطلاب الذين بلغ غيابهم ' + r.min_days + ' أيام فأكثر. اليوم يُحسب مرة واحدة مهما تعددت الحصص (يشمل المواد المتنقلة).' }),
          r.students.length ? r.students.map(function (s) { return studentCard(s, r.month); }) : empty('لا توجد حالات غياب بواقع ' + r.min_days + ' أيام فأعلى لهذا الصف خلال هذا الشهر'));
      }).catch(function (e) { mount(out, h('div', { class: 'note', text: e.message })); });
    }
    function tile(n, label) { return h('div', { class: 'tile' }, h('b', { text: n }), h('span', { text: label })); }
    function chipsFor(s, days, kind) {
      return h('div', { class: 'chips' }, days.map(function (d) {
        var periods = d.items.map(function (i) { return i.period; }).join('،');
        return h('span', { class: 'chip' }, ltr(d.date), h('span', { class: 'muted small', text: 'ح ' + periods }),
          h('button', { type: 'button', title: 'حذف', 'aria-label': 'حذف ' + d.date, onclick: function () {
            confirmBox('حذف السجل؟', s.name + ' — ' + d.date + '. يتحول إلى حاضر ويبقى أثره في سجل التدقيق.', 'حذف', true).then(function (ok) {
              if (ok) post('/api/admin/entries/clear', { student_id: s.id, date: d.date, kind: kind }).then(function () { toast('تم الحذف'); load(); }).catch(fail);
            });
          } }, icon('x')));
      }));
    }
    function studentCard(s) {
      var action = s.action ? h('span', { class: 'action', text: s.action.label }) : null;
      if (action) action.style.setProperty('--c', s.action.color);
      return h('article', { class: 'stu' },
        h('header', null, h('span', { class: 'num', text: s.number }), h('span', { class: 'nm', text: s.name }), h('b', { class: 'count bad', text: s.absence_days + ' أيام غياب' }), action),
        h('div', { class: 'line' }, h('span', { class: 'muted', text: 'تواريخ الغياب:' }), chipsFor(s, s.absences, 'absent')),
        s.late_days.length ? h('div', { class: 'line' }, h('span', { class: 'muted', text: 'التأخر:' }), chipsFor(s, s.late_days, 'late')) : null);
    }
    load();
  }

  /* ---------------------------------------------------------------- 8) لوحة الإدارة */
  // قراءة سطور الطلاب: "رقم - اسم" (يقبل - أو , أو tab أو مسافة)
  function parseStudents(text) {
    var out = []; var skipped = 0;
    text.split(/\r?\n/).forEach(function (line) {
      line = line.trim(); if (!line) return;
      var m = arNum(line).match(/^([A-Za-z0-9._]+)\s*[-–—,،:\t ]\s*(.+)$/);
      if (m && m[2].trim()) out.push({ number: m[1], name: m[2].trim() }); else skipped++;
    });
    return { list: out, skipped: skipped };
  }
  function parseNames(text) {
    var seen = {}; var out = [];
    text.split(/\r?\n/).forEach(function (l) {
      var n = l.replace(/^[\s\d.\-–)(،:]+/, '').trim();
      if (n && !seen[n]) { seen[n] = 1; out.push(n); }
    });
    return out;
  }
  function chunks(list, size) { var o = []; for (var i = 0; i < list.length; i += size) o.push(list.slice(i, i + size)); return o; }
  // تشغيل طلبات متتابعة (الخادم المجاني يحدّ عدد العمليات في الطلب الواحد)
  function sequence(parts, fn, progress) {
    var results = []; var p = Promise.resolve();
    parts.forEach(function (part, i) { p = p.then(function () { if (progress) progress(i + 1, parts.length); return fn(part, i); }).then(function (r) { results.push(r); }); });
    return p.then(function () { return results; });
  }

  function viewClasses(host) {
    var name = h('input', { type: 'text', maxlength: '80', placeholder: 'مثال: الصف العاشر / 1  أو  مادة الرياضيات' });
    var kind = h('select', null, h('option', { value: 'basic', text: 'صف أساسي (ثابت)' }), h('option', { value: 'mobile', text: 'مادة متنقلة / مجموعة خاصة' }));
    var text = h('textarea', { placeholder: '101 - أحمد محمد\n102 - سالم علي', dir: 'auto' });
    var info = h('p', { class: 'muted small' });
    var add = btn('إضافة الصف', { kind: 'primary', ic: 'plus' });
    var list = h('div');

    var entryMode = 'single';
    var entryHost = h('div');
    var singleNum = h('input', { type: 'text', maxlength: '30', placeholder: 'مثال: 101', 'aria-label': 'رقم الطالب' });
    var singleName = h('input', { type: 'text', maxlength: '120', placeholder: 'مثال: أحمد محمد', 'aria-label': 'اسم الطالب' });
    var addSingleToListBtn = btn('أضف الطالب للقائمة +', { sm: true, kind: 'primary', ic: 'plus' });
    var chipsContainer = h('div', { class: 'stu-added-list' });

    function updateCount() {
      var p = parseStudents(text.value);
      info.textContent = p.list.length ? ('إجمالي الطلاب المضافين: ' + p.list.length + ' طالب' + (p.skipped ? ' — ' + p.skipped + ' سطر سيُتجاهل' : '')) : '';
      mount(chipsContainer, p.list.length ? p.list.map(function (s, idx) {
        var delBtn = h('button', {
          class: 'del',
          type: 'button',
          title: 'حذف',
          'aria-label': 'حذف ' + s.name,
          onclick: function () {
            var lines = text.value.split(/\r?\n/).filter(function (l) { return l.trim(); });
            lines.splice(idx, 1);
            text.value = lines.join('\n');
            updateCount();
          }
        }, icon('x'));
        return h('span', { class: 'stu-chip' },
          h('span', { class: 'num', text: s.number }),
          h('span', { text: s.name }),
          delBtn);
      }) : h('span', { class: 'muted small', text: 'لم يُضف أي طالب بعد. أدخل رقم واسم الطالب واضغط «أضف الطالب للقائمة +» أو بدّل للخيار الجماعي للصق قائمة كاملة.' }));
    }

    addSingleToListBtn.onclick = function () {
      var n = singleNum.value.trim();
      var m = singleName.value.trim();
      if (!n || !m) return toast('اكتب رقم الطالب واسم الطالب أولاً', true);
      text.value = (text.value.trim() ? text.value.trim() + '\n' : '') + n + ' - ' + m;
      singleNum.value = '';
      singleName.value = '';
      singleNum.focus();
      updateCount();
      toast('أضيف الطالب إلى قائمة الصف');
    };

    singleName.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addSingleToListBtn.click(); }
    });
    singleNum.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); singleName.focus(); }
    });

    text.addEventListener('input', updateCount);

    function paintEntryMode() {
      var switcher = h('div', { class: 'tab-switch' },
        h('button', {
          type: 'button',
          class: entryMode === 'single' ? 'active' : '',
          onclick: function () { entryMode = 'single'; paintEntryMode(); }
        }, icon('userPlus'), 'إضافة طالب فردي (طالب واحد)'),
        h('button', {
          type: 'button',
          class: entryMode === 'bulk' ? 'active' : '',
          onclick: function () { entryMode = 'bulk'; paintEntryMode(); }
        }, icon('fileText'), 'لصق قائمة كاملة (نص متعدد)'));

      if (entryMode === 'single') {
        mount(entryHost, switcher,
          h('div', { class: 'grid' },
            field('رقم الطالب (المفتاح)', singleNum, 'الرقم يربط الطالب بالصف والمواد المتنقلة تلقائياً.'),
            field('اسم الطالب', singleName)),
          h('div', { class: 'row' }, addSingleToListBtn),
          h('div', { class: 'small muted', text: 'الطلاب المضافون للصف حتى الآن:' }),
          chipsContainer);
      } else {
        mount(entryHost, switcher,
          field('قائمة الطلاب (رقم الطالب - اسم الطالب في كل سطر)', text, 'يمكنك كتابة أو لصق قائمة الطلاب كاملة مباشرة هنا.'),
          chipsContainer);
      }
      updateCount();
    }

    paintEntryMode();

    add.onclick = function () {
      var p = parseStudents(text.value);
      if (!name.value.trim()) return toast('اكتب اسم الصف', true);
      if (!p.list.length) return toast('أضف طالباً واحداً على الأقل إلى الصف', true);
      var parts = chunks(p.list, 200);
      busy(add, function () {
        return post('/api/admin/groups', { name: name.value, kind: kind.value, students: parts[0] }).then(function (r) {
          var rest = parts.slice(1);
          return sequence(rest, function (c) { return post('/api/admin/groups/' + r.id + '/students', { students: c }); }, function (i, n) { info.textContent = 'جاري الحفظ… ' + i + '/' + n; })
            .then(function () { return r; });
        });
      }).then(function (r) {
        toast('تمت إضافة «' + name.value + '» — طلاب جدد: ' + r.new_students + '، مرتبطون بصفوفهم: ' + r.linked);
        name.value = ''; text.value = ''; info.textContent = '';
        updateCount(); refresh();
      }).catch(fail);
    };

    host.append(h('div', { class: 'card' },
      h('h2', null, h('span', { text: 'إضافة صف أو مادة متنقلة' }), icon('school')),
      h('div', { class: 'stack' },
        h('div', { class: 'grid' }, field('اسم الصف / المادة', name), field('النوع', kind)),
        entryHost,
        info,
        h('div', { class: 'row end' }, add))), list);

    function refresh() { loadGroups(true).then(paint).catch(fail); }
    function paint() {
      var cats = [['basic', 'الصفوف الأساسية'], ['mobile', 'المواد المتنقلة']];
      mount(list,
        h('div', { class: 'page-head noprint' },
          h('h2', { text: 'إدارة الصفوف والطلاب' }),
          h('span', { class: 'badge', text: 'إجمالي الصفوف والمواد: ' + S.groups.length })),
        cats.map(function (c) {
          var gs = S.groups.filter(function (g) { return g.kind === c[0]; });
          return h('div', { class: 'card' }, h('h3', { text: c[1] + ' (' + gs.length + ')' }), gs.length ? gs.map(groupRow) : empty('لا توجد صفوف مسجلة في هذا القسم'));
        }));
    }
    function groupRow(g) {
      var panel = h('div', { hidden: true, class: 'stack' });
      var open = false;
      var toggle = btn('الطلاب', { sm: true, ic: 'users', on: function () {
        open = !open; panel.hidden = !open;
        if (open) studentsPanel(panel, g);
      } });
      var del = btn('حذف', { sm: true, kind: 'danger', ic: 'trash', on: function () {
        confirmBox('حذف «' + g.name + '»؟', 'سيُحذف الصف وكل سجلات غيابه نهائياً.', 'حذف نهائي', true).then(function (ok) {
          if (ok) busy(del, function () { return api('DELETE', '/api/admin/groups/' + g.id); }).then(function () { toast('تم الحذف'); refresh(); }).catch(fail);
        });
      } });
      return h('div', null, h('div', { class: 'list-row' }, h('b', { class: 'grow', text: g.name }), h('span', { class: 'muted', text: g.student_count + ' طالب' }), toggle, del), panel);
    }
    function studentsPanel(panel, g) {
      mount(panel, skeleton(2));
      get('/api/groups/' + g.id + '/students').then(function (r) {
        var q = h('input', { type: 'search', placeholder: 'ابحث بالاسم أو الرقم في «' + g.name + '»…', 'aria-label': 'بحث' });
        var rows = h('div');
        function show() {
          var f = arNum(q.value.trim());
          var list = r.students.filter(function (s) { return !f || s.name.indexOf(f) >= 0 || s.number.indexOf(f) >= 0; });
          mount(rows, list.length ? list.map(function (s) {
            return h('div', { class: 'list-row' },
              h('span', { class: 'muted', text: s.number }),
              h('span', { class: 'grow', text: s.name }),
              btn('حذف', { sm: true, kind: 'danger', ic: 'trash', on: function () {
                confirmBox('حذف الطالب؟', s.name + ' من «' + g.name + '».', 'حذف', true).then(function (ok) {
                  if (ok) api('DELETE', '/api/admin/groups/' + g.id + '/students/' + s.id).then(function () {
                    toast('تم حذف الطالب من الصف');
                    studentsPanel(panel, g);
                    loadGroups(true).then(paint).catch(fail);
                  }).catch(fail);
                });
              } }));
          }) : empty('لا توجد نتائج'));
        }
        q.addEventListener('input', show); show();

        var addMode = 'single';
        var addHost = h('div');
        var sNumIn = h('input', { type: 'text', maxlength: '30', placeholder: 'مثال: 105', 'aria-label': 'رقم الطالب' });
        var sNmIn = h('input', { type: 'text', maxlength: '120', placeholder: 'مثال: سالم الكعبي', 'aria-label': 'اسم الطالب' });
        var addOneBtn = btn('إضافة هذا الطالب للصف', { sm: true, kind: 'primary', ic: 'userPlus' });
        var more = h('textarea', { placeholder: 'طلاب جدد: رقم - اسم في كل سطر', dir: 'auto' });
        var addMore = btn('إضافة قائمة الطلاب', { sm: true, kind: 'primary', ic: 'plus' });

        addOneBtn.onclick = function () {
          var num = sNumIn.value.trim();
          var nm = sNmIn.value.trim();
          if (!num || !nm) return toast('اكتب رقم الطالب واسم الطالب أولاً', true);
          busy(addOneBtn, function () {
            return post('/api/admin/groups/' + g.id + '/students', { students: [{ number: num, name: nm }] });
          }).then(function () {
            toast('تمت إضافة الطالب «' + nm + '» بنجاح');
            sNumIn.value = '';
            sNmIn.value = '';
            studentsPanel(panel, g);
            loadGroups(true).then(paint).catch(fail);
          }).catch(fail);
        };

        sNmIn.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); addOneBtn.click(); }
        });
        sNumIn.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); sNmIn.focus(); }
        });

        addMore.onclick = function () {
          var p = parseStudents(more.value); if (!p.list.length) return toast('لا يوجد طلاب صالحون في النص', true);
          busy(addMore, function () {
            return sequence(chunks(p.list, 200), function (c) { return post('/api/admin/groups/' + g.id + '/students', { students: c }); });
          }).then(function () {
            toast('تمت إضافة الطلاب بنجاح');
            more.value = '';
            studentsPanel(panel, g);
            loadGroups(true).then(paint).catch(fail);
          }).catch(fail);
        };

        function paintAddMode() {
          var switcher = h('div', { class: 'tab-switch' },
            h('button', {
              type: 'button',
              class: addMode === 'single' ? 'active' : '',
              onclick: function () { addMode = 'single'; paintAddMode(); }
            }, icon('userPlus'), 'إضافة طالب واحد فقط (فردي)'),
            h('button', {
              type: 'button',
              class: addMode === 'bulk' ? 'active' : '',
              onclick: function () { addMode = 'bulk'; paintAddMode(); }
            }, icon('fileText'), 'لصق قائمة طلاب (نص متعدد)'));

          if (addMode === 'single') {
            mount(addHost, switcher,
              h('div', { class: 'grid' },
                field('رقم الطالب', sNumIn),
                field('اسم الطالب', sNmIn)),
              h('div', { class: 'row end' }, addOneBtn));
          } else {
            mount(addHost, switcher,
              field('طلاب جدد: رقم - اسم في كل سطر', more),
              h('div', { class: 'row end' }, addMore));
          }
        }

        paintAddMode();

        mount(panel, h('div', { class: 'card' },
          h('h3', { text: 'طلاب «' + g.name + '» (' + r.students.length + ' طالب)' }),
          h('div', { class: 'stack' },
            q,
            rows,
            h('div', { class: 'sep' }),
            h('h4', { text: 'إضافة طلاب إلى «' + g.name + '»' }),
            addHost)));
      }).catch(function (e) { mount(panel, h('div', { class: 'note', text: e.message })); });
    }
    loadGroups().then(paint).catch(fail);
  }

  function viewTeachers(host) {
    var teachers = [];
    var subTab = 'single';
    var q = h('input', { type: 'search', placeholder: 'ابحث بالاسم (عربي أو إنجليزي) أو اسم المستخدم…', 'aria-label': 'بحث' });
    var roleFilter = h('select', { 'aria-label': 'تصفية حسب الصلاحية' },
      h('option', { value: '', text: 'جميع الصلاحيات' }),
      h('option', { value: 'teacher', text: 'معلمون فقط' }),
      h('option', { value: 'viewer', text: 'مشاهدون فقط (اطلاع)' }),
      h('option', { value: 'admin', text: 'إدارة ومشرفون فقط' }));
    var statusFilter = h('select', { 'aria-label': 'تصفية حسب الحالة' },
      h('option', { value: '', text: 'جميع الحالات' }),
      h('option', { value: 'active', text: 'حسابات نشطة' }),
      h('option', { value: 'pending', text: 'بانتظار تغيير كلمة المرور' }));

    var statsBox = h('div', { class: 'tiles' });
    var fbBanner = h('div');
    var creatorBox = h('div');
    var resultsBox = h('div');
    var list = h('div');

    function paintFbBanner() {
      var syncBtn = btn('مزامنة مع Google Firebase', { sm: true, ic: 'refresh' });
      syncBtn.onclick = function () {
        confirmBox('مزامنة قاعدة البيانات مع Google Firebase؟', 'سيتم إرسال وتحديث جميع الحسابات والصفوف والإعدادات في Cloud Firestore وFirebase Auth.', 'بدء المزامنة').then(function (ok) {
          if (!ok) return;
          busy(syncBtn, function () { return post('/api/admin/firebase/sync'); }).then(function (res) {
            toast(res.message || 'تمت مزامنة البيانات في Google Firebase بنجاح');
            loadList();
          }).catch(fail);
        });
      };
      mount(fbBanner, h('div', { class: 'fb-banner' },
        h('div', { class: 'fb-info' },
          h('span', { class: 'fb-dot' }),
          icon('database'),
          h('div', null,
            h('b', { text: 'Google Firebase مدمج ومفعل' }),
            h('div', { class: 'small muted', text: 'جميع الحسابات تُنشأ في Firebase Auth وتُخزن في Cloud Firestore فورياً.' }))),
        syncBtn));
    }

    function paintStats() {
      var total = teachers.length;
      var teachersCnt = teachers.filter(function (t) { return (t.role || 'teacher') === 'teacher'; }).length;
      var viewersCnt = teachers.filter(function (t) { return t.role === 'viewer'; }).length;
      var adminsCnt = teachers.filter(function (t) { return t.role === 'admin'; }).length;
      var pendingCnt = teachers.filter(function (t) { return t.must_change; }).length;

      mount(statsBox,
        h('div', { class: 'tile accent' }, h('b', { text: total }), h('span', { text: 'إجمالي الحسابات' })),
        h('div', { class: 'tile' }, h('b', { text: teachersCnt }), h('span', { text: 'معلمون' })),
        h('div', { class: 'tile' }, h('b', { text: viewersCnt }), h('span', { text: 'مشاهدون (اطلاع)' })),
        h('div', { class: 'tile gold' }, h('b', { text: adminsCnt }), h('span', { text: 'إدارة ومشرفون' })),
        h('div', { class: 'tile warn' }, h('b', { text: pendingCnt }), h('span', { text: 'بانتظار تفعيل كلمة المرور' })));
    }

    function paintCreator() {
      var singleTabBtn = h('button', {
        type: 'button',
        class: 'form-tab' + (subTab === 'single' ? ' active' : ''),
        onclick: function () { subTab = 'single'; paintCreator(); }
      }, icon('userPlus'), 'إنشاء حساب فردي (عربي أو إنجليزي)');

      var bulkTabBtn = h('button', {
        type: 'button',
        class: 'form-tab' + (subTab === 'bulk' ? ' active' : ''),
        onclick: function () { subTab = 'bulk'; paintCreator(); }
      }, icon('users'), 'إنشاء دفعة معلمين (سريع)');

      var subtabsNav = h('div', { class: 'form-tabs' }, singleTabBtn, bulkTabBtn);
      var content = subTab === 'single' ? renderSingleForm() : renderBulkForm();
      mount(creatorBox, subtabsNav, content);
    }

    function renderSingleForm() {
      var nameIn = h('input', { type: 'text', required: true, maxlength: '100', placeholder: 'مثال: أحمد بن سعيد الحارثي  أو  John Smith' });
      var unameIn = h('input', { type: 'text', maxlength: '80', dir: 'auto', placeholder: 'مثال: أحمد أو ahmed_s (اتركه فارغاً للتوليد التلقائي)' });
      var roleSel = h('select', null,
        h('option', { value: 'teacher', text: 'معلم (Teacher)' }),
        h('option', { value: 'viewer', text: 'مشاهد (Viewer - اطلاع فقط)' }),
        h('option', { value: 'admin', text: 'إداري (Admin / Supervisor)' }));
      var pwIn = h('input', { type: 'text', dir: 'ltr', minlength: '8', maxlength: '100', placeholder: 'كلمة مرور مخصصة أو انقر على توليد' });
      var mustChBox = h('input', { type: 'checkbox', checked: true });
      var genPwBtn = btn('توليد كلمة قوية', { sm: true, ic: 'sparkles', on: function () { pwIn.value = newRandomPassword(); } });

      var saveBtn = btn('إنشاء الحساب وتخزينه في Firebase', { kind: 'primary', ic: 'check' });
      saveBtn.onclick = function () {
        var n = nameIn.value.trim();
        if (!n) return toast('اكتب اسم صاحب الحساب', true);
        var u = unameIn.value.trim();
        var r = roleSel.value;
        var p = pwIn.value.trim();
        var mc = mustChBox.checked;

        busy(saveBtn, function () {
          return post('/api/admin/accounts', {
            name: n,
            username: u || undefined,
            role: r,
            password: p || undefined,
            must_change: mc
          }).then(function (res) {
            toast('تم إنشاء الحساب وتخزينه في Google Firebase بنجاح');
            nameIn.value = ''; unameIn.value = ''; pwIn.value = '';
            showCredentials([res.account], [], []);
            loadList();
          });
        }).catch(fail);
      };

      return h('div', { class: 'stack' },
        h('div', { class: 'grid' },
          field('الاسم الكامل (عربي أو إنجليزي)', nameIn, 'يقبل أي اسم باللغة العربية أو الإنجليزية.'),
          field('اسم المستخدم (اختياري)', unameIn, 'عربي أو إنجليزي، أو اتركه فارغاً لتوليد t01 تلقائياً.')),
        h('div', { class: 'grid' },
          field('نوع الحساب / الصلاحية', roleSel, 'المعلم يرصد الغياب، والمشاهد يطلع فقط، والإدارة تدير المنصة.'),
          field('كلمة المرور', h('div', { class: 'row' }, h('div', { class: 'grow' }, pwIn), genPwBtn), 'اتركها فارغة للتوليد العشوائي التلقائي.')),
        h('label', { class: 'row' },
          mustChBox,
          h('span', { class: 'small', text: 'إلزام المستخدم بتغيير كلمة المرور عند أول تسجيل دخول' })),
        h('div', { class: 'row end' }, saveBtn));
    }

    function renderBulkForm() {
      var text = h('textarea', { placeholder: 'أحمد بن سعيد\nسالم بن حمود\nJohn Smith\nAlexander Brown', dir: 'auto' });
      var progress = h('p', { class: 'muted small' });
      var add = btn('إنشاء الدفعة وتخزينها في Firebase', { kind: 'primary', ic: 'plus' });

      add.onclick = function () {
        var names = parseNames(text.value);
        if (!names.length) return toast('اكتب أسماء المعلمين', true);
        var made = []; var skipped = []; var failed = [];
        busy(add, function () {
          return sequence(chunks(names, 8), function (c) {
            return post('/api/admin/teachers', { names: c }).then(function (r) {
              made = made.concat(r.created);
              skipped = skipped.concat(r.skipped);
              failed = failed.concat(r.failed);
            });
          }, function (i, n) { progress.textContent = 'جاري الإنشاء في Firebase… ' + i + '/' + n; });
        }).then(function () {
          progress.textContent = ''; text.value = '';
          showCredentials(made, skipped, failed); loadList();
        }).catch(function (e) {
          progress.textContent = ''; fail(e);
          if (made.length) showCredentials(made, skipped, failed); loadList();
        });
      };

      return h('div', { class: 'stack' },
        field('أسماء المعلمين (اسم في كل سطر — عربي أو إنجليزي)', text, 'سيتم توليد أسماء مستخدمين وكلمات مرور وتخزينها في Google Firebase.'),
        progress,
        h('div', { class: 'row end' }, add));
    }

    function showCredentials(made, skipped, failed) {
      if (!made.length && !skipped.length && !failed.length) {
        mount(resultsBox); return;
      }
      var copyAllBtn = btn('نسخ بيانات الدخول', { sm: true, ic: 'copy', on: function () {
        var txt = made.map(function (t) {
          return 'الاسم: ' + t.name + ' | اسم المستخدم: ' + t.username + ' | كلمة المرور: ' + t.password;
        }).join('\n');
        copyText(txt, 'تم نسخ بيانات الدخول لـ ' + made.length + ' حساب');
      } });

      mount(resultsBox, h('div', { class: 'cred-box' },
        h('div', { class: 'head' },
          h('h3', { text: 'بيانات الدخول للحسابات المنشأة حديثاً (' + made.length + ')' }),
          h('span', { class: 'badge ok' }, icon('checkCircle'), 'مخزن في Google Firebase')),
        h('div', { class: 'note info small', text: 'تم حفظ الحسابات في Google Firebase. انسخ أو اطبع بيانات الدخول الآن لتسليمها للمستخدمين (كلمات المرور مشفرة ولا تظهر مرة أخرى).' }),
        h('div', { class: 'row noprint' },
          copyAllBtn,
          btn('طباعة البطاقات', { sm: true, ic: 'print', on: function () { printCards(made); } }),
          btn('تنزيل ملف CSV', { sm: true, ic: 'download', on: function () {
            downloadCSV('accounts-login.csv', [['الاسم', 'اسم المستخدم', 'كلمة المرور', 'الصلاحية']].concat(made.map(function (t) {
              return [t.name, t.username, t.password, t.role === 'admin' ? 'إدارة' : (t.role === 'viewer' ? 'مشاهد' : 'معلم')];
            })));
          } })),
        skipped.length ? h('p', { class: 'muted small', text: 'تم تخطي ' + skipped.length + ' اسم موجود مسبقاً.' }) : null,
        failed.length ? h('p', { class: 'err small', text: 'تعذر إنشاء ' + failed.length + ' حساب: ' + failed.map(function (f) { return f.name; }).join('، ') }) : null,
        made.length ? h('div', { class: 't-wrap' }, h('table', null,
          h('thead', null, h('tr', null, h('th', { text: 'الاسم' }), h('th', { text: 'اسم المستخدم' }), h('th', { text: 'كلمة المرور' }), h('th', { text: 'الصلاحية' }), h('th', { text: 'نسخ' }))),
          h('tbody', null, made.map(function (t) {
            var roleLabel = t.role === 'admin' ? 'إدارة' : (t.role === 'viewer' ? 'مشاهد' : 'معلم');
            var roleBadgeClass = t.role === 'admin' ? 'gold' : (t.role === 'viewer' ? '' : 'accent');
            return h('tr', null,
              h('td', null, h('b', { text: t.name })),
              h('td', null, ltr(t.username)),
              h('td', { class: 'cred' }, ltr(t.password)),
              h('td', null, h('span', { class: 'badge ' + roleBadgeClass, text: roleLabel })),
              h('td', null, btn('نسخ', { sm: true, ic: 'copy', on: function () {
                copyText('اسم المستخدم: ' + t.username + '\nكلمة المرور: ' + t.password, 'تم نسخ بيانات ' + t.name);
              } })));
          })))) : null));
    }

    function printCards(items) {
      var sheet = h('div', { class: 'cred-sheet' }, items.map(function (t) {
        var roleLabel = t.role === 'admin' ? 'إدارة' : (t.role === 'viewer' ? 'مشاهد' : 'معلم');
        return h('div', { class: 'cred-card' },
          h('b', { text: S.pub.school_name || 'منصة المدرسة' }),
          h('div', null, 'الاسم: ', h('b', { text: t.name })),
          h('div', null, 'اسم المستخدم: ', ltr(t.username)),
          h('div', { class: 'cred' }, 'كلمة المرور: ', ltr(t.password)),
          h('div', { class: 'small muted', text: 'الصلاحية: ' + roleLabel }));
      }));
      document.body.append(sheet); document.body.classList.add('print-cred');
      var clean = function () { sheet.remove(); document.body.classList.remove('print-cred'); window.removeEventListener('afterprint', clean); };
      window.addEventListener('afterprint', clean); window.print();
    }

    function loadList() {
      get('/api/admin/teachers').then(function (r) {
        teachers = r.teachers || [];
        paintStats();
        paintList();
      }).catch(fail);
    }

    function paintList() {
      var f = q.value.trim().toLowerCase();
      var rFilter = roleFilter.value;
      var sFilter = statusFilter.value;

      var shown = teachers.filter(function (t) {
        var matchQuery = !f || t.name.toLowerCase().indexOf(f) >= 0 || t.username.toLowerCase().indexOf(f) >= 0;
        var matchRole = !rFilter || (t.role || 'teacher') === rFilter;
        var matchStatus = !sFilter || (sFilter === 'active' ? !t.must_change : !!t.must_change);
        return matchQuery && matchRole && matchStatus;
      });

      mount(list,
        h('div', { class: 'row between' },
          h('p', { class: 'muted small', text: 'عدد الحسابات المعروضة: ' + shown.length + ' من أصل ' + teachers.length }),
          h('span', { class: 'small muted', text: 'تحديث فوري' })),
        shown.length ? shown.map(accountRow) : empty('لا توجد حسابات مطابقة لمعايير البحث'));
    }

    function openRoleChangeModal(t) {
      var currentRole = t.role || 'teacher';
      var sel = h('select', { 'aria-label': 'الدور الجديد' },
        h('option', { value: 'teacher', text: 'معلم (Teacher) — رصد الحضور والغياب والاطلاع على التقارير' }),
        h('option', { value: 'viewer', text: 'مشاهد (Viewer) — اطلاع فقط على الغياب اليومي ونشاط المعلمين' }),
        h('option', { value: 'admin', text: 'إداري (Admin) — إدارة الحسابات والصفوف والإعدادات' }));
      sel.value = currentRole;

      var box;
      var saveBtn = btn('حفظ الدور الجديد', { kind: 'primary', ic: 'check' });
      saveBtn.onclick = function () {
        var newRole = sel.value;
        if (newRole === currentRole) {
          if (box) box.close();
          return;
        }
        busy(saveBtn, function () {
          return api('PUT', '/api/admin/teachers/' + t.uid + '/role', { role: newRole }).then(function () {
            var roleNames = { teacher: 'معلم', viewer: 'مشاهد (اطلاع فقط)', admin: 'إدارة' };
            toast('تم تحديث دور ' + t.name + ' إلى ' + (roleNames[newRole] || newRole) + ' بنجاح ومزامنته في Firebase');
            if (box) box.close();
            loadList();
          });
        }).catch(fail);
      };

      box = overlay([
        h('div', { class: 'dlg-head' }, icon('shieldCheck'), h('h3', { text: 'تعديل صلاحية ودور الحساب' })),
        h('p', null, 'المستخدم: ', h('b', { text: t.name }), ' (', ltr(t.username), ')'),
        field('اختر الدور الجديد', sel, 'سيتم تحديث الدور في قاعدة البيانات وGoogle Firebase فورياً.'),
        h('div', { class: 'acts' },
          btn('إلغاء', { on: function () { if (box) box.close(); } }),
          saveBtn)
      ]);
    }

    function accountRow(t) {
      var isAdmin = t.role === 'admin';
      var isViewer = t.role === 'viewer';
      var initials = t.name.slice(0, 1) || 'U';

      var roleBadge = isAdmin ? h('span', { class: 'badge gold', text: 'إدارة' })
        : (isViewer ? h('span', { class: 'badge', text: 'مشاهد (اطلاع فقط)' })
          : h('span', { class: 'badge accent', text: 'معلم' }));

      var copyUnameBtn = btn('نسخ', { sm: true, ic: 'copy', title: 'نسخ اسم المستخدم', tooltip: 'نسخ اسم المستخدم', on: function () {
        copyText(t.username, 'تم نسخ اسم المستخدم: ' + t.username);
      } });

      var promoteBtn = isViewer ? btn('ترقية إلى معلم', {
        sm: true,
        kind: 'primary',
        ic: 'userPlus',
        title: 'ترقية الحساب إلى معلم لمنحه صلاحية رصد الحضور',
        tooltip: 'ترقية إلى معلم (تمكينه من رصد الحصص)',
        on: function () {
          confirmBox('ترقية الحساب إلى معلم؟', 'سيتم تحويل دور ' + t.name + ' من (مشاهد) إلى (معلم) ومزامنته في Firebase ليتمكن من رصد حضور وغياب الطلاب.', 'ترقية إلى معلم').then(function (ok) {
            if (!ok) return;
            api('PUT', '/api/admin/teachers/' + t.uid + '/role', { role: 'teacher' }).then(function () {
              toast('تمت ترقية ' + t.name + ' إلى معلم بنجاح وتحديث Firebase');
              loadList();
            }).catch(fail);
          });
        }
      }) : null;

      var changeRoleBtn = btn('تغيير الدور', {
        sm: true,
        ic: 'shieldCheck',
        title: 'تغيير دور وصلاحية المستخدم ومزامنتها في Firebase',
        tooltip: 'تغيير الدور (معلم / مشاهد / إدارة)',
        on: function () {
          openRoleChangeModal(t);
        }
      });

      var resetBtn = btn('كلمة مرور جديدة', { sm: true, ic: 'key', title: 'توليد كلمة مرور جديدة وحفظها في Firebase', tooltip: 'توليد كلمة مرور جديدة وحفظها في Firebase', on: function () {
        confirmBox('إعادة تعيين كلمة المرور؟', 'سيتم توليد كلمة مرور جديدة وحفظها في Google Firebase وتسجيل خروج ' + t.name + ' من الأجهزة.', 'إعادة تعيين').then(function (ok) {
          if (!ok) return;
          post('/api/admin/teachers/' + t.uid + '/reset').then(function (r) {
            infoBox('كلمة المرور الجديدة (تم التحديث في Firebase)', h('div', { class: 'stack' },
              h('p', null, r.name, ' — ', ltr(r.username)),
              h('p', { class: 'cred' }, ltr(r.password)),
              h('div', { class: 'row' }, btn('نسخ كلمة المرور', { sm: true, ic: 'copy', tooltip: 'نسخ كلمة المرور إلى الحافظة', on: function () {
                copyText(r.password, 'تم نسخ كلمة المرور');
              } })),
              h('p', { class: 'muted small', text: 'احفظها الآن، فلن تظهر مرة أخرى.' })));
            loadList();
          }).catch(fail);
        });
      } });

      var delBtn = btn('حذف', { sm: true, kind: 'danger', ic: 'trash', title: 'حذف الحساب نهائياً', tooltip: 'حذف الحساب نهائياً من Firebase وقاعدة البيانات', on: function () {
        confirmBox('حذف الحساب نهائياً؟', 'سيُحذف حساب ' + t.name + ' من قاعدة البيانات ومن Google Firebase.', 'حذف نهائي', true).then(function (ok) {
          if (ok) api('DELETE', '/api/admin/teachers/' + t.uid).then(function () {
            toast('تم حذف الحساب بنجاح من قاعدة البيانات وFirebase');
            loadList();
          }).catch(fail);
        });
      } });

      return h('div', { class: 'acc-card' },
        h('div', { class: 'avatar', text: initials }),
        h('div', { class: 'acc-info' },
          h('div', { class: 'row' },
            h('span', { class: 'name', text: t.name }),
            roleBadge,
            t.must_change ? h('span', { class: 'badge warn', text: 'بانتظار تغيير كلمة المرور' }) : h('span', { class: 'badge ok', text: 'نشط' })),
          h('div', { class: 'uname' },
            h('span', { text: 'اسم المستخدم: ' }),
            ltr(t.username),
            copyUnameBtn,
            t.email && h('span', { class: 'small muted' }, ' • بريد: ', ltr(t.email)))),
        h('div', { class: 'acc-acts' },
          promoteBtn,
          changeRoleBtn,
          resetBtn,
          delBtn));
    }

    q.addEventListener('input', paintList);
    roleFilter.addEventListener('change', paintList);
    statusFilter.addEventListener('change', paintList);

    paintFbBanner();
    paintCreator();

    host.append(
      fbBanner,
      statsBox,
      h('div', { class: 'card' },
        h('h2', null, h('span', { text: 'إنشاء وإضافة حسابات جديدة' }), icon('userPlus')),
        creatorBox),
      resultsBox,
      h('div', { class: 'card' },
        h('h2', null, h('span', { text: 'دليل وإدارة الحسابات المسجلة' }), icon('users')),
        h('div', { class: 'stack' },
          h('div', { class: 'grid' }, q, roleFilter, statusFilter),
          list)));

    loadList();
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
    var fbSyncStatus = h('div', { class: 'small' });
    var fbSyncBtn = btn('مزامنة شاملة الآن مع Firestore', { sm: true, ic: 'refresh', title: 'مزامنة مع Google Firebase', tooltip: 'مزامنة شاملة للحسابات والصفوف مع Cloud Firestore', on: function () {
      busy(fbSyncBtn, function () { return post('/api/admin/firebase/sync'); })
        .then(function (r) {
          toast(r.message || 'تمت مزامنة البيانات مع Firebase');
          mount(fbSyncStatus, h('span', { class: 'badge ok' }, icon('checkCircle'),
            'تمت المزامنة: ' + (r.synced ? r.synced.users : '') + ' حساب، ' + (r.synced ? r.synced.groups : '') + ' صف، والإعدادات.'));
        }).catch(fail);
    } });

    var auditBox = h('div');
    var auditBtn = btn('عرض آخر العمليات', { sm: true, on: function () {
      mount(auditBox, skeleton(3));
      get('/api/admin/audit').then(function (r) {
        mount(auditBox, h('div', { class: 't-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: 'الوقت' }), h('th', { text: 'المنفّذ' }), h('th', { text: 'العملية' }), h('th', { text: 'التفاصيل' }))),
          h('tbody', null, r.entries.map(function (e) { return h('tr', null, h('td', null, ltr(new Date(e.at).toLocaleString('en-GB', { timeZone: S.config.timezone }))), h('td', { text: e.actor }), h('td', { text: e.action }), h('td', { class: 'small', text: e.details })); })))));
      }).catch(fail);
    } });
    host.append(
      h('div', { class: 'card' }, h('h2', { text: 'بيانات المدرسة' }), h('div', { class: 'stack' }, field('اسم المدرسة', school), field('مدير المدرسة', principal), field('حقوق التطوير والبرمجة', dev), h('div', { class: 'row end' }, saveInfo))),
      h('div', { class: 'card' },
        h('h2', null, h('span', { text: 'قاعدة بيانات Google Firebase' }), icon('database')),
        h('div', { class: 'fb-banner' },
          h('div', { class: 'fb-icon' }, icon('database')),
          h('div', { class: 'fb-text' },
            h('b', { text: 'Google Firebase (Authentication & Cloud Firestore)' }),
            h('span', { text: 'يتم تخزين الحسابات والبيانات في Firebase. يمكنك إجراء مزامنة فورية شاملة للمستخدمين والصفوف والإعدادات بنقرة واحدة.' }))),
        h('div', { class: 'row' }, fbSyncBtn, fbSyncStatus)),
      h('div', { class: 'card' }, h('h2', { text: 'لائحة الإجراءات حسب أيام الغياب' }), h('p', { class: 'muted small', text: 'يُطبَّق أعلى إجراء بلغه الطالب خلال الشهر. أقل رقم هنا هو حد ظهور الطالب في التقرير الشهري.' }), rulesBox,
        h('div', { class: 'row' }, btn('إضافة قاعدة', { sm: true, ic: 'plus', on: function () { rules.push({ min_days: 1, label: '', color: '#06b6d4' }); paintRules(); } }), saveRules)),
      h('div', { class: 'card' }, h('h2', { text: 'سجل العمليات' }), h('div', { class: 'stack' }, auditBtn, auditBox)));
  }

  /* ---------------------------------------------------------------- 9) التشغيل */
  window.addEventListener('hashchange', render);
  try { var saved = localStorage.getItem('theme'); if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved); } catch (e) { /* ok */ }
  var DEFAULT_PUB = { school_name: 'مدرسة الشيخ سالم الصائغي', principal_name: 'الأستاذ يونس الحجري', developer_credit: 'الأستاذ منير الصالحي' };
  Promise.all([get('/api/public').catch(function () { return null; }), loadMe().catch(function () { return null; })]).then(function (r) {
    S.offline = !r[0]; S.pub = r[0] || DEFAULT_PUB; render();
  });
})();
