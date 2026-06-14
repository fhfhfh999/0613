/**
 * 研究项目服务测试
 */

const { initDatabase, closeDatabase } = require('../src/models/database');
const studyService = require('../src/services/studyService');
const path = require('path');
const fs = require('fs');

describe('研究项目服务', () => {
  const testDbPath = path.join(__dirname, 'test_study.db');

  beforeAll(() => {
    process.env.TEST_DB_PATH = testDbPath;
    initDatabase();
  });

  afterAll(() => {
    closeDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  test('应能创建研究项目', () => {
    const data = {
      study_code: 'STD001',
      study_name: '降压药疗效研究',
      description: '测试某种降压药物的疗效',
    };
    const result = studyService.create(data);
    expect(result).toBeDefined();
    expect(result.study_code).toBe('STD001');
    expect(result.study_name).toBe('降压药疗效研究');
    expect(result.id).toBeDefined();
  });

  test('应能获取所有研究项目', () => {
    const studies = studyService.getAll();
    expect(Array.isArray(studies)).toBe(true);
    expect(studies.length).toBeGreaterThanOrEqual(1);
  });

  test('应能根据ID获取研究项目', () => {
    const created = studyService.create({
      study_code: 'STD002',
      study_name: '测试研究',
    });
    const found = studyService.getById(created.id);
    expect(found).toBeDefined();
    expect(found.study_code).toBe('STD002');
  });

  test('获取不存在的研究项目应返回 undefined', () => {
    const found = studyService.getById(99999);
    expect(found).toBeUndefined();
  });

  test('应能更新研究项目', () => {
    const created = studyService.create({
      study_code: 'STD003',
      study_name: '原名称',
    });
    const updated = studyService.update(created.id, {
      study_code: 'STD003',
      study_name: '新名称',
      description: '更新后的描述',
    });
    expect(updated).toBe(true);
    const found = studyService.getById(created.id);
    expect(found.study_name).toBe('新名称');
  });

  test('应能删除研究项目', () => {
    const created = studyService.create({
      study_code: 'STD004',
      study_name: '待删除',
    });
    const removed = studyService.remove(created.id);
    expect(removed).toBe(true);
    expect(studyService.getById(created.id)).toBeUndefined();
  });

  test('删除不存在的研究项目应返回 false', () => {
    const removed = studyService.remove(99999);
    expect(removed).toBe(false);
  });

  test('应支持研究状态筛选', () => {
    studyService.create({ study_code: 'S_ACTIVE', study_name: '进行中研究', status: '进行中' });
    studyService.create({ study_code: 'S_DONE', study_name: '已完成研究', status: '已完成' });

    const all = studyService.getAll();
    const active = studyService.getAll({ status: '进行中' });
    expect(active.length).toBeLessThanOrEqual(all.length);
    active.forEach(s => expect(s.status).toBe('进行中'));
  });

  test('应支持按关键字搜索', () => {
    const results = studyService.search('降压');
    expect(Array.isArray(results)).toBe(true);
    results.forEach(s => {
      expect(s.study_name.includes('降压') || s.study_code.includes('降压')).toBe(true);
    });
  });
});