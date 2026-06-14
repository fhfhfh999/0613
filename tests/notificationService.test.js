/**
 * 通知渠道服务测试
 */

const { initDatabase, closeDatabase } = require('../src/models/database');
const notificationService = require('../src/services/notificationService');
const path = require('path');
const fs = require('fs');

describe('通知渠道服务', () => {
  const testDbPath = path.join(__dirname, 'test_notification.db');

  beforeAll(() => {
    process.env.TEST_DB_PATH = testDbPath;
    initDatabase();
  });

  afterAll(() => {
    closeDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  describe('短信通知', () => {
    test('应能配置短信通知渠道', () => {
      const config = {
        channel_type: 'sms',
        provider: 'aliyun',
        api_key: 'test_api_key',
        api_secret: 'test_api_secret',
        sign_name: '随访系统',
        template_code: 'SMS_001',
        enabled: true,
      };
      const result = notificationService.configureChannel(config);
      expect(result).toBeDefined();
      expect(result.channel_type).toBe('sms');
      expect(result.provider).toBe('aliyun');
      expect(result.id).toBeDefined();
    });

    test('应能获取已配置的通知渠道', () => {
      const channels = notificationService.getChannels();
      expect(Array.isArray(channels)).toBe(true);
      expect(channels.length).toBeGreaterThanOrEqual(1);
    });

    test('应能更新通知渠道配置', () => {
      const channels = notificationService.getChannels();
      const channelId = channels[0].id;
      notificationService.updateChannel(channelId, { sign_name: '临床随访' });
      const updated = notificationService.getChannelById(channelId);
      expect(updated.sign_name).toBe('临床随访');
    });

    test('应能测试通知渠道连通性', async () => {
      const channels = notificationService.getChannels();
      const channelId = channels[0].id;
      // 测试模式应返回模拟结果
      const result = await notificationService.testChannel(channelId, '13800138000');
      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('message');
    });
  });

  describe('邮件通知', () => {
    test('应能配置邮件通知渠道', () => {
      const config = {
        channel_type: 'email',
        smtp_host: 'smtp.example.com',
        smtp_port: 465,
        smtp_user: 'test@example.com',
        smtp_pass: 'test_password',
        from_name: '随访系统',
        use_ssl: true,
        enabled: true,
      };
      const result = notificationService.configureChannel(config);
      expect(result).toBeDefined();
      expect(result.channel_type).toBe('email');
      expect(result.smtp_host).toBe('smtp.example.com');
    });
  });

  describe('微信通知', () => {
    test('应能配置微信通知渠道', () => {
      const config = {
        channel_type: 'wechat',
        app_id: 'wx_test_app_id',
        app_secret: 'wx_test_app_secret',
        template_id: 'TEMPLATE_001',
        enabled: true,
      };
      const result = notificationService.configureChannel(config);
      expect(result).toBeDefined();
      expect(result.channel_type).toBe('wechat');
      expect(result.app_id).toBe('wx_test_app_id');
    });
  });

  describe('通知发送', () => {
    test('应能通过指定渠道发送通知', async () => {
      const config = {
        channel_type: 'sms',
        provider: 'test',
        api_key: 'key',
        api_secret: 'secret',
        sign_name: '测试',
        template_code: 'SMS_002',
        enabled: true,
      };
      const channel = notificationService.configureChannel(config);
      const result = await notificationService.sendNotification(channel.id, {
        to: '13800138000',
        content: '测试通知内容',
      });
      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
    });

    test('禁用的渠道不应发送通知', async () => {
      const config = {
        channel_type: 'sms',
        provider: 'test',
        api_key: 'key',
        api_secret: 'secret',
        sign_name: '测试',
        template_code: 'SMS_003',
        enabled: false,
      };
      const channel = notificationService.configureChannel(config);
      const result = await notificationService.sendNotification(channel.id, {
        to: '13800138000',
        content: '不应发送的通知',
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain('禁用');
    });

    test('应能删除通知渠道', () => {
      const config = {
        channel_type: 'sms',
        provider: 'test_delete',
        enabled: true,
      };
      const channel = notificationService.configureChannel(config);
      expect(notificationService.removeChannel(channel.id)).toBe(true);
      expect(notificationService.getChannelById(channel.id)).toBeUndefined();
    });
  });

  describe('通知日志', () => {
    test('应能记录通知发送日志', () => {
      const log = notificationService.createLog({
        channel_type: 'sms',
        recipient: '13800138000',
        content: '测试日志',
        status: 'success',
        response: '{"code": "OK"}',
      });
      expect(log).toBeDefined();
      expect(log.channel_type).toBe('sms');
      expect(log.status).toBe('success');
    });

    test('应能查询通知日志', () => {
      notificationService.createLog({
        channel_type: 'email',
        recipient: 'test@example.com',
        content: '邮件日志',
        status: 'success',
      });
      const logs = notificationService.getLogs({ channel_type: 'email' });
      expect(Array.isArray(logs)).toBe(true);
      expect(logs.length).toBeGreaterThanOrEqual(1);
      logs.forEach(l => expect(l.channel_type).toBe('email'));
    });
  });
});
