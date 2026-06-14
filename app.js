/**
 * 受试者随访提醒与访视窗口计算系统 — 应用入口
 *
 * 统一的单体应用（无 server/、client/ 子包）：
 * - 后端：基于 src/ 服务层的 Express REST API
 * - 前端：托管 public/ 下的静态页面（原生 JS 调用 API）
 *
 * 运行：
 *   npm run dev   # 开发（--watch）
 *   npm start     # 生产
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const { initDatabase } = require('./src/models/database');
const studyService = require('./src/services/studyService');
const subjectService = require('./src/services/subjectService');
const visitService = require('./src/services/visitService');
const reminderService = require('./src/services/reminderService');
const deviationService = require('./src/services/deviationService');
const excelService = require('./src/services/excelService');
const authService = require('./src/services/authService');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// 通用包装：把 service 抛出的 Error 转为 422
// ============================================================
function handleServiceError(res, err) {
  if (err && err.message) {
    return res.status(422).json({ error: err.message });
  }
  return res.status(500).json({ error: '服务器内部错误' });
}

// ============================================================
// 认证中间件（需求 F5）
// ============================================================
/**
 * 从请求中解析当前用户（若携带合法令牌），挂到 req.user
 * - 不带令牌或令牌无效：req.user = null（继续后续流程，用于可选鉴权场景）
 */
function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7).trim()
    : (req.query.token ? String(req.query.token) : null);
  req.user = token ? authService.resolveToken(token) : null;
  req.token = token || null;
  next();
}

/**
 * 强制鉴权：必须登录
 */
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: '未登录或登录已过期' });
  }
  next();
}

/**
 * 角色校验：仅 PI 可访问
 */
function requirePi(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '未登录或登录已过期' });
  if (!authService.isPi(req.user)) {
    return res.status(403).json({ error: '权限不足，仅 PI 可执行此操作' });
  }
  next();
}

/**
 * 构造当前用户的权限过滤参数（CRC 仅看分配给自己的数据；PI 返回 undefined 看全部）
 */
function scopeForUser(user) {
  if (user && authService.isCrc(user)) {
    return { assigned_user_id: user.id };
  }
  return {};
}

app.use(optionalAuth);

// ============================================================
// 健康检查
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================
// 认证 / 用户管理（F5）
// ============================================================
// 登录（无需鉴权）
app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    const result = authService.login(username, password);
    res.json(result);
  } catch (err) {
    handleServiceError(res, err);
  }
});

// 当前登录用户信息
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// 用户列表（PI 可管理）
app.get('/api/users', requireAuth, requirePi, (req, res) => {
  res.json(authService.getAll());
});

// CRC 下拉（用于受试者分配）
app.get('/api/users/crcs', requireAuth, (req, res) => {
  res.json(authService.getAllCrcs());
});

app.post('/api/users', requireAuth, requirePi, (req, res) => {
  try {
    const created = authService.create(req.body || {});
    res.status(201).json(created);
  } catch (err) {
    handleServiceError(res, err);
  }
});

app.put('/api/users/:id', requireAuth, requirePi, (req, res) => {
  try {
    const ok = authService.update(Number(req.params.id), req.body || {});
    if (!ok) return res.status(404).json({ error: '用户不存在' });
    res.json(authService.getById(Number(req.params.id)));
  } catch (err) {
    handleServiceError(res, err);
  }
});

app.delete('/api/users/:id', requireAuth, requirePi, (req, res) => {
  const ok = authService.remove(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: '用户不存在' });
  res.json({ success: true });
});

// ============================================================
// 研究项目
// ============================================================
app.get('/api/studies', (req, res) => {
  res.json(studyService.getAll({ status: req.query.status }));
});

app.post('/api/studies', requireAuth, requirePi, (req, res) => {
  try {
    const created = studyService.create(req.body || {});
    res.status(201).json(created);
  } catch (err) {
    handleServiceError(res, err);
  }
});

