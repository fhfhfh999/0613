/**
 * 认证与权限中间件（需求 F5）
 *
 * 说明：
 * - 提供 requireAuth / requireRole / optionalAuth 三个中间件。
 * - 实际生产部署应在 app.js 中对受保护接口挂载 requireAuth。
 *
 * 用法：
 *   const auth = require('./middleware/auth');
 *   app.get('/api/studies', auth.requireAuth, handler);
 *   app.delete('/api/users/:id', auth.requireAuth, auth.requireRole('pi'), handler);
 */

const authService = require('../services/authService');

/**
 * 从请求头读取令牌
 *   Authorization: Bearer <token>
 *   或 query: ?token=<token>
 */
function _extractToken(req) {
  const header = req.headers && req.headers.authorization;
  if (header && /^Bearer\s+/i.test(header)) {
    return header.replace(/^Bearer\s+/i, '').trim();
  }
  if (req.query && req.query.token) {
    return String(req.query.token);
  }
  return null;
}

/**
 * 要求登录（解析令牌并挂载到 req.user）
 * - 401 未提供令牌 / 令牌无效 / 已过期 / 用户已禁用
 */
function requireAuth(req, res, next) {
  const token = _extractToken(req);
  const user = token ? authService.resolveToken(token) : null;
  if (!user) {
    return res.status(401).json({ error: '未登录或登录已过期' });
  }
  req.user = user;
  req.token = token;
  return next();
}

/**
 * 要求具备指定角色之一
 */
function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ error: '未登录或登录已过期' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '权限不足' });
    }
    return next();
  };
}

/**
 * 软鉴权：若令牌存在则解析并挂载 req.user；不存在也不拦截。
 * 用于"既能公开访问、又能在登录后按权限过滤"的接口。
 */
function optionalAuth(req, res, next) {
  const token = _extractToken(req);
  const user = token ? authService.resolveToken(token) : null;
  req.user = user || null;
  req.token = token || null;
  return next();
}

module.exports = {
  requireAuth,
  requireRole,
  optionalAuth,
  _extractToken,
};