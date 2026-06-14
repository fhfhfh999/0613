/**
 * 数据库模块测试
 * 
 * 注意：sql.js 是异步的（基于 WASM），与 better-sqlite3 的同步 API 不同
 * - db.prepare(sql) 返回的 statement 使用 stmt.bind() / stmt.step() / stmt.getAsObject()
 * - db.exec(sql) 直接执行 SQL 并返回结果
 * - 无 db.pragma()，需用 db.exec("PRAGMA table_info(...)") 代替
 */

const { initDatabase, getDatabase, closeDatabase } = require('../src/models/database');
const path = require('path');
const fs = require('fs');

describe('数据库模块', () => {
  const testDbPath = path.join(__dirname, 'test_database.db');

  beforeAll(async () => {
    // 使用测试专用数据库
    process.env.TEST_DB_PATH = testDbPath;
    await initDatabase();
  });

  afterAll(() => {
    closeDatabase();
    // 清理测试数据库文件
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  test('应能成功初始化数据库', () => {
    // 已在 beforeAll 中初始化，此处验证不抛异常
    expect(() => initDatabase()).not.toThrow();
  });

  test('应能获取数据库实例', () => {
    const db = getDatabase();
    expect(db).toBeDefined();
    // sql.js 数据库有 prepare 和 exec 方法
    expect(typeof db.exec).toBe('function');
  });

  test('应创建所有必要的表', () => {
    const db = getDatabase();
    const result = db.exec(`
      SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
    `);
    // sql.js exec 返回 [{columns, values}] 结构
    const tableNames = result.length > 0 ? result[0].values.map(v => v[0]) : [];

    expect(tableNames).toContain('studies');
    expect(tableNames).toContain('subjects');
    expect(tableNames).toContain('visits');
    expect(tableNames).toContain('measurement_types');
    expect(tableNames).toContain('measurements');
  });

  test('studies 表应有正确的列', () => {
    const db = getDatabase();
    const result = db.exec('PRAGMA table_info(studies)');
    const colNames = result.length > 0 ? result[0].values.map(v => v[1]) : [];

    expect(colNames).toContain('id');
    expect(colNames).toContain('study_code');
    expect(colNames).toContain('study_name');
    expect(colNames).toContain('description');
    expect(colNames).toContain('status');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');
  });

  test('subjects 表应有正确的列', () => {
    const db = getDatabase();
    const result = db.exec('PRAGMA table_info(subjects)');
    const colNames = result.length > 0 ? result[0].values.map(v => v[1]) : [];

    expect(colNames).toContain('id');
    expect(colNames).toContain('subject_code');
    expect(colNames).toContain('name');
    expect(colNames).toContain('gender');
    expect(colNames).toContain('birth_date');
    expect(colNames).toContain('phone');
    expect(colNames).toContain('id_number');
    expect(colNames).toContain('study_id');
    expect(colNames).toContain('status');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');
  });

  test('visits 表应有正确的列', () => {
    const db = getDatabase();
    const result = db.exec('PRAGMA table_info(visits)');
    const colNames = result.length > 0 ? result[0].values.map(v => v[1]) : [];

    expect(colNames).toContain('id');
    expect(colNames).toContain('subject_id');
    expect(colNames).toContain('study_id');
    expect(colNames).toContain('visit_code');
    expect(colNames).toContain('visit_date');
    expect(colNames).toContain('visit_window_start');
    expect(colNames).toContain('visit_window_end');
    expect(colNames).toContain('status');
    expect(colNames).toContain('notes');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');
  });

  test('measurement_types 表应有正确的列', () => {
    const db = getDatabase();
    const result = db.exec('PRAGMA table_info(measurement_types)');
    const colNames = result.length > 0 ? result[0].values.map(v => v[1]) : [];

    expect(colNames).toContain('id');
    expect(colNames).toContain('type_name');
    expect(colNames).toContain('unit');
    expect(colNames).toContain('normal_min');
    expect(colNames).toContain('normal_max');
  });

  test('measurements 表应有正确的列', () => {
    const db = getDatabase();
    const result = db.exec('PRAGMA table_info(measurements)');
    const colNames = result.length > 0 ? result[0].values.map(v => v[1]) : [];

    expect(colNames).toContain('id');
    expect(colNames).toContain('visit_id');
    expect(colNames).toContain('type_id');
    expect(colNames).toContain('value');
    expect(colNames).toContain('measured_at');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');
  });

  test('应初始化默认测量类型数据', () => {
    const db = getDatabase();
    const result = db.exec('SELECT * FROM measurement_types');
    const types = result.length > 0 ? result[0].values.map(row => ({
      type_name: row[1]
    })) : [];

    expect(types.length).toBeGreaterThanOrEqual(3);

    const typeNames = types.map(t => t.type_name);
    expect(typeNames).toContain('体温');
    expect(typeNames).toContain('收缩压');
    expect(typeNames).toContain('舒张压');
  });

  test('多次初始化不应重复创建数据', async () => {
    await initDatabase();
    await initDatabase();
    const db = getDatabase();
    const result = db.exec('SELECT * FROM measurement_types');
    const types = result.length > 0 ? result[0].values : [];

    // 应该仍然只有初始的测量类型
    expect(types.length).toBeGreaterThanOrEqual(3);
    expect(types.length).toBeLessThan(10);
  });
});