app.get('/api/studies/:id', (req, res) => {
  const item = studyService.getById(req.params.id);
  if (!item) return res.status(404).json({ error: '研究项目不存在' });
  res.json(item);
});

app.put('/api/studies/:id', requireAuth, requirePi, (req, res) => {
  try {
    const ok = studyService.update(req.params.id, req.body || {});
    if (!ok) return res.status(404).json({ error: '研究项目不存在' });
    res.json(studyService.getById(req.params.id));
  } catch (err) {
    handleServiceError(res, err);
  }
});

app.delete('/api/studies/:id', requireAuth, requirePi, (req, res) => {
  const ok = studyService.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: '研究项目不存在' });
  res.json({ success: true });
});

app.get('/api/studies/search', (req, res) => {
  res.json(studyService.search(req.query.keyword || ''));
});

// ============================================================
// 受试者（F5：按当前用户角色过滤）
// ============================================================
app.get('/api/studies/:studyId/subjects', (req, res) => {
  res.json(
    subjectService.getByStudyId(req.params.studyId, {
      status: req.query.status,
      ...scopeForUser(req.user),
    })
  );
});

app.post('/api/studies/:studyId/subjects', requireAuth, (req, res) => {
  try {
    const created = subjectService.create({
      ...(req.body || {}),
      study_id: Number(req.params.studyId),
    });
    res.status(201).json(created);
  } catch (err) {
    handleServiceError(res, err);
  }
});

app.get('/api/subjects/:id', (req, res) => {
  const item = subjectService.getById(req.params.id);
  if (!item) return res.status(404).json({ error: '受试者不存在' });
  // 权限校验：CRC 只能访问分配给自己的受试者
  if (req.user && authService.isCrc(req.user) && item.assigned_user_id !== req.user.id) {
    return res.status(403).json({ error: '无权访问该受试者' });
  }
  res.json(item);
});

app.put('/api/subjects/:id', requireAuth, (req, res) => {
  try {
    // 权限校验
    const item = subjectService.getById(req.params.id);
    if (!item) return res.status(404).json({ error: '受试者不存在' });
    if (authService.isCrc(req.user) && item.assigned_user_id !== req.user.id) {
      return res.status(403).json({ error: '无权修改该受试者' });
    }
    const ok = subjectService.update(req.params.id, req.body || {});
    if (!ok) return res.status(404).json({ error: '受试者不存在' });
    res.json(subjectService.getById(req.params.id));
  } catch (err) {
    handleServiceError(res, err);
  }
});

app.patch('/api/subjects/:id/status', requireAuth, (req, res) => {
  try {
    const item = subjectService.getById(req.params.id);
    if (!item) return res.status(404).json({ error: '受试者不存在' });
    if (authService.isCrc(req.user) && item.assigned_user_id !== req.user.id) {
      return res.status(403).json({ error: '无权修改该受试者' });
    }
    const ok = subjectService.updateStatus(req.params.id, (req.body || {}).status);
    if (!ok) return res.status(404).json({ error: '受试者不存在' });
    res.json(subjectService.getById(req.params.id));
  } catch (err) {
    handleServiceError(res, err);
  }
});

app.delete('/api/subjects/:id', requireAuth, requirePi, (req, res) => {
  const ok = subjectService.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: '受试者不存在' });
  res.json({ success: true });
});

app.get('/api/studies/:studyId/subjects/search', (req, res) => {
  res.json(
    subjectService.search(
      req.params.studyId,
      req.query.keyword || '',
      scopeForUser(req.user)
    )
  );
});

// ============================================================
// 访视 + F6 日历视图
// ============================================================
app.get('/api/subjects/:subjectId/visits', (req, res) => {
  res.json(visitService.getBySubjectId(req.params.subjectId, { status: req.query.status }));
});

app.get('/api/studies/:studyId/visits', (req, res) => {
  res.json(
    visitService.getByStudyId(req.params.studyId, scopeForUser(req.user))
  );
});

