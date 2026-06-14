/**
 * 通知渠道服务
 * 管理通知渠道（短信/邮件/微信）配置、测试发送、通知日志
 *
 * 说明：本系统为离线/测试环境，所有"发送"均为模拟，返回 { success, message }。
 */

const { getDatabase } = require('../models/database');

function normalizeRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const k of [
    'enabled',
    'use_ssl',
  ]) {
    if (out[k] !== undefined && out[k] !== null) {
      out[k] = !!out[k] || out[k] === 1 || out[k] === true;
    }
  }
  return out;
}

const notificationService = {
  // -------------------- 渠道管理 --------------------
  /**
   * 配置/新增通知渠道
   */
  configureChannel(config) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO notification_channels
        (channel_type, provider, api_key, api_secret, sign_name, template_code,
         smtp_host, smtp_port, smtp_user, smtp_pass, from_name, use_ssl,
         app_id, app_secret, template_id, enabled)
      VALUES
        (@channel_type, @provider, @api_key, @api_secret, @sign_name, @template_code,
         @smtp_host, @smtp_port, @smtp_user, @smtp_pass, @from_name, @use_ssl,
         @app_id, @app_secret, @template_id, @enabled)
    `);
    const params = {
      channel_type: config.channel_type,
      provider: config.provider || '',
      api_key: config.api_key || '',
      api_secret: config.api_secret || '',
      sign_name: config.sign_name || '',
      template_code: config.template_code || '',
      smtp_host: config.smtp_host || '',
      smtp_port: config.smtp_port !== undefined ? config.smtp_port : null,
      smtp_user: config.smtp_user || '',
      smtp_pass: config.smtp_pass || '',
      from_name: config.from_name || '',
      use_ssl:
        config.use_ssl === true || config.use_ssl === 1 ? 1 : 0,
      app_id: config.app_id || '',
      app_secret: config.app_secret || '',
      template_id: config.template_id || '',
      enabled:
        config.enabled === false || config.enabled === 0 ? 0 : 1,
    };
    const result = stmt.run(params);
    return this.getChannelById(result.lastInsertRowid);
  },

  /**
   * 获取所有渠道
   */
  getChannels() {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM notification_channels ORDER BY id ASC')
      .all();
    return rows.map(normalizeRow);
  },

  /**
   * 根据ID获取渠道
   */
  getChannelById(id) {
    const db = getDatabase();
    return normalizeRow(
      db.prepare('SELECT * FROM notification_channels WHERE id = ?').get(id)
    );
  },

  /**
   * 更新渠道配置
   */
  updateChannel(id, data) {
    const db = getDatabase();
    const current = this.getChannelById(id);
    if (!current) return false;

    const merged = {
      provider: data.provider !== undefined ? data.provider : current.provider,
      api_key: data.api_key !== undefined ? data.api_key : current.api_key,
      api_secret:
        data.api_secret !== undefined ? data.api_secret : current.api_secret,
      sign_name: data.sign_name !== undefined ? data.sign_name : current.sign_name,
      template_code:
        data.template_code !== undefined ? data.template_code : current.template_code,
      smtp_host:
        data.smtp_host !== undefined ? data.smtp_host : current.smtp_host,
      smtp_port:
        data.smtp_port !== undefined ? data.smtp_port : current.smtp_port,
      smtp_user:
        data.smtp_user !== undefined ? data.smtp_user : current.smtp_user,
      smtp_pass:
        data.smtp_pass !== undefined ? data.smtp_pass : current.smtp_pass,
      from_name:
        data.from_name !== undefined ? data.from_name : current.from_name,
      use_ssl:
        data.use_ssl !== undefined
          ? data.use_ssl === true || data.use_ssl === 1
            ? 1
            : 0
          : current.use_ssl
            ? 1
            : 0,
      app_id: data.app_id !== undefined ? data.app_id : current.app_id,
      app_secret:
        data.app_secret !== undefined ? data.app_secret : current.app_secret,
      template_id:
        data.template_id !== undefined ? data.template_id : current.template_id,
      enabled:
        data.enabled !== undefined
          ? data.enabled === false || data.enabled === 0
            ? 0
            : 1
          : current.enabled
            ? 1
            : 0,
    };
    const result = db
      .prepare(
        `UPDATE notification_channels
           SET provider = @provider, api_key = @api_key, api_secret = @api_secret,
               sign_name = @sign_name, template_code = @template_code,
               smtp_host = @smtp_host, smtp_port = @smtp_port, smtp_user = @smtp_user,
               smtp_pass = @smtp_pass, from_name = @from_name, use_ssl = @use_ssl,
               app_id = @app_id, app_secret = @app_secret, template_id = @template_id,
                enabled = @enabled, updated_at = datetime('now','localtime')
         WHERE id = @id`
       )
       .run({ ...merged, id });
    return result.changes > 0;
  },

  /**
   * 删除渠道
   */
  removeChannel(id) {
    const db = getDatabase();
    const result = db
      .prepare('DELETE FROM notification_channels WHERE id = ?')
      .run(id);
    return result.changes > 0;
  },

  // -------------------- 发送 --------------------
  /**
   * 测试渠道连通性（模拟）
   */
  async testChannel(channelId, recipient) {
    const channel = this.getChannelById(channelId);
    if (!channel) {
      return { success: false, message: '渠道不存在' };
    }
    if (!channel.enabled) {
      return { success: false, message: '渠道已禁用，无法测试' };
    }
    // 模拟发送
    this.createLog({
      channel_type: channel.channel_type,
      channel_id: channel.id,
      recipient,
      content: '【连通性测试】',
      status: 'success',
      response: JSON.stringify({ code: 'OK', simulated: true }),
    });
    return {
      success: true,
      message: `${channel.channel_type} 渠道测试成功（模拟）`,
    };
  },

  /**
   * 通过指定渠道发送通知（模拟）
   */
  async sendNotification(channelId, payload) {
    const channel = this.getChannelById(channelId);
    if (!channel) {
      return { success: false, message: '渠道不存在' };
    }
    if (!channel.enabled) {
      return { success: false, message: '该通知渠道已禁用' };
    }
    // 模拟发送成功
    this.createLog({
      channel_type: channel.channel_type,
      channel_id: channel.id,
      recipient: payload.to || '',
      content: payload.content || '',
      status: 'success',
      response: JSON.stringify({ code: 'OK', simulated: true }),
    });
    return {
      success: true,
      message: `${channel.channel_type} 通知发送成功（模拟）`,
    };
  },

  // -------------------- 日志 --------------------
  /**
   * 记录通知发送日志
   */
  createLog(data) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO notification_logs
        (channel_type, channel_id, recipient, content, status, response)
      VALUES
        (@channel_type, @channel_id, @recipient, @content, @status, @response)
    `);
    const params = {
      channel_type: data.channel_type || '',
      channel_id: data.channel_id || null,
      recipient: data.recipient || '',
      content: data.content || '',
      status: data.status || '',
      response: data.response || '',
    };
    const result = stmt.run(params);
    return db
      .prepare('SELECT * FROM notification_logs WHERE id = ?')
      .get(result.lastInsertRowid);
  },

  /**
   * 查询通知日志
   */
  getLogs(filter = {}) {
    const db = getDatabase();
    const conditions = [];
    const params = [];
    if (filter.channel_type) {
      conditions.push('channel_type = ?');
      params.push(filter.channel_type);
    }
    if (filter.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter.channel_id !== undefined) {
      conditions.push('channel_id = ?');
      params.push(filter.channel_id);
    }
    const where =
      conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    return db
      .prepare(
        `SELECT * FROM notification_logs ${where} ORDER BY created_at DESC, id DESC`
      )
      .all(...params);
  },
};

module.exports = notificationService;