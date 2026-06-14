/**
 * 前端单页应用：受试者随访提醒与访视窗口计算系统
 * 原生 JS 实现，通过 fetch 调用后端 REST API。
 */

const TOKEN_KEY = 'followup_token';
const USER_KEY = 'followup_user';

/** 获取本地存储的 token / user */
function getToken() { return localStorage.getItem(TOKEN_KEY); }
function getUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
  catch (e) { return null; }
}
function setAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/** 统一 fetch 封装：自动加 token、解析 JSON、处理错误 */
async function api(path, options = {}) {
  const headers = options.headers || {};
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, { ...options, headers });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || ('HTTP ' + res.status));
      err.status = res.status; err.body = data; throw err;
    }
    return data;
  } else {
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(text || ('HTTP ' + res.status));
      err.status = res.status; throw err;
    }
    return text;
  }
}

/** 用于二进制下载：返回 Blob */
async function apiBlob(path, options = {}) {
  const headers = options.headers || {};
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.blob();
}

/** 触发浏览器下载 */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** HTML 转义 */
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"'/]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#2F;' }[c]
  ));
}

const appEl = document.getElementById('app');
const userInfo = document.getElementById('userInfo');
const logoutBtn = document.getElementById('logoutBtn');

/** 渲染当前用户信息 */
function renderUserInfo() {
  const u = getUser();
  if (u) {
    userInfo.textContent = (u.role === 'pi' ? 'PI' : 'CRC') + ' · ' + (u.display_name || u.username);
    logoutBtn.style.display = '';
  } else {
    userInfo.textContent = '未登录';
    logoutBtn.style.display = 'none';
  }
}

logoutBtn.addEventListener('click', () => {
  clearAuth(); renderUserInfo(); showView('dashboard');
});

/** 显示提示信息 */
function notice(msg, type) {
  const cls = type === 'error' ? 'tag-overdue' : (type === 'success' ? 'tag-normal' : '');
  return '<div class="notice ' + cls + '">' + esc(msg) + '</div>';
}

/** 视图路由 */
const views = {};
function showView(name) {
  document.querySelectorAll('#nav button').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === name);
  });
  if (views[name]) {
    views[name]();
  } else {
    appEl.innerHTML = '<div class="empty">未知视图：' + esc(name) + '</div>';
  }
}

document.getElementById('nav').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  showView(btn.dataset.view);
});

// ==================== 登录 ====================
views.login = function () {
  appEl.innerHTML = `
    <div class="card" style="max-width:420px;margin:2rem auto;">
      <h2>登录</h2>
      <div id="loginNotice"></div>
      <div class="form-group" style="margin-bottom:0.75rem;">
        <label>用户名</label>
        <input id="loginUser" placeholder="admin / crc" autocomplete="username" />
      </div>
      <div class="form-group" style="margin-bottom:1rem;">
        <label>密码</label>
        <input id="loginPass" type="password" placeholder="admin123 / crc123" autocomplete="current-password" />
      </div>
      <button class="btn btn-success" id="loginSubmit">登录</button>
      <p class="muted" style="margin-top:1rem;">
        默认账户：PI（admin/admin123）、CRC（crc/crc123）
      </p>
    </div>`;
  document.getElementById('loginSubmit').onclick = async () => {
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value;
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setAuth(data.token, data.user);
      renderUserInfo();
      showView('dashboard');
    } catch (err) {
      document.getElementById('loginNotice').innerHTML = notice(err.message, 'error');
    }
  };
};

// ==================== 仪表盘 ====================
views.dashboard = async function () {
  appEl.innerHTML = '<div class="card"><h2>仪表盘</h2><div id="dashBody">加载中…</div></div>';
  try {
    const [today, tomorrow, week, stats, devSummary] = await Promise.all([
      api('/api/reminders/today'),
      api('/api/reminders/tomorrow'),
      api('/api/reminders/week'),
      api('/api/reminders/stats'),
      api('/api/deviations/summary'),
    ]);
    const t = Array.isArray(today) ? today : (today.items || []);
    const tm = Array.isArray(tomorrow) ? tomorrow : (tomorrow.items || []);
    const wk = Array.isArray(week) ? week : (week.items || []);
    const s = stats && stats.stats ? stats.stats : (stats || {});
    const ds = devSummary && devSummary.summary ? devSummary.summary : (devSummary || {});
    document.getElementById('dashBody').innerHTML = `
      <div class="stats">
        <div class="stat-item"><div class="num">${(t || []).length}</div><div class="label">今日提醒</div></div>
        <div class="stat-item"><div class="num">${(tm || []).length}</div><div class="label">明日提醒</div></div>
        <div class="stat-item urgent"><div class="num">${(wk || []).length}</div><div class="label">本周提醒</div></div>
        <div class="stat-item danger"><div class="num">${ds.total || ds.open || 0}</div><div class="label">方案偏离</div></div>
      </div>
      <div class="card">
        <h3>今日待办（${(t || []).length}）</h3>
        ${renderReminderTable(t)}
      </div>`;
  } catch (err) {
    document.getElementById('dashBody').innerHTML = notice(err.message, 'error');
  }
};

