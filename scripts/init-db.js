/**
 * 数据库初始化与种子数据脚本
 *
 * 使用方式：
 *   npm run init-db
 *   （或直接 node scripts/init-db.js）
 *
 * 作用：
 *   1. 初始化/升级数据库表结构（由 src/models/database.js 负责）
 *   2. 幂等插入默认用户：
 *      - admin / admin123 （PI，可访问全部数据）
 *      - crc  / crc123    （CRC，仅可访问分配给自己的受试者）
 *   3. 幂等插入一个示例研究项目，便于演示
 */

const path = require('path');
const {
  initDatabase,
  getDatabase,
  DEFAULT_DB_PATH,
} = require('../src/models/database');
const authService = require('../src/services/authService');

function ensureUser({ username, password, role, display_name }) {
  const db = getDatabase();
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) {
    console.log(`[skip] 用户已存在：${username}（id=${exists.id}）`);
    return;
  }
  const u = authService.create({ username, password, role, display_name });
  console.log(`[ok] 创建用户：${username} / ${password}（角色=${role}, id=${u.id}）`);
}

function ensureSampleStudy() {
  const db = getDatabase();
  const exists = db
    .prepare("SELECT id FROM studies WHERE study_code = 'DEMO-001'")
    .get();
  if (exists) {
    console.log(`[skip] 示例研究已存在：DEMO-001（id=${exists.id}）`);
    return;
  }
  const result = db
    .prepare(
      `INSERT INTO studies (study_code, study_name, description, status)
       VALUES (?, ?, ?, ?)`
    )
    .run('DEMO-001', '示例研究项目', '用于演示与联调的示例研究', '进行中');
  console.log(`[ok] 创建示例研究：DEMO-001（id=${result.lastInsertRowid}）`);
}

function main() {
  console.log('========================================');
  console.log(' 受试者随访提醒系统 - 数据库初始化');
  console.log('========================================');
  console.log(`数据库路径：${DEFAULT_DB_PATH}`);
  console.log('');

  // 1. 初始化表结构
  initDatabase();

  // 2. 种子用户
  console.log('--- 初始化默认用户 ---');
  ensureUser({
    username: 'admin',
    password: 'admin123',
    role: 'pi',
    display_name: 'PI（主要研究者）',
  });
  ensureUser({
    username: 'crc',
    password: 'crc123',
    role: 'crc',
    display_name: 'CRC（协调员）',
  });

  // 3. 示例研究
  console.log('');
  console.log('--- 初始化示例研究 ---');
  ensureSampleStudy();

  console.log('');
  console.log('✅ 初始化完成！');
  console.log('   默认账号：');
  console.log('     PI  —— admin / admin123 （可访问全部数据）');
  console.log('     CRC —— crc  / crc123    （仅访问分配给自己的受试者）');
  console.log('   启动服务：npm start');
}

main();