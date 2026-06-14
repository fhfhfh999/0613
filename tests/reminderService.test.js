/**
 * 提醒服务测试
 */

const { initDatabase, closeDatabase } = require('../src/models/database');
const studyService = require('../src/services/studyService');
const subjectService = require('../src/services/subjectService');
const visitService = require('../src/services/visitService');
const reminderService = require('../src/services/reminderService');
const path = require('path');
const fs = require('fs');

describe('提醒服务', () => {
  const testDbPath = path.join(__dirname, 'test_reminder.db');
  let studyId, subjectId, visitId;

  beforeAll(() => {
    process.env.TEST_DB_PATH = testDbPath;
    initDatabase();
    const study = studyService.create({
      study_code: 'R_TEST',
      study_name: '提醒测试用研究',
    });
    studyId = study.id;
    const subject = subjectService.create({
      subject_code: 'R_SUB001',
      name: '提醒测试受试者',
      gender: '男',
      phone: '13800138000',
      study_id: studyId,
    });
    subjectId = subject.id;
    const visit = visitService.create({
      subject_id: subjectId,
      visit_type: '常规随访',
      visit_date: '2026-07-15',
      visit_window_start: '2026-07-10',
      visit_window_end: '2026-07-20',
      status: '计划中',
    });
    visitId = visit.id;
  });

  afterAll(() => {
    closeDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  test('应能创建提醒记录', () => {
    const data = {
      visit_id: visitId,
      subject_id: subjectId,
      reminder_type: '短信',
      reminder_date: '2026-07-10',
      content: '您有一次随访即将到来，请按时就诊。',
      status: '待发送',
    };
    const result = reminderService.create(data);
    expect(result).toBeDefined();
    expect(result.visit_id).toBe(visitId);
    expect(result.reminder_type).toBe('短信');
    expect(result.id).toBeDefined();
  });

  test('应能获取某随访的所有提醒', () => {
    const reminders = reminderService.getByVisitId(visitId);
    expect(Array.isArray(reminders)).toBe(true);
    expect(reminders.length).toBeGreaterThanOrEqual(1);
  });

  test('应能根据ID获取提醒', () => {
    const created = reminderService.create({
      visit_id: visitId,
      subject_id: subjectId,
      reminder_type: '电话',
      reminder_date: '2026-07-12',
      content: '电话提醒随访',
      status: '待发送',
    });
    const found = reminderService.getById(created.id);
    expect(found).toBeDefined();
    expect(found.reminder_type).toBe('电话');
  });

  test('获取不存在的提醒应返回 undefined', () => {
    expect(reminderService.getById(99999)).toBeUndefined();
  });

  test('应能更新提醒状态', () => {
    const created = reminderService.create({
      visit_id: visitId,
      subject_id: subjectId,
      reminder_type: '短信',
      reminder_date: '2026-07-13',
      content: '状态更新测试',
      status: '待发送',
    });
    reminderService.update(created.id, { status: '已发送' });
    const found = reminderService.getById(created.id);
    expect(found.status).toBe('已发送');
  });

  test('应能删除提醒记录', () => {
    const created = reminderService.create({
      visit_id: visitId,
      subject_id: subjectId,
      reminder_type: '短信',
      reminder_date: '2026-07-14',
      content: '待删除提醒',
      status: '待发送',
    });
    expect(reminderService.remove(created.id)).toBe(true);
    expect(reminderService.getById(created.id)).toBeUndefined();
  });

  test('应能获取待发送的提醒列表', () => {
    reminderService.create({
      visit_id: visitId,
      subject_id: subjectId,
      reminder_type: '短信',
      reminder_date: new Date().toISOString().split('T')[0],
      content: '今日待发送提醒',
      status: '待发送',
    });
    const pending = reminderService.getPendingReminders();
    expect(Array.isArray(pending)).toBe(true);
    expect(pending.length).toBeGreaterThanOrEqual(1);
    pending.forEach(r => expect(r.status).toBe('待发送'));
  });

  test('应能按日期范围查询提醒', () => {
    const startDate = '2026-07-01';
    const endDate = '2026-07-31';
    const results = reminderService.getByDateRange(startDate, endDate);
    expect(Array.isArray(results)).toBe(true);
    results.forEach(r => {
      expect(r.reminder_date >= startDate).toBe(true);
      expect(r.reminder_date <= endDate).toBe(true);
    });
  });

  test('应能标记提醒为已发送', () => {
    const created = reminderService.create({
      visit_id: visitId,
      subject_id: subjectId,
      reminder_type: '短信',
      reminder_date: '2026-07-15',
      content: '标记发送测试',
      status: '待发送',
    });
    const result = reminderService.markAsSent(created.id);
    expect(result).toBe(true);
    const found = reminderService.getById(created.id);
    expect(found.status).toBe('已发送');
    expect(found.sent_at).toBeDefined();
  });

  test('应能统计提醒发送情况', () => {
    const stats = reminderService.getReminderStats(studyId);
    expect(stats).toBeDefined();
    expect(stats).toHaveProperty('total');
    expect(stats).toHaveProperty('sent');
    expect(stats).toHaveProperty('pending');
    expect(stats).toHaveProperty('failed');
  });
});