function renderReminderTable(items) {
  if (!items || !items.length) return '<p class="empty">暂无提醒</p>';
  return `<table><thead><tr>
    <th>受试者</th><th>研究</th><th>访视</th><th>计划日期</th><th>窗口</th><th>状态</th>
  </tr></thead><tbody>${items.map((r) => `
    <tr>
      <td>${esc(r.subject_code || r.subjectCode || '-')}</td>
      <td>${esc(r.study_code || r.studyCode || '-')}</td>
      <td>${esc(r.visit_name || r.visitName || '-')}</td>
      <td>${esc(r.planned_date || r.plannedDate || '-')}</td>
      <td>${esc(r.window_start || r.windowStart || '')} ~ ${esc(r.window_end || r.windowEnd || '')}</td>
      <td>${renderStatusTag(r.status)}</td>
    </tr>`).join('')}</tbody></table>`;
}

function renderStatusTag(status) {
  const map = {
    pending: ['待访视', 'tag-normal'],
    planned: ['待访视', 'tag-normal'],
    urgent: ['紧急', 'tag-urgent'],
    overdue: ['超期', 'tag-overdue'],
    completed: ['已完成', 'tag-completed'],
    done: ['已完成', 'tag-completed'],
    deviation: ['已偏离', 'tag-deviation'],
    dropped: ['已脱落', 'tag-dropped'],
    cancelled: ['已取消', 'tag-dropped'],
  };
  const m = map[status] || ['未知', ''];
  return '<span class="tag ' + m[1] + '">' + m[0] + '</span>';
}

// ==================== 研究项目 ====================
views.studies = async function () {
  appEl.innerHTML = '<div class="card"><h2>研究项目</h2><div id="studiesBody">加载中…</div></div>';
  try {
    const data = await api('/api/studies');
    const list = Array.isArray(data) ? data : (data.studies || data.items || []);
    const u = getUser();
    const canWrite = u && u.role === 'pi';
    document.getElementById('studiesBody').innerHTML = `
      ${canWrite ? `
      <div class="card">
        <h3>新增研究项目</h3>
        <div class="form-row">
          <div class="form-group"><label>项目编号</label><input id="newStudyCode"></div>
          <div class="form-group"><label>项目名称</label><input id="newStudyName"></div>
          <div class="form-group"><label>描述</label><input id="newStudyDesc"></div>
          <button class="btn btn-success" id="addStudyBtn">创建</button>
        </div>
      </div>` : ''}
      <table><thead><tr><th>ID</th><th>编号</th><th>名称</th><th>描述</th>${canWrite ? '<th>操作</th>' : ''}</tr></thead>
      <tbody>${list.map((s) => `
        <tr>
          <td>${esc(s.id)}</td>
          <td>${esc(s.study_code || s.code)}</td>
          <td>${esc(s.study_name || s.name)}</td>
          <td>${esc(s.description || '')}</td>
          ${canWrite ? `<td><button class="btn btn-sm btn-danger" data-del-study="${s.id}">删除</button></td>` : ''}
        </tr>`).join('')}</tbody></table>`;
    if (canWrite) {
      document.getElementById('addStudyBtn').onclick = async () => {
        try {
          await api('/api/studies', {
            method: 'POST',
            body: JSON.stringify({
              study_code: document.getElementById('newStudyCode').value.trim(),
              study_name: document.getElementById('newStudyName').value.trim(),
              description: document.getElementById('newStudyDesc').value.trim(),
            }),
          });
          showView('studies');
        } catch (err) { alert(err.message); }
      };
      document.querySelectorAll('[data-del-study]').forEach((b) => {
        b.onclick = async () => {
          if (!confirm('确认删除该研究项目？')) return;
          try { await api('/api/studies/' + b.dataset.delStudy, { method: 'DELETE' }); showView('studies'); }
          catch (err) { alert(err.message); }
        };
      });
    }
  } catch (err) {
    document.getElementById('studiesBody').innerHTML = notice(err.message, 'error');
  }
};

