/**
 * Express API 集成测试
 *
 * 通过 supertest 对 app.js 暴露的 Express 应用进行端到端测试，
 * 验证 REST API 是否正确串联 src/ 服务层。
 *
 * 说明：写入型接口（POST/PUT/DELETE）受需求 F5 鉴权保护，
 * 测试用例通过 authService 直接创建一个 PI 用户并签发令牌，
 * 在需要鉴权的请求中携带 Bearer Token。
 */

const request = require('supertest');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 为每个测试文件使用独立的临时数据库文件，避免串扰
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'followup-api-'));
process.env.TEST_DB_PATH = path.join(tmpDir, 'test.db');

const { initDatabase, resetDatabase } = require('../src/models/database');
const authService = require('../src/services/authService');

let app;
let piToken;

beforeAll(async () => {
  await initDatabase();
  app = require('../app');

  authService.create({
    username: 'pi-test',
    password: 'pi-test-123',
    role: 'pi',
    display_name: '测试PI',
  });
  const loginResult = authService.login('pi-test', 'pi-test-123');
  piToken = loginResult.token;
});

afterAll(() => {
  resetDatabase();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
});

function authReq(method, url) {
  return request(app)[method](url).set('Authorization', `Bearer ${piToken}`);
}

describe('Express API 集成', () => {
  it('GET /api/health 应返回 ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });

  it('POST /api/auth/login 应能正确登录并返回 token', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'pi-test', password: 'pi-test-123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.username).toBe('pi-test');
    expect(res.body.user.role).toBe('pi');
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it('未登录访问需要鉴权的接口应返回 401', async () => {
    const res = await request(app)
      .post('/api/studies')
      .send({ study_code: 'NO-AUTH', study_name: '不应创建' });
    expect(res.status).toBe(401);
  });

  it('登录密码错误应返回 422', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'pi-test', password: 'wrong-password' });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/密码|错误/);
  });

  it('研究项目应能通过 API 完整 CRUD', async () => {
    const created = await authReq('post', '/api/studies')
      .send({ study_code: 'API-001', study_name: 'API测试研究', status: '进行中' });
    expect(created.status).toBe(201);
    expect(created.body.id).toBeDefined();
    expect(created.body.study_code).toBe('API-001');
    const studyId = created.body.id;

    const list = await request(app).get('/api/studies');
    expect(list.status).toBe(200);
    expect(list.body.some((s) => s.id === studyId)).toBe(true);

    const detail = await request(app).get(`/api/studies/${studyId}`);
    expect(detail.body.study_name).toBe('API测试研究');

    const updated = await authReq('put', `/api/studies/${studyId}`).send({ study_name: '改名后' });
    expect(updated.body.study_name).toBe('改名后');

    const deleted = await authReq('delete', `/api/studies/${studyId}`);
    expect(deleted.body.success).toBe(true);
    const after = await request(app).get(`/api/studies/${studyId}`);
    expect(after.status).toBe(404);
  });

  it('应能创建受试者并生成访视计划，回填实际日期触发窗口判断', async () => {
    const study = await authReq('post', '/api/studies')
      .send({ study_code: 'ST-F2', study_name: '访视计划测试' });
    const studyId = study.body.id;

    const subject = await authReq('post', `/api/studies/${studyId}/subjects`)
      .send({ subject_code: 'S-F2-001', name: '测试受试者', gender: '男' });
    expect(subject.status).toBe(201);
    const subjectId = subject.body.id;

    const plan = await authReq('post', `/api/subjects/${subjectId}/visits/generate`)
      .send({ enrollment_date: '2026-01-01' });
    expect(plan.status).toBe(201);
    expect(Array.isArray(plan.body)).toBe(true);
    expect(plan.body.length).toBe(10);

    const c1 = plan.body[1];
    const ok = await authReq('post', `/api/visits/${c1.id}/fill-actual`)
      .send({ actual_date: '2026-01-22' });
    expect(ok.status).toBe(200);
    expect(ok.body.visit.status).toBe('已完成');
    expect(ok.body.deviation).toBeNull();
    expect(ok.body.recalculated).toBeGreaterThan(0);

    const c2Id = plan.body.find((v) => v.visit_code === 'c2').id;
    const outOfWindow = await authReq('post', `/api/visits/${c2Id}/fill-actual`)
      .send({ actual_date: '2030-12-31' });
    expect(outOfWindow.body.visit.status).toBe('已偏离');
    expect(outOfWindow.body.deviation).not.toBeNull();
  });

  it('应能获取今日/明日/本周提醒清单', async () => {
    const study = await authReq('post', '/api/studies')
      .send({ study_code: 'ST-F3', study_name: '提醒清单测试' });
    const subject = await authReq('post', `/api/studies/${study.body.id}/subjects`)
      .send({ subject_code: 'S-F3-001', name: '提醒测试', gender: '女' });
    await authReq('post', `/api/subjects/${subject.body.id}/visits/generate`)
      .send({ enrollment_date: '2026-01-01' });

    const today = await request(app).get('/api/reminders/today?reference_date=2026-01-01');
    expect(today.status).toBe(200);
    expect(today.body.date).toBe('2026-01-01');
    expect(Array.isArray(today.body.reminders)).toBe(true);

    const tomorrow = await request(app).get('/api/reminders/tomorrow?reference_date=2026-01-01');
    expect(tomorrow.body.date).toBe('2026-01-02');

    const week = await request(app).get('/api/reminders/week?reference_date=2026-01-01');
    expect(week.status).toBe(200);
    expect(Array.isArray(week.body.reminders)).toBe(true);
  });

  it('受试者脱落后应能调用取消提醒接口并返回 200', async () => {
    const study = (await authReq('post', '/api/studies').send({ study_code: 'ST-DROP', study_name: '脱落测试' })).body;
    const subject = (await authReq('post', `/api/studies/${study.id}/subjects`).send({ subject_code: 'S-DROP', name: '脱落者', gender: '男' })).body;
    await authReq('post', `/api/subjects/${subject.id}/visits/generate`).send({ enrollment_date: '2026-01-01' });

    const res = await authReq('post', `/api/subjects/${subject.id}/cancel-reminders`).send({ reason: '测试脱落' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success');
  });

  it('应能批量检测方案偏离并获取汇总', async () => {
    const study = (await authReq('post', '/api/studies').send({ study_code: 'ST-DEV', study_name: '偏离测试' })).body;
    const subject = (await authReq('post', `/api/studies/${study.id}/subjects`).send({ subject_code: 'S-DEV', name: '偏离者', gender: '男' })).body;
    await authReq('post', `/api/subjects/${subject.id}/visits/generate`).send({ enrollment_date: '2020-01-01' });

    const detect = await authReq('post', '/api/deviations/auto-detect').send({ reference_date: '2026-06-13' });
    expect(detect.status).toBe(200);
    expect(detect.body.detected).toBeGreaterThan(0);

    const list = await request(app).get('/api/deviations');
    expect(list.body.length).toBeGreaterThan(0);

    const summary = await request(app).get('/api/deviations/summary');
    expect(summary.body.total).toBeGreaterThan(0);
  });

  it('应能通过 API 批量导入受试者 Excel', async () => {
    const XLSX = require('xlsx');
    const study = (await authReq('post', '/api/studies').send({ study_code: 'ST-IMP', study_name: '导入测试' })).body;

    const data = [
      ['受试者编号', '姓名', '性别', '入组日期'],
      ['IMP-001', '张三', '男', '2026-01-01'],
      ['IMP-002', '李四', '女', '2026-01-02'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const res = await request(app)
      .post(`/api/studies/${study.id}/import-subjects`)
      .set('Authorization', `Bearer ${piToken}`)
      .attach('file', buffer, 'subjects.xlsx');

    expect(res.status).toBe(201);
    expect(res.body.total).toBe(2);
    expect(res.body.success).toBe(2);
    expect(res.body.failed).toBe(0);
  });

  it('PI 应能通过 API 创建 CRC 用户并登录', async () => {
    const created = await authReq('post', '/api/users').send({
      username: 'crc-api-test',
      password: 'crc-123',
      role: 'crc',
      display_name: '测试CRC',
    });
    expect(created.status).toBe(201);
    expect(created.body.role).toBe('crc');
    expect(created.body.password_hash).toBeUndefined();

    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'crc-api-test', password: 'crc-123' });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeDefined();
    expect(login.body.user.role).toBe('crc');
  });

  it('CRC 不能调用仅 PI 可用的接口（如创建研究项目），应返回 403', async () => {
    const crcLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'crc-api-test', password: 'crc-123' });
    const crcToken = crcLogin.body.token;

    const res = await request(app)
      .post('/api/studies')
      .set('Authorization', `Bearer ${crcToken}`)
      .send({ study_code: 'CRC-FORBIDDEN', study_name: '不应创建' });
    expect(res.status).toBe(403);
  });

  it('应能通过 /api/visits/calendar 获取日历视图数据', async () => {
    const study = (await authReq('post', '/api/studies').send({ study_code: 'ST-CAL', study_name: '日历测试' })).body;
    const subject = (await authReq('post', `/api/studies/${study.id}/subjects`).send({ subject_code: 'S-CAL', name: '日历受试者', gender: '男' })).body;
    await authReq('post', `/api/subjects/${subject.id}/visits/generate`).send({ enrollment_date: '2026-01-01' });

    const res = await request(app).get('/api/visits/calendar?start_date=2026-01-01&end_date=2026-06-30&study_id=' + study.id);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('subject_code');
    expect(res.body[0]).toHaveProperty('visit_date');
  });

  it('应能导出受试者 Excel（F7）', async () => {
    const study = (await authReq('post', '/api/studies').send({ study_code: 'ST-EXP', study_name: '导出测试' })).body;
    await authReq('post', `/api/studies/${study.id}/subjects`).send({ subject_code: 'S-EXP', name: '导出受试者', gender: '男' });

    const res = await request(app)
      .get(`/api/studies/${study.id}/export/subjects`)
      .set('Authorization', `Bearer ${piToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const buf = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body);
    expect(buf.slice(0, 2).toString('ascii')).toBe('PK');
  });

  it('请求不存在的资源应返回 404', async () => {
    const res = await request(app).get('/api/studies/999999');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('未知 API 路径应返回 404 JSON', async () => {
    const res = await request(app).get('/api/no-such-endpoint');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});