// F6：按日期范围查询访视（日历视图）
app.get('/api/visits/calendar', (req, res) => {
  const { start_date, end_date, study_id } = req.query;
  if (!start_date || !end_date) {
    return res.status(422).json({ error: '需要 start_date 和 end_date 参数（YYYY-MM-DD）' });
  }
  res.json(
    visitService.getByDateRange({
      start_date,
      end_date,
      study_id: study_id || undefined,
      ...scopeForUser(req.user),
    })
  );
});

app.get('/api/visits/:id', (req, res) => {
  const item = visitService.getById(req.params.id);
  if (!item) return res.status(404).json({ error: '访视记录不存在' });
  res.json(item);
});

app.post('/api/visits', requireAuth, (req, res) => {
  try {
    const created = visitService.create(req.body || {});
    res.status(201).json(created);
  } catch (err) {
    handleServiceError(res, err);
  }
});

app.put('/api/visits/:id', requireAuth, (req, res) => {
  try {
    const ok = visitService.update(req.params.id, req.body || {});
    if (!ok) return res.status(404).json({ error: '访视记录不存在' });
    res.json(visitService.getById(req.params.id));
  } catch (err) {
    handleServiceError(res, err);
  }
});

app.delete('/api/visits/:id', requireAuth, (req, res) => {
  const ok = visitService.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: '访视记录不存在' });
  res.json({ success: true });
});

// F2: 为受试者生成访视计划
app.post('/api/subjects/:subjectId/visits/generate', requireAuth, (req, res) => {
  try {
    const enrollmentDate = (req.body || {}).enrollment_date;
    if (!enrollmentDate) {
      return res.status(422).json({ error: '需要 enrollment_date 参数' });
    }
    const plan = visitService.generateVisitPlanForSubject(
      Number(req.params.subjectId),
      enrollmentDate
    );
    res.status(201).json(plan);
  } catch (err) {
    handleServiceError(res, err);
  }
});

// F2: 回填实际访视日期（含窗口判断、偏离记录、后续重算）
app.post('/api/visits/:id/fill-actual', requireAuth, (req, res) => {
  try {
    const actualDate = (req.body || {}).actual_date;
    if (!actualDate) {
      return res.status(422).json({ error: '需要 actual_date 参数' });
    }
    const result = visitService.fillActualDate(req.params.id, actualDate);
    res.json(result);
  } catch (err) {
    handleServiceError(res, err);
  }
});

// ============================================================
// 提醒（每日清单 F3 / 超窗预警）
// ============================================================
app.get('/api/reminders/today', (req, res) => {
  res.json(
    reminderService.getTodayReminders(req.query.reference_date, {
      study_id: req.query.study_id ? Number(req.query.study_id) : undefined,
      ...scopeForUser(req.user),
    })
  );
});

app.get('/api/reminders/tomorrow', (req, res) => {
  res.json(
    reminderService.getTomorrowReminders(req.query.reference_date, {
      study_id: req.query.study_id ? Number(req.query.study_id) : undefined,
      ...scopeForUser(req.user),
    })
  );
});

app.get('/api/reminders/week', (req, res) => {
  res.json(
    reminderService.getWeekReminders(req.query.reference_date, {
      study_id: req.query.study_id ? Number(req.query.study_id) : undefined,
      ...scopeForUser(req.user),
    })
  );
});

app.get('/api/reminders/upcoming', (req, res) => {
  const days = Number(req.query.days) || 7;
  res.json(
    reminderService.getUpcomingReminders(days, req.query.reference_date, {
      study_id: req.query.study_id ? Number(req.query.study_id) : undefined,
      ...scopeForUser(req.user),
    })
  );
});

// 脱落：取消受试者所有待发送提醒
app.post('/api/subjects/:subjectId/cancel-reminders', requireAuth, (req, res) => {
  const ok = reminderService.cancelBySubject(
    req.params.subjectId,
    (req.body || {}).reason || '受试者脱落'
  );
  res.json({ success: ok });
});