// ==================== 受试者 ====================
views.subjects = async function () {
  appEl.innerHTML = '<div class="card"><h2>受试者</h2><div id="subjBody">加载中…</div></div>';
  try {
    const studiesData = await api('/api/studies');
    const studies = Array.isArray(studiesData) ? studiesData : (studiesData.studies || []);
    let allSubjects = [];
    for (const st of studies) {
      const sd = await api('/api/studies/' + st.id + '/subjects');
      const list = Array.isArray(sd) ? sd : (sd.subjects || sd.items || []);
      list.forEach((s) => { s.study_code = st.study_code || st.code; s.study_id = st.id; });
      allSubjects = allSubjects.concat(list);
    }
    const u = getUser();
    const canWrite = !!u;
    document.getElementById('subjBody').innerHTML = `
      <div class="toolbar">
        <select id="filterStudy">
          <option value="">全部研究</option>
          ${studies.map((s) => `<option value="${s.id}">${esc(s.study_code || s.code)}</option>`).join('')}
        </select>
        <input id="searchSubj" placeholder="搜索受试者编号…">
      </div>
      ${canWrite ? `
      <div class="card">
        <h3>新增受试者</h3>
        <div class="form-row">
          <div class="form-group"><label>研究项目</label><select id="newSubjStudy">${studies.map((s) => `<option value="${s.id}">${esc(s.study_code || s.code)}</option>`).join('')}</select></div>
          <div class="form-group"><label>受试者编号</label><input id="newSubjCode"></div>
          <div class="form-group"><label>入组日期</label><input id="newSubjDate" type="date"></div>
          <div class="form-group"><label>性别</label><select id="newSubjGender"><option value="M">男</option><option value="F">女</option></select></div>
          <button class="btn btn-success" id="addSubjBtn">创建并生成访视</button>
        </div>
      </div>` : ''}
      <div id="subjTable">${renderSubjectTable(allSubjects)}</div>`;
    document.getElementById('filterStudy').onchange = applySubjFilter;
    document.getElementById('searchSubj').oninput = applySubjFilter;
    function applySubjFilter() {
      const fid = document.getElementById('filterStudy').value;
      const kw = document.getElementById('searchSubj').value.toLowerCase();
      const filtered = allSubjects.filter((s) =>
        (!fid || String(s.study_id) === String(fid)) &&
        (!kw || (s.subject_code || s.code || '').toLowerCase().includes(kw))
      );
      document.getElementById('subjTable').innerHTML = renderSubjectTable(filtered);
    }
    if (canWrite) {
      document.getElementById('addSubjBtn').onclick = async () => {
        const studyId = document.getElementById('newSubjStudy').value;
        const code = document.getElementById('newSubjCode').value.trim();
        const date = document.getElementById('newSubjDate').value;
        const gender = document.getElementById('newSubjGender').value;
        try {
          const created = await api('/api/studies/' + studyId + '/subjects', {
            method: 'POST',
            body: JSON.stringify({ subject_code: code, enrollment_date: date, gender }),
          });
          const sid = created.id || created.subject_id;
          if (sid) {
            await api('/api/subjects/' + sid + '/visits/generate', { method: 'POST' });
          }
          showView('subjects');
        } catch (err) { alert(err.message); }
      };
    }
  } catch (err) {
    document.getElementById('subjBody').innerHTML = notice(err.message, 'error');
  }
};

function renderSubjectTable(list) {
  if (!list.length) return '<p class="empty">暂无受试者</p>';
  return `<table><thead><tr><th>编号</th><th>研究</th><th>入组日期</th><th>性别</th><th>状态</th></tr></thead>
  <tbody>${list.map((s) => `
    <tr>
      <td>${esc(s.subject_code || s.code)}</td>
      <td>${esc(s.study_code || '-')}</td>
      <td>${esc(s.enrollment_date || '-')}</td>
      <td>${esc(s.gender === 'F' ? '女' : '男')}</td>
      <td>${renderStatusTag(s.status)}</td>
    </tr>`).join('')}</tbody></table>`;
}

