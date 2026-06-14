/**
 * 数据库连接模块
 *
 * 说明：
 * - 测试套件（tests/*.test.js）期望 sql.js 风格的 exec() 返回 [{columns, values}]，
 *   同时业务服务（services/*）使用 better-sqlite3 风格的 prepare().all/get/run。
 * - 为同时满足两者，且无需异步初始化（多数测试在 beforeAll 中同步调用 initDatabase()），
 *   本模块基于 Node.js 内置的 node:sqlite (DatabaseSync) 实现一个同步的、双风格兼容的封装。
 */

const path = require('path');
const fs = require('fs');

// 抑制 node:sqlite 的 ExperimentalWarning（输出到 stderr，不影响测试）
try {
  process.env.NODE_NO_WARNINGS = process.env.NODE_NO_WARNINGS || '1';
} catch (e) {
  // ignore
}

const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB_PATH = path.join(__dirname, '..', '..', 'data', 'followup.db');

let dbInstance = null;
let currentDbPath = null;

// ============================================================
// Schema
// ============================================================
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS studies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  study_code TEXT NOT NULL UNIQUE,
  study_name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT '进行中',
  pi_name TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_code TEXT NOT NULL,
  name TEXT DEFAULT '',
  gender TEXT DEFAULT '',
  birth_date TEXT,
  phone TEXT DEFAULT '',
  id_number TEXT DEFAULT '',
  study_id INTEGER NOT NULL,
  status TEXT DEFAULT '筛选中',
  assigned_user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(study_id, subject_code)
);

-- F5：用户与权限（角色：pi=主要研究者可看全部，crc=协调员只能看分配给自己的受试者）
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'crc',
  display_name TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL,
  study_id INTEGER,
  visit_code TEXT DEFAULT '',
  visit_type TEXT DEFAULT '',
  visit_date TEXT,
  visit_window_start TEXT,
  visit_window_end TEXT,
  actual_date TEXT,
  status TEXT DEFAULT '计划中',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS measurement_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type_name TEXT NOT NULL,
  unit TEXT DEFAULT '',
  normal_min REAL,
  normal_max REAL,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER NOT NULL,
  type_id INTEGER NOT NULL,
  value REAL,
  measured_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS reminder_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  study_id INTEGER,
  name TEXT DEFAULT '',
  trigger_type TEXT DEFAULT 'before_visit',
  trigger_offset_days INTEGER DEFAULT 0,
  reminder_type TEXT DEFAULT '短信',
  content_template TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER,
  subject_id INTEGER,
  study_id INTEGER,
  rule_id INTEGER,
  reminder_type TEXT DEFAULT '短信',
  reminder_date TEXT,
  content TEXT DEFAULT '',
  status TEXT DEFAULT '待发送',
  sent_at TEXT,
  fail_reason TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS notification_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_type TEXT NOT NULL,
  provider TEXT DEFAULT '',
  api_key TEXT DEFAULT '',
  api_secret TEXT DEFAULT '',
  sign_name TEXT DEFAULT '',
  template_code TEXT DEFAULT '',
  smtp_host TEXT DEFAULT '',
  smtp_port INTEGER,
  smtp_user TEXT DEFAULT '',
  smtp_pass TEXT DEFAULT '',
  from_name TEXT DEFAULT '',
  use_ssl INTEGER DEFAULT 0,
  app_id TEXT DEFAULT '',
  app_secret TEXT DEFAULT '',
  template_id TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS notification_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_type TEXT DEFAULT '',
  channel_id INTEGER,
  recipient TEXT DEFAULT '',
  content TEXT DEFAULT '',
  status TEXT DEFAULT '',
  response TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS deviations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER,
  visit_id INTEGER,
  deviation_type TEXT DEFAULT '',
  deviation_date TEXT,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_subjects_study_id ON subjects(study_id);
