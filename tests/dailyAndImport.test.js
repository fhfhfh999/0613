/**
 * 每日提醒清单 & Excel 导入 单元测试
 *
 * 覆盖需求：
 *   F3 - 每日提醒清单生成（今日/明日/本周）、超窗预警、脱落停止提醒
 *   F5 - Excel 批量导入受试者
 */

const { initDatabase, closeDatabase } = require('../src/models/database');
const studyService = require('../src/services/studyService');
const subjectService = require('../src/services/subjectService');
const visitService = require('../src/services/visitService');
const reminderService = require('../src/services/reminderService');
const excelService = require('../src/services/excelService');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// 生成内存 xlsx buffer（供导入测试）
function makeXlsxBuffer(rows, headers) {
  const aoa = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

describe('每日提醒清单（reminderService F3）', () => {
  const testDbPath = path.join(__dirname, 'test_daily.db');
  let studyId, subjInWindow, subjOverdue, subjWithdrawn, subjCompleted;

  beforeAll(() => {
    process.env.TEST_DB_PATH = testDbPath;
    initDatabase();
    const study = studyService.create({ study_code: 'DAILY', study_name: '每日提醒测试' });
    studyId = study.id;

    // 受试者A：今日在窗口内（计划窗口正好包含参考日 2026-06-13）
    subjInWindow = subjectService.create({
      subject_code: 'DW_A',
      name: '在窗受试者',
      study_id: studyId,
    });
    visitService.create({
      subject_id: subjInWindow.id,
      visit_code: 'c1',
      visit_type: '治疗期C1',
      visit_date: '2026-06-13',
      visit_window_start: '2026-06-10',
      visit_window_end: '2026-06-15',
      status: '计划中',
    });

    // 受试者B：已超窗（窗口截止 2026-06-01，参考日 2026-06-13 已过）
    subjOverdue = subjectService.create({
      subject_code: 'DW_B',
      name: '超窗受试者',
      study_id: studyId,
    });
    visitService.create({
      subject_id: subjOverdue.id,
      visit_code: 'c2',
      visit_type: '治疗期C2',
      visit_date: '2026-05-28',
      visit_window_start: '2026-05-26',
      visit_window_end: '2026-06-01',
      status: '计划中',
    });

    // 受试者C：已脱落（应被排除）
    subjWithdrawn = subjectService.create({
      subject_code: 'DW_C',
      name: '脱落受试者',
      study_id: studyId,
      status: '脱落',
    });
    visitService.create({
      subject_id: subjWithdrawn.id,
      visit_code: 'c1',
      visit_type: '治疗期C1',
      visit_date: '2026-06-13',
      visit_window_start: '2026-06-10',
      visit_window_end: '2026-06-15',
      status: '计划中',
    });

    // 受试者D：已完成（应被排除）
    subjCompleted = subjectService.create({
      subject_code: 'DW_D',
      name: '完成受试者',
      study_id: studyId,
      status: '完成',
    });
    visitService.create({
      subject_id: subjCompleted.id,
      visit_code: 'f3',
      visit_type: '随访期F3',
      visit_date: '2026-06-13',
      visit_window_start: '2026-06-10',
      visit_window_end: '2026-06-15',
      status: '计划中',
    });
  });

  afterAll(() => {
    closeDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  test('getTodayReminders 应只返回活跃受试者中今日在窗内或已超窗的访视', () => {
    const result = reminderService.getTodayReminders('2026-06-13');
    expect(result.date).toBe('2026-06-13');
    const map = Object.fromEntries(result.reminders.map((r) => [r.subject_code, r]));

    // A：今日在窗内 → 正常出现，不超窗
    expect(map['DW_A']).toBeDefined();
    expect(map['DW_A'].overdue).toBe(false);

    // B：窗口截止 06-01 < 参考日 06-13 → 超窗预警，仍应出现在今日清单
    expect(map['DW_B']).toBeDefined();
    expect(map['DW_B'].overdue).toBe(true);
    expect(map['DW_B'].urgency).toBe('overdue');

    // 脱落 / 完成受试者永远排除
    expect(map['DW_C']).toBeUndefined();
    expect(map['DW_D']).toBeUndefined();
  });

  test('超窗访视应标记 overdue=true 且 urgency=overdue', () => {
    // 构造一个窗口结束日为昨天的访视，使其落在"今日在窗"外但通过本周清单可见
    const subj = subjectService.create({
      subject_code: 'DW_E',
      name: '近期超窗',
      study_id: studyId,
    });
    visitService.create({
      subject_id: subj.id,
      visit_code: 'c1',
      visit_type: '治疗期C1',
      visit_date: '2026-06-11',
      visit_window_start: '2026-06-08',
      visit_window_end: '2026-06-12', // 昨天
      status: '计划中',
    });
    const week = reminderService.getWeekReminders('2026-06-13');
    const item = week.reminders.find((r) => r.subject_code === 'DW_E');
    expect(item).toBeDefined();
    expect(item.overdue).toBe(true);
    expect(item.urgency).toBe('overdue');
    expect(item.days_remaining).toBeLessThan(0);
  });

  test('近窗访视（剩余 ≤2 天）应标记 urgency=urgent', () => {
    const subj = subjectService.create({
      subject_code: 'DW_F',
      name: '近窗受试者',
      study_id: studyId,
    });
    visitService.create({
      subject_id: subj.id,
      visit_code: 'c1',
      visit_type: '治疗期C1',
      visit_date: '2026-06-13',
      visit_window_start: '2026-06-11',
      visit_window_end: '2026-06-15', // 剩余 2 天
      status: '计划中',
    });
    const today = reminderService.getTodayReminders('2026-06-13');
    const item = today.reminders.find((r) => r.subject_code === 'DW_F');
    expect(item).toBeDefined();
    expect(item.days_remaining).toBe(2);
    expect(item.urgency).toBe('urgent');
    expect(item.overdue).toBe(false);
  });

  test('getTomorrowReminders 应返回窗口结束日为明天的访视', () => {
    const subj = subjectService.create({
      subject_code: 'DW_G',
      name: '明日受试者',
      study_id: studyId,
    });
    visitService.create({
      subject_id: subj.id,
      visit_code: 'c1',
      visit_type: '治疗期C1',
      visit_date: '2026-06-13',
      visit_window_start: '2026-06-11',
      visit_window_end: '2026-06-14', // 明天
      status: '计划中',
    });
    const result = reminderService.getTomorrowReminders('2026-06-13');
    expect(result.date).toBe('2026-06-14');
    const item = result.reminders.find((r) => r.subject_code === 'DW_G');
    expect(item).toBeDefined();
  });

  test('getWeekReminders 应返回 7 天范围内窗口截止的访视', () => {
    const subj = subjectService.create({
      subject_code: 'DW_H',
      name: '本周受试者',
      study_id: studyId,
    });
    visitService.create({
      subject_id: subj.id,
      visit_code: 'c1',
      visit_type: '治疗期C1',
      visit_date: '2026-06-15',
      visit_window_start: '2026-06-12',
      visit_window_end: '2026-06-18', // 5 天后
      status: '计划中',
    });
    const result = reminderService.getWeekReminders('2026-06-13');
    const item = result.reminders.find((r) => r.subject_code === 'DW_H');
    expect(item).toBeDefined();
    expect(item.days_remaining).toBe(5);
  });

  test('getWeekReminders 应包含窗口在本周开始但结束日超出本周的访视（窗口重叠判定）', () => {
    // 回归测试（Bug 1）：访视窗口 [06-16, 06-25]，本周范围 [06-13, 06-19]。
    // 原逻辑仅比较 window_end 是否落在范围内，会导致此类访视被错误遗漏。
    const subj = subjectService.create({
      subject_code: 'DW_OL',
      name: '窗口跨周受试者',
      study_id: studyId,
    });
    visitService.create({
      subject_id: subj.id,
      visit_code: 'c1',
      visit_type: '治疗期C1',
      visit_date: '2026-06-20',
      visit_window_start: '2026-06-16', // 本周内（06-13 ~ 06-19）开始
      visit_window_end: '2026-06-25', // 但结束日已超出本周
      status: '计划中',
    });
    const week = reminderService.getWeekReminders('2026-06-13');
    const item = week.reminders.find((r) => r.subject_code === 'DW_OL');
    expect(item).toBeDefined();
  });

  test('getWeekReminders 不应包含完全在范围之后的访视', () => {
    const subj = subjectService.create({
      subject_code: 'DW_FUT',
      name: '远期受试者',
      study_id: studyId,
    });
    visitService.create({
      subject_id: subj.id,
      visit_code: 'c1',
      visit_type: '治疗期C1',
      visit_date: '2026-07-01',
      visit_window_start: '2026-06-28', // 完全在本周范围 [06-13, 06-19] 之后
      visit_window_end: '2026-07-04',
      status: '计划中',
    });
    const week = reminderService.getWeekReminders('2026-06-13');
    const item = week.reminders.find((r) => r.subject_code === 'DW_FUT');
    expect(item).toBeUndefined();
  });

  test('cancelBySubject 应取消受试者所有待发送提醒', () => {
    const subj = subjectService.create({
      subject_code: 'DW_I',
      name: '取消提醒',
      study_id: studyId,
    });
    const visit = visitService.create({
      subject_id: subj.id,
      visit_code: 'c1',
      visit_type: '治疗期C1',
      visit_date: '2026-06-13',
      visit_window_end: '2026-06-15',
      status: '计划中',
    });
    reminderService.create({
      subject_id: subj.id,
      visit_id: visit.id,
      study_id: studyId,
      reminder_type: '短信',
      reminder_date: '2026-06-13',
      content: '请按时随访',
      status: '待发送',
    });
    const cancelled = reminderService.cancelBySubject(subj.id, '脱落');
    expect(cancelled).toBe(true);
    const list = reminderService.getBySubjectId(subj.id);
    expect(list.every((r) => r.status === '已取消')).toBe(true);
  });
});

describe('提醒清单权限过滤（F5：CRC 只看自己的受试者）', () => {
  const testDbPath = path.join(__dirname, 'test_daily_scope.db');
  let studyId, subjAssigned, subjOther;

  beforeAll(() => {
    process.env.TEST_DB_PATH = testDbPath;
    initDatabase();
    const study = studyService.create({
      study_code: 'SCOPE',
      study_name: '权限范围测试',
    });
    studyId = study.id;

    // 受试者A：分配给 CRC #999，今日在窗内
    subjAssigned = subjectService.create({
      subject_code: 'SCOPE_A',
      name: '分配给CRC',
      study_id: studyId,
      assigned_user_id: 999,
    });
    visitService.create({
      subject_id: subjAssigned.id,
      visit_code: 'c1',
      visit_type: '治疗期C1',
      visit_date: '2026-06-13',
      visit_window_start: '2026-06-10',
      visit_window_end: '2026-06-15',
      status: '计划中',
    });

    // 受试者B：未分配给 CRC #999，今日也在窗内
    subjOther = subjectService.create({
      subject_code: 'SCOPE_B',
      name: '他人受试者',
      study_id: studyId,
      assigned_user_id: 888,
    });
    visitService.create({
      subject_id: subjOther.id,
      visit_code: 'c1',
      visit_type: '治疗期C1',
      visit_date: '2026-06-13',
      visit_window_start: '2026-06-10',
      visit_window_end: '2026-06-15',
      status: '计划中',
    });
  });

  afterAll(() => {
    closeDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  test('assigned_user_id 过滤应只返回分配给该用户的受试者（Bug 8/F5 回归）', () => {
    const result = reminderService.getTodayReminders('2026-06-13', {
      assigned_user_id: 999,
    });
    const codes = result.reminders.map((r) => r.subject_code);
    expect(codes).toContain('SCOPE_A');
    expect(codes).not.toContain('SCOPE_B');
  });

  test('study_id 过滤应只返回指定研究下的受试者', () => {
    const result = reminderService.getTodayReminders('2026-06-13', {
      study_id: studyId,
    });
    const codes = result.reminders.map((r) => r.subject_code);
    expect(codes).toContain('SCOPE_A');
    expect(codes).toContain('SCOPE_B');
  });

  test('无过滤时应返回全部受试者（PI 视角）', () => {
    const result = reminderService.getTodayReminders('2026-06-13', {});
    const codes = result.reminders.map((r) => r.subject_code);
    expect(codes).toContain('SCOPE_A');
    expect(codes).toContain('SCOPE_B');
  });
});

describe('Excel 批量导入（excelService F5）', () => {
  const testDbPath = path.join(__dirname, 'test_excel.db');
  let studyId;

  beforeAll(() => {
    process.env.TEST_DB_PATH = testDbPath;
    initDatabase();
    const study = studyService.create({ study_code: 'XL_TEST', study_name: '导入测试研究' });
    studyId = study.id;
  });

  afterAll(() => {
    closeDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  test('应能批量导入有效受试者', () => {
    const headers = ['受试者编号', '姓名', '性别', '入组日期'];
    const rows = [
      ['XL_001', '张三', '男', '2026-01-01'],
      ['XL_002', '李四', '女', '2026-02-01'],
    ];
    const buf = makeXlsxBuffer(rows, headers);
    const result = excelService.importSubjects(studyId, buf);
    expect(result.total).toBe(2);
    expect(result.success).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.imported).toHaveLength(2);
    // 应自动生成访视计划
    const visits = visitService.getBySubjectId(result.imported[0].id);
    expect(visits.length).toBe(10);
  });

  test('应支持英文表头别名', () => {
    const headers = ['subject_code', 'name', 'gender', 'enrollment_date'];
    const rows = [['XL_EN_001', 'John', 'M', '2026-01-01']];
    const buf = makeXlsxBuffer(rows, headers);
    const result = excelService.importSubjects(studyId, buf);
    expect(result.success).toBe(1);
    expect(result.imported[0].subject_code).toBe('XL_EN_001');
  });

  test('缺少必填列应整批失败', () => {
    const headers = ['受试者编号', '性别']; // 缺 姓名
    const rows = [['XL_003', '男']];
    const buf = makeXlsxBuffer(rows, headers);
    const result = excelService.importSubjects(studyId, buf);
    expect(result.success).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors.join('')).toContain('缺少必填列');
  });

  test('缺少必填字段（某行）应记录错误但继续导入其他行', () => {
    const headers = ['受试者编号', '姓名'];
    const rows = [
      ['XL_004', '王五'],
      ['', '缺编号'], // 缺 subject_code
      ['XL_006', '赵六'],
    ];
    const buf = makeXlsxBuffer(rows, headers);
    const result = excelService.importSubjects(studyId, buf);
    expect(result.total).toBe(3);
    expect(result.success).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors.join('')).toContain('subject_code');
  });

  test('非法日期格式应报错', () => {
    const headers = ['受试者编号', '姓名', '入组日期'];
    const rows = [['XL_007', '钱七', '2026/01/01']];
    const buf = makeXlsxBuffer(rows, headers);
    const result = excelService.importSubjects(studyId, buf);
    expect(result.success).toBe(0);
    expect(result.errors.join('')).toContain('YYYY-MM-DD');
  });

  test('空 Excel 应返回空结果', () => {
    const buf = makeXlsxBuffer([], ['受试者编号', '姓名']);
    const result = excelService.importSubjects(studyId, buf);
    expect(result.total).toBe(0);
    expect(result.success).toBe(0);
  });

  test('options.generateVisits=false 应不生成访视计划', () => {
    const headers = ['受试者编号', '姓名', '入组日期'];
    const rows = [['XL_NV', '不生成', '2026-01-01']];
    const buf = makeXlsxBuffer(rows, headers);
    const result = excelService.importSubjects(studyId, buf, { generateVisits: false });
    expect(result.success).toBe(1);
    const visits = visitService.getBySubjectId(result.imported[0].id);
    expect(visits.length).toBe(0);
  });
});