// ==================== 访视计划 ====================
views.visits = async function () {
  appEl.innerHTML = '<div class="card"><h2>访视计划</h2><div id="visitsBody">加载中…</div></div>';
  try {
    const studiesData = await api('/api/studies');
    const studies = Array.isArray(studiesData) ? studiesData : (studiesData.studies || []);
    let allVisits = [];
    for (const st of studies) {
      const vd = await api('/api/studies/' + st.id + '/visits');
      const list = Array.isArray(vd) ? vd : (vd.visits || vd.items || []);
      list.forEach((v) => { v.study_code = st.study_code || st.code; });
      allVisits = allVisits.concat(list);
    }
    const u = getUser();
    const canWrite = !!u;
    document.getElementById('visitsBody').innerHTML = `
      <div class="toolbar">
        <input id="searchVisit" placeholder="搜索访视…">
      </div>
      <div id="visitsTable">${renderVisitTable(allVisits, canWrite)}</div>`;
    document.getElementById('searchVisit').oninput = (e) => {
      const kw = e.target.value.toLowerCase();
      const filtered = allVisits.filter((v) =>
        !kw ||
        (v.visit_name || '').toLowerCase().includes(kw) ||
        (v.subject_code || '').toLowerCase().includes(kw) ||
        (v.study_code || '').toLowerCase().includes(kw)
      );
      document.getElementById('visitsTable').innerHTML = renderVisitTable(filtered, canWrite);
    };
    if (canWrite) {
      document.querySelectorAll('[data-fill]').forEach((b) => {
        b.onclick = () => {
          const id = b.dataset.fill;
          const d = prompt('请输入实际访视日期（YYYY-MM-DD）：');
          if (!d) return;
          api('/api/visits/' + id + '/fill-actual', {
            method: 'POST',
            body: JSON.stringify({ actual_date: d }),
          }).then(() => showView('visits'))
            .catch((err) => alert(err.message));
        };
      });
    }
  } catch (err) {
    document.getElementById('visitsBody').innerHTML = notice(err.message, 'error');
  }
};

function renderVisitTable(list, canWrite) {
  if (!list.length) return '<p class="empty">暂无访视记录</p>';
  return `<table><thead><tr>
    <th>研究</th><th>受试者</th><th>访视</th><th>计划日期</th><th>窗口</th><th>实际日期</th><th>状态</th>${canWrite ? '<th>操作</th>' : ''}
  </tr></thead><tbody>${list.map((v) => `
    <tr>
      <td>${esc(v.study_code || '-')}</td>
      <td>${esc(v.subject_code || '-')}</td>
      <td>${esc(v.visit_name || v.name || '-')}</td>
      <td>${esc(v.planned_date || '-')}</td>
      <td>${esc(v.window_start || '')} ~ ${esc(v.window_end || '')}</td>
      <td>${esc(v.actual_date || '-')}</td>
      <td>${renderStatusTag(v.status)}</td>
      ${canWrite ? `<td><button class="btn btn-sm btn-warning" data-fill="${v.id}">回填</button></td>` : ''}
    </tr>`).join('')}</tbody></table>`;
}

