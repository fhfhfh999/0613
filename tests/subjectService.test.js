/**
 * 受试者服务测试
 */

const { initDatabase, closeDatabase } = require('../src/models/database');
const studyService = require('../src/services/studyService');
const subjectService = require('../src/services/subjectService');
const path = require('path');
const fs = require('fs');

describe('受试者服务', () => {
  const testDbPath = path.join(__dirname, 'test_subject.db');
  let studyId;

  beforeAll(() => {
    process.env.TEST_DB_PATH = testDbPath;
    initDatabase();
    const study = studyService.create({
      study_code: 'S_TEST',
      study_name: '受试者测试用研究',
    });
    studyId = study.id;
  });

  afterAll(() => {
    closeDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  test('应能创建受试者', () => {
    const data = {
      subject_code: 'SUB001',
      name: '张三',
      gender: '男',
      birth_date: '1990-01-15',
      phone: '13800138000',
      id_number: '110101199001150012',
      study_id: studyId,
    };
    const result = subjectService.create(data);
    expect(result).toBeDefined();
    expect(result.subject_code).toBe('SUB001');
    expect(result.name).toBe('张三');
    expect(result.id).toBeDefined();
  });

  test('应能获取某研究下的所有受试者', () => {
    const subjects = subjectService.getByStudyId(studyId);
    expect(Array.isArray(subjects)).toBe(true);
    expect(subjects.length).toBeGreaterThanOrEqual(1);
    subjects.forEach(s => expect(s.study_id).toBe(studyId));
  });

  test('应能根据ID获取受试者', () => {
    const created = subjectService.create({
      subject_code: 'SUB002',
      name: '李四',
      gender: '女',
      study_id: studyId,
    });
    const found = subjectService.getById(created.id);
    expect(found).toBeDefined();
    expect(found.name).toBe('李四');
  });

  test('获取不存在的受试者应返回 undefined', () => {
    expect(subjectService.getById(99999)).toBeUndefined();
  });

  test('应能更新受试者信息', () => {
    const created = subjectService.create({
      subject_code: 'SUB003',
      name: '原姓名',
      gender: '男',
      study_id: studyId,
    });
    subjectService.update(created.id, { name: '新姓名', phone: '13900139000' });
    const found = subjectService.getById(created.id);
    expect(found.name).toBe('新姓名');
    expect(found.phone).toBe('13900139000');
  });

  test('应能删除受试者', () => {
    const created = subjectService.create({
      subject_code: 'SUB004',
      name: '待删除',
      gender: '男',
      study_id: studyId,
    });
    expect(subjectService.remove(created.id)).toBe(true);
    expect(subjectService.getById(created.id)).toBeUndefined();
  });

  test('应支持受试者状态筛选', () => {
    subjectService.create({
      subject_code: 'SUB_ACTIVE',
      name: '筛选中受试者',
      gender: '男',
      study_id: studyId,
      status: '筛选中',
    });
    subjectService.create({
      subject_code: 'SUB_ENROLL',
      name: '入组受试者',
      gender: '女',
      study_id: studyId,
      status: '已入组',
    });
    const active = subjectService.getByStudyId(studyId, { status: '筛选中' });
    expect(active.length).toBeGreaterThanOrEqual(1);
    active.forEach(s => expect(s.status).toBe('筛选中'));
  });

  test('应支持按姓名或编号搜索受试者', () => {
    const results = subjectService.search(studyId, '张三');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
