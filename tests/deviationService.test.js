/**
 * 方案偏离服务测试 + 访视服务核心逻辑测试
 *
 * 覆盖需求 F4：方案偏离检测、F2：访视计划生成与回填重算
 */

const { initDatabase, closeDatabase } = require('../src/models/database');
const studyService = require('../src/services/studyService');
const subjectService = require('../src/services/subjectService');
const visitService = require('../src/services/visitService');
const deviationService = require('../src/services/deviationService');
const path = require('path');
const fs = require('fs');

describe('访视计划核心逻辑（visitService）', () => {
  const testDbPath = path.join(__dirname, 'test_visitplan.db');
  let studyId, subjectId;

  beforeAll(() => {
    process.env.TEST_DB_PATH = testDbPath;
    initDatabase();
    const study = studyService.create({
      study_code: 'VP_TEST',
      study_name: '访视计划测试研究',
    });
    studyId = study.id;
    const subject = subjectService.create({
      subject_code: 'VP_S001',
      name: '访视计划受试者',
      study_id: studyId,
    });
    subjectId = subject.id;
  });

  afterAll(() => {
    closeDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  test('generateVisitPlanForSubject 应生成10个访视节点', () => {
    const visits = visitService.generateVisitPlanForSubject(subjectId, '2026-01-01');
    expect(visits).toHaveLength(10);
    // 筛选期为入组当天
    expect(visits[0].visit_code).toBe('screening');
    expect(visits[0].visit_date).toBe('2026-01-01');
    // C1 计划日期为 D0 + 21
    const c1 = visits.find((v) => v.visit_code === 'c1');
    expect(c1.visit_date).toBe('2026-01-22');
    expect(c1.visit_window_start).toBe('2026-01-19');
    expect(c1.visit_window_end).toBe('2026-01-25');
  });

  test('generateVisitPlanForSubject 对不存在的受试者应抛错', () => {
    expect(() =>
      visitService.generateVisitPlanForSubject(99999, '2026-01-01')
    ).toThrow();
  });

  test('fillActualDate 在窗口期内应标记为已完成并重算后续', () => {
    // 新建受试者与计划
    const subj = subjectService.create({
      subject_code: 'VP_FILL_OK',
      name: '回填-在窗',
      study_id: studyId,
    });
    const visits = visitService.generateVisitPlanForSubject(subj.id, '2026-01-01');
    const c1 = visits.find((v) => v.visit_code === 'c1');
    const originalC2 = visits.find((v) => v.visit_code === 'c2');
    const originalC2Date = originalC2.visit_date;

    // C1 计划窗口 [2026-01-19, 2026-01-25]，回填实际 2026-01-23（在窗内）
    const result = visitService.fillActualDate(c1.id, '2026-01-23');
    expect(result.visit.status).toBe('已完成');
    expect(result.deviation).toBeNull();

    // 后续 C2~F3 应已重算（共 8 个）
    expect(result.recalculated).toBe(8);

    // C2 新计划日应为 2026-01-23 + 21 = 2026-02-13
    const newC2 = visitService.getById(originalC2.id);
    expect(newC2.visit_date).toBe('2026-02-13');
    expect(newC2.visit_date).not.toBe(originalC2Date);
  });

  test('fillActualDate 应将实际日期写入结构化 actual_date 字段（Bug 2/9 回归）', () => {
    // 回归测试：设计文档 §4.2 规定 visits 表应有 actual_date 列。
    // 原实现仅将实际日期以文本追加到 notes，导致无法结构化查询。
    const subj = subjectService.create({
      subject_code: 'VP_ACTUAL_DATE',
      name: '结构化实际日期',
      study_id: studyId,
    });
    const visits = visitService.generateVisitPlanForSubject(subj.id, '2026-01-01');
    const c1 = visits.find((v) => v.visit_code === 'c1');

    // 回填前 actual_date 应为空
    expect(c1.actual_date).toBeNull();

    const result = visitService.fillActualDate(c1.id, '2026-01-23');
    // actual_date 应为结构化字段，值等于回填的实际日期
    expect(result.visit.actual_date).toBe('2026-01-23');
    // notes 仍保留可读审计痕迹
    expect(result.visit.notes).toContain('2026-01-23');

    // 直接通过 create/update 写入 actual_date 也应被持久化
    const manual = visitService.create({
      subject_id: subj.id,
      visit_code: 'manual',
      visit_type: '手动记录',
      visit_date: '2026-02-01',
      actual_date: '2026-02-02',
      status: '已完成',
    });
    const reloaded = visitService.getById(manual.id);
    expect(reloaded.actual_date).toBe('2026-02-02');
  });

  test('fillActualDate 超窗应标记为已偏离并生成偏离记录', () => {
    const subj = subjectService.create({
      subject_code: 'VP_FILL_OVER',
      name: '回填-超窗',
      study_id: studyId,
    });
    const visits = visitService.generateVisitPlanForSubject(subj.id, '2026-01-01');
    const c1 = visits.find((v) => v.visit_code === 'c1');
    // C1 窗口 [2026-01-19, 2026-01-25]，回填 2026-02-10（超窗）
    const result = visitService.fillActualDate(c1.id, '2026-02-10');
    expect(result.visit.status).toBe('已偏离');
    expect(result.deviation).not.toBeNull();
    expect(result.deviation.deviation_type).toBe('window_exceeded');
  });

  test('fillActualDate 最后一个访视完成应更新受试者状态为完成', () => {
    const subj = subjectService.create({
      subject_code: 'VP_FINISH',
      name: '完成试验',
      study_id: studyId,
    });
    const visits = visitService.generateVisitPlanForSubject(subj.id, '2026-01-01');
    // 先完成前面所有访视，简化处理：直接对最后一个 F3 回填
    const f3 = visits.find((v) => v.visit_code === 'f3');
    const result = visitService.fillActualDate(f3.id, f3.visit_date);
    expect(result.subjectCompleted).toBe(true);
    const updated = subjectService.getById(subj.id);
    expect(updated.status).toBe('完成');
  });

  test('fillActualDate 不存在的访视应抛错', () => {
    expect(() => visitService.fillActualDate(99999, '2026-01-01')).toThrow();
  });

  test('fillActualDate 非法日期应抛错', () => {
    const subj = subjectService.create({
      subject_code: 'VP_INVALID',
      name: '非法日期',
      study_id: studyId,
    });
    const visits = visitService.generateVisitPlanForSubject(subj.id, '2026-01-01');
    expect(() => visitService.fillActualDate(visits[0].id, 'bad-date')).toThrow();
  });
});

describe('方案偏离服务（deviationService）', () => {
  const testDbPath = path.join(__dirname, 'test_deviation.db');
  let studyId, subjectId;

  beforeAll(() => {
    process.env.TEST_DB_PATH = testDbPath;
    initDatabase();
    const study = studyService.create({
      study_code: 'DEV_TEST',
      study_name: '偏离检测测试研究',
    });
    studyId = study.id;
    const subject = subjectService.create({
      subject_code: 'DEV_S001',
      name: '偏离测试受试者',
      study_id: studyId,
    });
    subjectId = subject.id;
  });

  afterAll(() => {
    closeDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  test('应能手动创建偏离记录', () => {
    const visit = visitService.create({
      subject_id: subjectId,
      visit_code: 'c1',
      visit_type: '治疗期C1',
      visit_date: '2026-01-22',
      visit_window_end: '2026-01-25',
      status: '计划中',
    });
    const dev = deviationService.create({
      subject_id: subjectId,
      visit_id: visit.id,
      deviation_type: 'window_exceeded',
      description: '手动记录偏离',
    });
    expect(dev).toBeDefined();
    expect(dev.id).toBeDefined();
    expect(dev.deviation_type).toBe('window_exceeded');
    expect(dev.description).toBe('手动记录偏离');
  });

  test('detectForVisit 超窗访视应生成偏离记录', () => {
    const visit = visitService.create({
      subject_id: subjectId,
      visit_code: 'c2',
      visit_type: '治疗期C2',
      visit_date: '2025-01-01',
      visit_window_start: '2024-12-29',
      visit_window_end: '2025-01-04',
      status: '计划中',
    });
    const dev = deviationService.detectForVisit(visit, '2026-06-13');
    expect(dev).not.toBeNull();
    expect(dev.visit_id).toBe(visit.id);
  });

  test('detectForVisit 未超窗访视应返回 null', () => {
    const visit = visitService.create({
      subject_id: subjectId,
      visit_code: 'c3',
      visit_type: '治疗期C3',
      visit_date: '2027-01-01',
      visit_window_start: '2026-12-29',
      visit_window_end: '2027-01-04',
      status: '计划中',
    });
    const dev = deviationService.detectForVisit(visit, '2026-06-13');
    expect(dev).toBeNull();
  });

  test('detectForVisit 已完成访视不应判超窗', () => {
    const visit = visitService.create({
      subject_id: subjectId,
      visit_code: 'c4',
      visit_type: '治疗期C4',
      visit_date: '2025-01-01',
      visit_window_end: '2025-01-04',
      status: '已完成',
    });
    const dev = deviationService.detectForVisit(visit, '2026-06-13');
    expect(dev).toBeNull();
  });

  test('detectForVisit 已有偏离记录的访视不应重复生成', () => {
    const visit = visitService.create({
      subject_id: subjectId,
      visit_code: 'c5',
      visit_type: '治疗期C5',
      visit_date: '2025-01-01',
      visit_window_end: '2025-01-04',
      status: '计划中',
    });
    const d1 = deviationService.detectForVisit(visit, '2026-06-13');
    expect(d1).not.toBeNull();
    const d2 = deviationService.detectForVisit(visit, '2026-06-13');
    expect(d2).toBeNull();
  });

  test('autoDetectDeviations 应批量检测所有超窗访视', () => {
    // 之前已有若干超窗访视；再添加一个
    visitService.create({
      subject_id: subjectId,
      visit_code: 'c6',
      visit_type: '治疗期C6',
      visit_date: '2025-01-01',
      visit_window_end: '2025-01-04',
      status: '计划中',
    });
    const result = deviationService.autoDetectDeviations({ referenceDate: '2026-06-13' });
    expect(result.detected).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(result.records)).toBe(true);
  });

  test('应能获取偏离列表（含关联信息）', () => {
    const list = deviationService.getList({ subject_id: subjectId });
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0]).toHaveProperty('subject_code');
  });

  test('应能按受试者查询偏离记录', () => {
    const records = deviationService.getBySubjectId(subjectId);
    expect(records.length).toBeGreaterThanOrEqual(1);
  });

  test('应能获取偏离汇总报表', () => {
    const summary = deviationService.getSummary();
    expect(summary).toHaveProperty('total');
    expect(summary.total).toBeGreaterThanOrEqual(1);
    expect(summary).toHaveProperty('byType');
    expect(summary).toHaveProperty('byStatus');
    expect(summary).toHaveProperty('byStudy');
  });

  test('应能删除偏离记录', () => {
    const dev = deviationService.create({
      subject_id: subjectId,
      description: '待删除偏离',
    });
    expect(deviationService.remove(dev.id)).toBe(true);
    expect(deviationService.getById(dev.id)).toBeUndefined();
  });

  test('visitService.checkAndMarkDeviations 应委托 deviationService 执行批量检测', () => {
    const result = visitService.checkAndMarkDeviations('2026-06-13');
    expect(result).toHaveProperty('detected');
    expect(result).toHaveProperty('records');
  });
});