// ==================== 日历视图 ====================
views.calendar = async function () {
  const today = new Date();
  const y = today.getFullYear(), m = today.getMonth();
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 0);
  const fmt = (d) => d.toISOString().slice(0, 10);
  appEl.innerHTML = `
    <div class="card">
      <h2>📅 日历视图（${y}年${m + 1}月）</h2>
      <div class="toolbar">
        <button class="btn btn-sm" id="calPrev">上月</button>
        <span id="calTitle"></span>
        <button class="btn btn-sm" id="calNext">下月</button>
      </div>
      <div id="calBody">加载中…</div>
    </div>`;
  let curY = y, curM = m;
  async function loadMonth(yy, mm) {
    document.getElementById('calTitle').textContent = yy + '年' + (mm + 1) + '月';
    const s = new Date(yy, mm, 1);
    const e = new Date(yy, mm + 1, 0);
    try {
      const data = await api('/api/visits/calendar?start_date=' + fmt(s) + '&end_date=' + fmt(e));
      const items = Array.isArray(data) ? data : (data.items || data.visits || []);
      renderCalendar(yy, mm, items);
    } catch (err) {
      document.getElementById('calBody').innerHTML = notice(err.message, 'error');
    }
  }
  function renderCalendar(yy, mm, items) {
    const first = new Date(yy, mm, 1);
    const last = new Date(yy, mm + 1, 0);
    const startDay = first.getDay();
    const days = last.getDate();
    const todayStr = fmt(today);
    const byDate = {};
    items.forEach((v) => {
      const d = v.planned_date || v.plannedDate || v.date;
      if (!d) return;
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(v);
    });
    let html = '<table class="calendar"><thead><tr>' +
      ['日', '一', '二', '三', '四', '五', '六'].map((d) => '<th>' + d + '</th>').join('') +
      '</tr></thead><tbody><tr>';
    for (let i = 0; i < startDay; i++) html += '<td class="cal-empty"></td>';
    for (let d = 1; d <= days; d++) {
      const ds = fmt(new Date(yy, mm, d));
      const isToday = ds === todayStr;
      const dayItems = byDate[ds] || [];
      html += '<td class="' + (isToday ? 'cal-today' : 'cal-day') + '">';
      html += '<div class="cal-date">' + d + '</div>';
      html += '<div class="cal-items">';
      dayItems.slice(0, 3).forEach((v) => {
        const cls = v.status === 'completed' || v.status === 'done' ? 'done' :
          (v.status === 'deviation' ? 'deviation' : '');
        html += '<div class="cal-item ' + cls + '">' +
          esc((v.subject_code || '') + ' ' + (v.visit_name || '')) + '</div>';
      });
      if (dayItems.length > 3) html += '<div class="cal-item">+' + (dayItems.length - 3) + '</div>';
      html += '</div></td>';
      if ((startDay + d) % 7 === 0 && d < days) html += '</tr><tr>';
    }
    html += '</tr></tbody></table>';
    document.getElementById('calBody').innerHTML = html;
  }
  document.getElementById('calPrev').onclick = () => {
    curM--; if (curM < 0) { curM = 11; curY--; }
    loadMonth(curY, curM);
  };
  document.getElementById('calNext').onclick = () => {
    curM++; if (curM > 11) { curM = 0; curY++; }
    loadMonth(curY, curM);
  };
  loadMonth(curY, curM);
};

// ==================== 提醒清单 ====================
views.reminders = async function () {
  appEl.innerHTML = '<div class="card"><h2>提醒清单</h2><div id="remBody">加载中…</div></div>';
  try {
    const [today, tomorrow, week] = await Promise.all([
      api('/api/reminders/today'),
      api('/api/reminders/tomorrow'),
      api('/api/reminders/week'),
    ]);
    const t = Array.isArray(today) ? today : (today.items || []);
    const tm = Array.isArray(tomorrow) ? tomorrow : (tomorrow.items || []);
    const wk = Array.isArray(week) ? week : (week.items || []);
    document.getElementById('remBody').innerHTML = `
      <div class="card"><h3>今日提醒（${t.length}）</h3>${renderReminderTable(t)}</div>
      <div class="card"><h3>明日提醒（${tm.length}）</h3>${renderReminderTable(tm)}</div>
      <div class="card"><h3>本周提醒（${wk.length}）</h3>${renderReminderTable(wk)}</div>`;
  } catch (err) {
    document.getElementById('remBody').innerHTML = notice(err.message, 'error');
  }
};

// ==================== 方案偏离 ====================
views.deviations = async function () {
  appEl.innerHTML = '<div class="card"><h2>方案偏离</h2><div id="devBody">加载中…</div></div>';
  try {
    const [summaryData, listData] = await Promise.all([
      api('/api/deviations/summary'),
      api('/api/deviations'),
    ]);
    const summary = summaryData.summary || summaryData;
    const list = Array.isArray(listData) ? listData : (listData.items || listData.deviations || []);
    const u = getUser();
    document.getElementById('devBody').innerHTML = `
      <div class="toolbar">
        <button class="btn btn-warning" id="autoDetectBtn">🔍 自动检测偏离</button>
      </div>
      <div class="stats">
        <div class="stat-item"><div class="num">${summary.total || 0}</div><div class="label">总偏离</div></div>
        <div class="stat-item urgent"><div class="num">${summary.open || 0}</div><div class="label">未处理</div></div>
        <div class="stat-item"><div class="num">${summary.resolved || 0}</div><div class="label">已处理</div></div>
      </div>
      <div id="devResult"></div>
      ${renderDeviationTable(list)}`;
    document.getElementById('autoDetectBtn').onclick = async () => {
      try {
        const r = await api('/api/deviations/auto-detect', { method: 'POST' });
        const cnt = r.detected || r.count || (Array.isArray(r.deviations) ? r.deviations.length : 0);
        document.getElementById('devResult').innerHTML =
          notice('检测完成，新增 ' + cnt + ' 条偏离记录', 'success');
        showView('deviations');
      } catch (err) { alert(err.message); }
    };
  } catch (err) {
    document.getElementById('devBody').innerHTML = notice(err.message, 'error');
  }
};

