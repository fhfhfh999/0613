/**
 * 认证与权限服务（需求 F5：简单的权限控制）
 *
 * 业务规则（需求 2.2）：
 * - CRC（临床研究协调员）只能看分配给自己的受试者
 * - PI（主要研究者）可查看全部
 *
 * 实现：
 * - 用户表 users（username, password_hash, role: 'pi'|'crc', display_name, enabled）
 * - 密码采用加盐 HMAC-SHA256（Node 内置 crypto，无外部依赖）
 * - 令牌采用 base64url(JSON) + HMAC 签名（无状态、便于演示，非生产级 JWT 库）
 * - 提供：用户 CRUD、登录、令牌签发/校验
 *
 * 角色说明：
 * - 'pi'  PI，可访问全部数据
 * - 'crc' 协调员，仅可访问 assigned_user_id = 自己 的受试者相关数据
 */

const crypto = require('crypto');
const { getDatabase } = require('../models/database');

// 签名密钥（演示用，生产环境请通过环境变量配置并妥善保管）
const SECRET = process.env.AUTH_SECRET || 'followup-reminder-system-demo-secret-2026';
const TOKEN_TTL_MS = 1000 * 60 * 60 * 12; // 12 小时

const VALID_ROLES = ['pi', 'crc'];

/**
 * 加盐哈希密码（返回 "salt$hash"，便于校验）
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(8).toString('hex');
  const hash = crypto
    .createHmac('sha256', SECRET)
    .update(salt + ':' + String(password))
    .digest('hex');
  return `${salt}$${hash}`;
}

/**
 * 校验密码
 */
function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const expect = crypto
    .createHmac('sha256', SECRET)
    .update(salt + ':' + String(password))
    .digest('hex');
  // 常量时间比较，降低时序攻击风险
  return crypto.timingSafeEqual(Buffer.from(expect, 'hex'), Buffer.from(hash, 'hex'));
}

function b64urlEncode(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function b64urlDecode(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
}

/**
 * 签发令牌：base64url(payload).base64url(exp).signature
 */
function signToken(user) {
  const payload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    display_name: user.display_name,
  };
  const exp = Date.now() + TOKEN_TTL_MS;
  const body = `${b64urlEncode(payload)}.${b64urlEncode({ exp })}`;
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  return `${body}.${sig}`;
}

/**
 * 校验令牌并返回 payload；失败返回 null
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [payloadStr, expStr, sig] = parts;
  const body = `${payloadStr}.${expStr}`;
  const expectSig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  if (sig !== expectSig) return null;
  let payload, expObj;
  try {
    payload = b64urlDecode(payloadStr);
    expObj = b64urlDecode(expStr);
  } catch (e) {
    return null;
  }
  if (!expObj.exp || Date.now() > expObj.exp) return null;
  return payload;
}

const authService = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,

  /**
   * 创建用户
   * @param {Object} data { username, password, role, display_name }
   */
  create(data) {
    const db = getDatabase();
    if (!data.username) throw new Error('用户名不能为空');
    if (!data.password) throw new Error('密码不能为空');
    const role = data.role || 'crc';
    if (!VALID_ROLES.includes(role)) {
      throw new Error(`角色非法，应为 ${VALID_ROLES.join(' 或 ')}`);
    }
    const stmt = db.prepare(`
      INSERT INTO users (username, password_hash, role, display_name, enabled)
      VALUES (@username, @password_hash, @role, @display_name, @enabled)
    `);
    const params = {
      username: data.username,
      password_hash: hashPassword(data.password),
      role,
      display_name: data.display_name || '',
      enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : 1,
    };
    const result = stmt.run(params);
    return this.getById(result.lastInsertRowid);
  },

  /**
   * 根据 ID 获取用户（不含密码哈希）
   */
  getById(id) {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    return row ? this._strip(row) : undefined;
  },

  /**
   * 根据用户名获取用户（含密码哈希，内部使用）
   */
  _getByUsernameWithHash(username) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  },

  /**
   * 获取所有用户
   */
  getAll() {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM users ORDER BY id ASC')
      .all();
    return rows.map((r) => this._strip(r));
  },

  /**
   * 获取所有 CRC（用于受试者分配下拉）
   */
  getAllCrcs() {
    const db = getDatabase();
    const rows = db
      .prepare("SELECT * FROM users WHERE role = 'crc' ORDER BY id ASC")
      .all();
    return rows.map((r) => this._strip(r));
  },

  /**
   * 隐藏密码哈希
   */
  _strip(row) {
    if (!row) return row;
    const { password_hash, ...rest } = row;
    return rest;
  },

  /**
   * 更新用户（密码可选）
   */
  update(id, data) {
    const db = getDatabase();
    const current = this.getById(id);
    if (!current) return false;
    const role = data.role !== undefined ? data.role : current.role;
    if (!VALID_ROLES.includes(role)) {
      throw new Error(`角色非法，应为 ${VALID_ROLES.join(' 或 ')}`);
    }
    if (data.password) {
      db.prepare(
        `UPDATE users
            SET username = @username, password_hash = @password_hash,
                role = @role, display_name = @display_name, enabled = @enabled,
                updated_at = datetime('now','localtime')
          WHERE id = @id`
      ).run({
        username: data.username !== undefined ? data.username : current.username,
        password_hash: hashPassword(data.password),
        role,
        display_name: data.display_name !== undefined ? data.display_name : current.display_name,
        enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : current.enabled,
        id,
      });
    } else {
      db.prepare(
        `UPDATE users
            SET username = @username, role = @role,
                display_name = @display_name, enabled = @enabled,
                updated_at = datetime('now','localtime')
          WHERE id = @id`
      ).run({
        username: data.username !== undefined ? data.username : current.username,
        role,
        display_name: data.display_name !== undefined ? data.display_name : current.display_name,
        enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : current.enabled,
        id,
      });
    }
    return true;
  },

  /**
   * 删除用户
   */
  remove(id) {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return result.changes > 0;
  },

  /**
   * 登录：校验用户名密码，返回 { token, user } 或抛错
   */
  login(username, password) {
    if (!username || !password) throw new Error('用户名和密码不能为空');
    const user = this._getByUsernameWithHash(username);
    if (!user) throw new Error('用户名或密码错误');
    if (!user.enabled) throw new Error('用户已被禁用');
    if (!verifyPassword(password, user.password_hash)) {
      throw new Error('用户名或密码错误');
    }
    return {
      token: signToken(user),
      user: this._strip(user),
    };
  },

  /**
   * 校验令牌并返回用户对象（不存在或已禁用返回 null）
   */
  resolveToken(token) {
    const payload = verifyToken(token);
    if (!payload) return null;
    const user = this.getById(payload.sub);
    if (!user || !user.enabled) return null;
    return user;
  },

  /**
   * 权限判断工具
   */
  isPi(user) {
    return !!user && user.role === 'pi';
  },
  isCrc(user) {
    return !!user && user.role === 'crc';
  },
};

module.exports = authService;