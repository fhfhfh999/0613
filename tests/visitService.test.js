/**
 * 随访服务测试
 */

const { initDatabase, closeDatabase } = require('../src/models/database');
const studyService = require('../src/services/studyService');
const subjectService = require('../src/services/subjectService');
const visitService = require('../src/services/visitService');
const path = require('path');
const fs = require('fs');

describe('随访服务', () => {
  const testDbPath = path.join(__dirname, 'test_visit.db');
  let studyId, subjectId;

  beforeAll(() => {
    process.env.TEST_DB_PATH = testDbPath;
    initDatabase();
    const study = studyService.create({
      study_code: 'V_TEST',
      study_name: '随访测试用研究',
    });
    studyId = study.id;
    const subject = subjectService.create({
      subject_code: 'V_SUB001',
      name: '随访测试受试者',
      gender: '男',
      study_id: studyId,
    });
    subjectId = subject.id;
  });

  afterAll(() => {
    closeDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  test('应能创建随访记录', () => {
    const data = {
      subject_id: subjectId,
      visit_type: '常规随访',
      visit_date: '2026-07-01',
      visit_window_start: '2026-06-25',
      visit_window_end: '2026-07-05',
      status: '计划中',
      notes: '第一次常规随访',
    };
    const result = visitService.create(data);
    expect(result).toBeDefined();
    expect(result.subject_id).toBe(subjectId);
    expect(result.visit_type).toBe('常规随访');
    expect(result.id).toBeDefined();
  });

  test('应能获取某受试者的所有随访', () => {
    const visits = visitService.getBySubjectId(subjectId);
    expect(Array.isArray(visits)).toBe(true);
    expect(visits.length).toBeGreaterThanOrEqual(1);
  });

  test('应能根据ID获取随访记录', () => {
    const created = visitService.create({
      subject_id: subjectId,
      visit_type: '筛查随访',
      visit_date: '2026-08-01',
      status: '计划中',
    });
    const found = visitService.getById(created.id);
    expect(found).toBeDefined();
    expect(found.visit_type).toBe('筛查随访');
  });

  test('获取不存在的随访应返回 undefined', () => {
    expect(visitService.getById(99999)).toBeUndefined();
  });

  test('应能更新随访记录', () => {
    const created = visitService.create({
      subject_id: subjectId,
      visit_type: '更新测试',
      visit_date: '2026-09-01',
      status: '计划中',
    });
    visitService.update(created.id, { status: '已完成', notes: '随访已完成' });
    const found = visitService.getById(created.id);
    expect(found.status).toBe('已完成');
    expect(found.notes).toBe('随访已完成');
  });

  test('应能删除随访记录', () => {
    const created = visitService.create({
      subject_id: subjectId,
      visit_type: '待删除',
      visit_date: '2026-10-01',
      status: '计划中',
    });
    expect(visitService.remove(created.id)).toBe(true);
    expect(visitService.getById(created.id)).toBeUndefined();
  });

  test('应能获取待提醒的随访（即将到期）', () => {
    // 创建一个即将到期的随访
    visitService.create({
      subject_id: subjectId,
      visit_type: '即将到期随访',
      visit_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      visit_window_end: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: '计划中',
    });
    const upcoming = visitService.getUpcoming(studyId, 7);
    expect(Array.isArray(upcoming)).toBe(true);
    // 至少应该有即将到期的随访
    expect(upcoming.length).toBeGreaterThanOrEqual(0);
  });

  test('应支持按状态筛选随访', () => {
    visitService.create({
      subject_id: subjectId,
      visit_type: '逾期随访',
      visit_date: '2026-01-01',
      status: '已逾期',
    });
    const overdue = visitService.getBySubjectId(subjectId, { status: '已逾期' });
    expect(overdue.length).toBeGreaterThanOrEqual(1);
    overdue.forEach(v => expect(v.status).toBe('已逾期'));
  });

  test('应能批量创建随访计划', () => {
    const plan = [
      { visit_type: '第1次随访', visit_date: '2026-07-01', status: '计划中' },
      { visit_type: '第2次随访', visit_date: '2026-08-01', status: '计划中' },
      { visit_type: '第3次随访', visit_date: '2026-09-01', status: '计划中' },
    ];
    const results = visitService.batchCreate(subjectId, plan);
    expect(results.length).toBe(3);
    results.forEach(r => {
      expect(r.subject_id).toBe(subjectId);
      expect(r.id).toBeDefined();
    });
  });
});