function renderDeviationTable(list) {
  if (!list.length) return '<p class="empty">暂无偏离记录</p>';
  return `<table><thead><tr>
    <th>受试者</th><th>访视</th><th>类型</th><th>描述</th><th>检测日期</th><th>状态</th>
  </tr></thead><tbody>${list.map((d) => `
    <tr>
      <td>${esc(d.subject_code || '-')}</td>
      <td>${esc(d.visit_name || '-')}</td>
      <td>${esc(d.deviation_type || d.type || '-')}</td>
      <td>${esc(d.description || '')}</td>
      <td>${esc(d.detected_date || d.created_at || '-')}</td>
      <td>${renderStatusTag(d.status)}</td>
    </tr>`).join('')}</tbody></table>`;
}

// ==================== 批量导入 ====================
views.import = async function () {
  const u = getUser();
  if (!u) {
    appEl.innerHTML = notice('请先登录后再使用批量导入。', 'error') +
      '<button class="btn" onclick="showView(\'login\')">去登录</button>';
    return;
  }
  appEl.innerHTML = '<div class="card"><h2>批量导入受试者</h2><div id="impBody">加载中…</div></div>';
  try {
    const studiesData = await api('/api/studies');
    const studies = Array.isArray(studiesData) ? studiesData : (studiesData.studies || []);
    document.getElementById('impBody').innerHTML = `
      <div class="card">
        <h3>上传 Excel 文件</h3>
        <div class="form-row">
          <div class="form-group">
            <label>目标研究</label>
            <select id="impStudy">${studies.map((s) => `<option value="${s.id}">${esc(s.study_code || s.code)}</option>`).join('')}</select>
          </div>
          <div class="form-group">
            <label>Excel 文件（.xlsx）</label>
            <input id="impFile" type="file" accept=".xlsx,.xls">
          </div>
          <button class="btn btn-success" id="impBtn">上传导入</button>
        </div>
        <p class="muted">表头需包含：subject_code（受试者编号）、enrollment_date（入组日期）、gender（性别 M/F）</p>
      </div>
      <div id="impResult"></div>`;
    document.getElementById('impBtn').onclick = async () => {
      const studyId = document.getElementById('impStudy').value;
      const fileInput = document.getElementById('impFile');
      if (!fileInput.files.length) { alert('请选择文件'); return; }
      const fd = new FormData();
      fd.append('file', fileInput.files[0]);
      try {
        const r = await api('/api/studies/' + studyId + '/import-subjects', {
          method: 'POST', body: fd,
        });
        const cnt = r.imported || r.count || (r.subjects ? r.subjects.length : 0);
        document.getElementById('impResult').innerHTML =
          notice('导入成功，共 ' + cnt + ' 条受试者记录。', 'success');
      } catch (err) {
        document.getElementById('impResult').innerHTML = notice(err.message, 'error');
      }
    };
  } catch (err) {
    document.getElementById('impBody').innerHTML = notice(err.message, 'error');
  }
};