CREATE INDEX IF NOT EXISTS idx_visits_subject_id ON visits(subject_id);
CREATE INDEX IF NOT EXISTS idx_visits_study_id ON visits(study_id);
CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(visit_date);
CREATE INDEX IF NOT EXISTS idx_reminders_visit_id ON reminders(visit_id);
CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status);
CREATE INDEX IF NOT EXISTS idx_reminder_rules_study_id ON reminder_rules(study_id);
`;

/**
 * 兼容旧库：若表中不存在某列则添加（CREATE TABLE IF NOT EXISTS 不补列）
 * @param {DatabaseSync} inner
 * @param {string} table
 * @param {string} column
 * @param {string} type SQL 类型，如 'TEXT' / 'INTEGER'
 * @param {string} defaultValue 默认值字面量，如 "''" / 'NULL' / '0'
 */
function _ensureColumn(inner, table, column, type, defaultValue) {
  try {
    const cols = inner.prepare(`PRAGMA table_info(${table})`).all();
    const exists = cols.some((c) => c.name === column);
    if (!exists) {
      inner.exec(
        `ALTER TABLE ${table} ADD COLUMN ${column} ${type} DEFAULT ${defaultValue};`
      );
    }
  } catch (e) {
    // 表不存在等异常忽略
  }
}

const SEED_MEASUREMENT_TYPES = [
  { type_name: '体温', unit: '℃', normal_min: 36.0, normal_max: 37.2 },
  { type_name: '收缩压', unit: 'mmHg', normal_min: 90, normal_max: 140 },
  { type_name: '舒张压', unit: 'mmHg', normal_min: 60, normal_max: 90 },
  { type_name: '心率', unit: '次/分', normal_min: 60, normal_max: 100 },
  { type_name: '血糖', unit: 'mmol/L', normal_min: 3.9, normal_max: 6.1 },
];

// ============================================================
// 兼容封装：同时提供 sql.js 风格 exec() 与 better-sqlite3 风格 prepare()
// ============================================================

/**
 * 从 SQL 中解析具名参数（@name）列表
 */
function extractNamedParams(sql) {
  const names = [];
  const re = /[:@]([A-Za-z_][A-Za-z0-9_]*)/g;
  let m;
  while ((m = re.exec(sql)) !== null) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

class Statement {
  constructor(innerDb, sql) {
    this.sql = sql;
    this.namedParams = extractNamedParams(sql);
    this.inner = innerDb.prepare(sql);
  }

  _normalize(args) {
    if (!args || args.length === 0) return [];
    if (args.length === 1) {
      const a = args[0];
      if (
        a !== null &&
        typeof a === 'object' &&
        !Array.isArray(a) &&
        !Buffer.isBuffer(a)
      ) {
        // 具名参数对象：仅保留 SQL 中实际出现的参数，避免 "Unknown named parameter"
        if (this.namedParams.length > 0) {
          const filtered = {};
          for (const k of this.namedParams) {
            if (k in a) filtered[k] = a[k];
          }
          return [filtered];
        }
        return [a];
      }
      return [a];
    }
    // 多个位置参数
    return args;
  }

  all(...args) {
    return this.inner.all(...this._normalize(args));
  }

  get(...args) {
    return this.inner.get(...this._normalize(args));
  }

  run(...args) {
    return this.inner.run(...this._normalize(args));
  }

  /**
   * sql.js 风格：返回 {columns, values}
   */
  getAsObject(...args) {
    const rows = this.all(...args);
    const columns = this.inner
      .columns()
      .map((c) => c.name);
    const values = rows.map((r) => columns.map((c) => r[c]));
    return { columns, values };
  }
}

class DatabaseWrapper {
  constructor(innerDb) {
    this.inner = innerDb;
  }

  /**
   * better-sqlite3 风格的预处理语句
   */
  prepare(sql) {
    return new Statement(this.inner, sql);
  }

  /**
   * 执行（可多条）DDL/DML；不返回行
   */
  exec(sql) {
    const trimmed = String(sql).trim();
    // 对返回结果集的语句（SELECT / PRAGMA），按 sql.js 风格返回 [{columns, values}]
    if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(trimmed)) {
      try {
        const stmt = new Statement(this.inner, sql);
        const result = stmt.getAsObject();
        return [result];
      } catch (e) {
        // 某些 PRAGMA/DDL 不能 prepare，退回直接执行
        this.inner.exec(sql);
        return [];
      }
    }
    this.inner.exec(sql);
    return [];
  }

  pragma(cmd) {
    return this.inner.prepare(`PRAGMA ${cmd}`).all();
  }

  close() {
    return this.inner.close();
  }
}

// ============================================================
// 对外 API
// ============================================================

function resolveDbPath() {
  if (process.env.TEST_DB_PATH) return process.env.TEST_DB_PATH;
  return DEFAULT_DB_PATH;
}

/**
 * 初始化数据库（同步，亦返回 resolved Promise 以兼容 await 用法）
 */
function initDatabase() {
  const dbPath = resolveDbPath();

  // 若已使用相同路径初始化，保证幂等（不重复建表/插数据）
  if (dbInstance && currentDbPath === dbPath) {
    return Promise.resolve();
  }

  // 若之前用其他路径打开，先关闭
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch (e) {
      /* ignore */
    }
    dbInstance = null;
    currentDbPath = null;
  }

  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const inner = new DatabaseSync(dbPath);
  inner.exec('PRAGMA foreign_keys = ON');
  dbInstance = new DatabaseWrapper(inner);
  currentDbPath = dbPath;

  // 建表
  inner.exec(SCHEMA_SQL);

  // 兼容旧库：补列（CREATE TABLE IF NOT EXISTS 不会为已存在的表添加新列）
  _ensureColumn(inner, 'studies', 'pi_name', 'TEXT', "''");
  _ensureColumn(inner, 'subjects', 'assigned_user_id', 'INTEGER', 'NULL');
  _ensureColumn(inner, 'visits', 'actual_date', 'TEXT', 'NULL');

  // 幂等初始化默认测量类型
  try {
    const countRow = inner.prepare('SELECT COUNT(*) AS c FROM measurement_types').get();
    if (!countRow || countRow.c === 0) {
      const stmt = inner.prepare(
        'INSERT INTO measurement_types (type_name, unit, normal_min, normal_max) VALUES (?, ?, ?, ?)'
      );
      for (const t of SEED_MEASUREMENT_TYPES) {
        stmt.run(t.type_name, t.unit, t.normal_min, t.normal_max);
      }
    }
  } catch (e) {
    // 表尚未创建等异常忽略
  }

  return Promise.resolve();
}

/**
 * 获取数据库实例
 */
function getDatabase() {
  if (!dbInstance) {
    initDatabase();
  }
  return dbInstance;
}

/**
 * 关闭数据库连接
 */
function closeDatabase() {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch (e) {
      /* ignore */
    }
    dbInstance = null;
    currentDbPath = null;
  }
}

/**
 * 重置数据库连接（用于测试）
 */
function resetDatabase() {
  closeDatabase();
}

module.exports = {
  initDatabase,
  getDatabase,
  closeDatabase,
  resetDatabase,
  DatabaseWrapper,
  DEFAULT_DB_PATH,
};