app.get('/api/reminders', (req, res) => {
  if (req.query.start_date && req.query.end_date) {
    return res.json(
      reminderService.getByDateRange(req.query.start_date, req.query.end_date)
    );
  }
  res.json(reminderService.getPendingReminders());
});

app.get('/api/reminders/stats', (req, res) => {
  const studyId = req.query.study_id ? Number(req.query.study_id) : undefined;
  res.json(reminderService.getReminderStats(studyId));
});

// ============================================================
// 方案偏离（F4）
// ============================================================
app.get('/api/deviations', (req, res) => {
  res.json(
    deviationService.getList({
      status: req.query.status,
      study_id: req.query.study_id ? Number(req.query.study_id) : undefined,
      ...scopeForUser(req.user),
    })
  );
});

app.post('/api/deviations', requireAuth, (req, res) => {
  try {
    const created = deviationService.create(req.body || {});
    res.status(201).json(created);
  } catch (err) {
    handleServiceError(res, err);
  }
});

app.post('/api/deviations/auto-detect', requireAuth, (req, res) => {
  res.json(deviationService.autoDetectDeviations({ referenceDate: (req.body || {}).reference_date }));
});

app.get('/api/deviations/summary', (req, res) => {
  res.json(deviationService.getSummary());
});

app.delete('/api/deviations/:id', requireAuth, requirePi, (req, res) => {
  const ok = deviationService.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: '偏离记录不存在' });
  res.json({ success: true });
});

// ============================================================
// Excel 批量导入（F5）
// ============================================================
app.post('/api/studies/:studyId/import-subjects', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(422).json({ error: '未上传文件' });
  try {
    const generateVisits = String(req.query.generate_visits) !== 'false';
    const result = excelService.importSubjects(
      Number(req.params.studyId),
      req.file.buffer,
      {
        generateVisits,
        // CRC 导入的受试者自动分配给自己
        assigned_user_id: authService.isCrc(req.user) ? req.user.id : undefined,
      }
    );
    res.status(201).json(result);
  } catch (err) {
    handleServiceError(res, err);
  }
});

// ============================================================
// Excel 导出（F7）
// ============================================================
function sendExcel(res, buffer, filename) {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.end(buffer);
}

// 导出受试者
app.get('/api/studies/:studyId/export/subjects', requireAuth, (req, res) => {
  try {
    const buf = excelService.exportSubjects(
      Number(req.params.studyId),
      { status: req.query.status, ...scopeForUser(req.user) }
    );
    sendExcel(res, buf, 'subjects.xlsx');
  } catch (err) {
    handleServiceError(res, err);
  }
});

// 导出访视
app.get('/api/studies/:studyId/export/visits', requireAuth, (req, res) => {
  try {
    const buf = excelService.exportVisits(
      Number(req.params.studyId),
      scopeForUser(req.user)
    );
    sendExcel(res, buf, 'visits.xlsx');
  } catch (err) {
    handleServiceError(res, err);
  }
});

// 导出方案偏离
app.get('/api/deviations/export', requireAuth, (req, res) => {
  try {
    const buf = excelService.exportDeviations({
      study_id: req.query.study_id ? Number(req.query.study_id) : undefined,
      ...scopeForUser(req.user),
    });
    sendExcel(res, buf, 'deviations.xlsx');
  } catch (err) {
    handleServiceError(res, err);
  }
});

// 导出综合报表
app.get('/api/studies/:studyId/export/all', requireAuth, (req, res) => {
  try {
    const buf = excelService.exportAll(
      Number(req.params.studyId),
      scopeForUser(req.user)
    );
    sendExcel(res, buf, 'report.xlsx');
  } catch (err) {
    handleServiceError(res, err);
  }
});

// ============================================================
// 404 / SPA fallback
// ============================================================
app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));
app.get('*', (req, res) => {
  const indexFile = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
  res.status(404).send('Not Found');
});

// 错误处理中间件
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  initDatabase().then(() => {
    app.listen(PORT, () => {
      console.log(`✅ 服务已启动：http://localhost:${PORT}`);
    });
  });
}

module.exports = app;