// ==================== 数据导出 ====================
views.export = async function () {
  const u = getUser();
  if (!u) {
    appEl.innerHTML = notice('请先登录后再使用数据导出。', 'error') +
      '<button class="btn" onclick="showView(\'login\')">去登录</button>';
    return;
  }
  appEl.innerHTML = '<div class="card"><h2>📊 数据导出</h2><div id="expBody">加载中…</div></div>';
  try {
    const studiesData = await api('/api/studies');
    const studies = Array.isArray(studiesData) ? studiesData : (studiesData.studies || []);
    document.getElementById('expBody').innerHTML = `
      <div class="card">
        <h3>选择研究项目</h3>
        <select id="expStudy" class="toolbar">${studies.map((s) => `<option value="${s.id}">${esc(s.study_code || s.code)}</option>`).join('')}</select>
      </div>
      <div class="card">
        <h3>导出选项</h3>
        <button class="btn" id="expSubjects">导出受试者</button>
        <button class="btn" id="expVisits">导出访视</button>
        <button class="btn" id="expAll">导出全部（打包）</button>
        <button class="btn" id="expDeviations">导出方案偏离</button>
      </div>
      <div id="expResult"></div>`;
    const doExport = async (path, name) => {
      const sid = document.getElementById('expStudy').value;
      try {
        document.getElementById('expResult').innerHTML = notice('正在生成…');
        const blob = await apiBlob(path.replace(':id', sid));
        downloadBlob(blob, name);
        document.getElementById('expResult').innerHTML = notice('导出成功！', 'success');
      } catch (err) {
        document.getElementById('expResult').innerHTML = notice(err.message, 'error');
      }
    };
    document.getElementById('expSubjects').onclick = () =>
      doExport('/api/studies/:id/export/subjects', 'subjects.xlsx');
    document.getElementById('expVisits').onclick = () =>
      doExport('/api/studies/:id/export/visits', 'visits.xlsx');
    document.getElementById('expAll').onclick = () =>
      doExport('/api/studies/:id/export/all', 'export-all.xlsx');
    document.getElementById('expDeviations').onclick = async () => {
      try {
        document.getElementById('expResult').innerHTML = notice('正在生成…');
        const blob = await apiBlob('/api/deviations/export');
        downloadBlob(blob, 'deviations.xlsx');
        document.getElementById('expResult').innerHTML = notice('导出成功！', 'success');
      } catch (err) {
        document.getElementById('expResult').innerHTML = notice(err.message, 'error');
      }
    };
  } catch (err) {
    document.getElementById('expBody').innerHTML = notice(err.message, 'error');
  }
};

// ==================== 用户管理（PI 专属） ====================
views.users = async function () {
  const u = getUser();
  if (!u || u.role !== 'pi') {
    appEl.innerHTML = notice('仅 PI 角色可管理用户。', 'error');
    return;
  }
  appEl.innerHTML = '<div class="card"><h2>👤 用户管理</h2><div id="userBody">加载中…</div></div>';
  try {
    const data = await api('/api/users');
    const list = Array.isArray(data) ? data : (data.users || data.items || []);
    document.getElementById('userBody').innerHTML = `
      <div class="card">
        <h3>新增用户</h3>
        <div class="form-row">
          <div class="form-group"><label>用户名</label><input id="newUserName"></div>
          <div class="form-group"><label>显示名</label><input id="newUserDisplay"></div>
          <div class="form-group"><label>密码</label><input id="newUserPass" type="password"></div>
          <div class="form-group"><label>角色</label><select id="newUserRole"><option value="pi">PI</option><option value="crc">CRC</option></select></div>
          <button class="btn btn-success" id="addUserBtn">创建</button>
        </div>
      </div>
      <table><thead><tr><th>ID</th><th>用户名</th><th>显示名</th><th>角色</th><th>操作</th></tr></thead>
      <tbody>${list.map((usr) => `
        <tr>
          <td>${esc(usr.id)}</td>
          <td>${esc(usr.username)}</td>
          <td>${esc(usr.display_name || '-')}</td>
          <td>${usr.role === 'pi' ? 'PI' : 'CRC'}</td>
          <td>${usr.id !== u.id ? `<button class="btn btn-sm btn-danger" data-del-user="${usr.id}">删除</button>` : '<span class="muted">（当前）</span>'}</td>
        </tr>`).join('')}</tbody></table>`;
    document.getElementById('addUserBtn').onclick = async () => {
      try {
        await api('/api/users', {
          method: 'POST',
          body: JSON.stringify({
            username: document.getElementById('newUserName').value.trim(),
            display_name: document.getElementById('newUserDisplay').value.trim(),
            password: document.getElementById('newUserPass').value,
            role: document.getElementById('newUserRole').value,
          }),
        });
        showView('users');
      } catch (err) { alert(err.message); }
    };
    document.querySelectorAll('[data-del-user]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('确认删除该用户？')) return;
        try { await api('/api/users/' + b.dataset.delUser, { method: 'DELETE' }); showView('users'); }
        catch (err) { alert(err.message); }
      };
    });
  } catch (err) {
    document.getElementById('userBody').innerHTML = notice(err.message, 'error');
  }
};

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
  renderUserInfo();
  showView('dashboard');
});