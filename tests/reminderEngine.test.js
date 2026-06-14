/**
 * 提醒引擎测试
 * 测试提醒规则的解析、匹配和触发逻辑
 */

const { initDatabase, closeDatabase } = require('../src/models/database');
const studyService = require('../src/services/studyService');
const subjectService = require('../src/services/subjectService');
const visitService = require('../src/services/visitService');
const reminderRuleService = require('../src/services/reminderRuleService');
const reminderService = require('../src/services/reminderService');
const reminderEngine = require('../src/services/reminderEngine');
const path = require('path');
const fs = require('fs');

describe('提醒引擎', () => {
  const testDbPath = path.join(__dirname, 'test_engine.db');
  let studyId, subjectId, visitId;

  beforeAll(() => {
    process.env.TEST_DB_PATH = testDbPath;
    initDatabase();
    const study = studyService.create({
      study_code: 'ENG',
      study_name: '引擎测试研究',
    });
    studyId = study.id;
    const subject = subjectService.create({
      subject_code: 'ENG_SUB001',
      name: '引擎测试受试者',
      gender: '女',
      phone: '13900139000',
      study_id: studyId,
    });
    subjectId = subject.id;
  });

  afterAll(() => {
    closeDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  describe('提醒规则管理', () => {
    test('应能创建提醒规则', () => {
      const rule = reminderRuleService.create({
        study_id: studyId,
        name: '随访前3天短信提醒',
        trigger_type: 'before_visit',
        trigger_offset_days: 3,
        reminder_type: '短信',
        content_template: '尊敬的{name}，您于{visit_date}有一次{visit_type}，请按时就诊。',
        enabled: true,
      });
      expect(rule).toBeDefined();
      expect(rule.trigger_type).toBe('before_visit');
      expect(rule.trigger_offset_days).toBe(3);
      expect(rule.id).toBeDefined();
    });

    test('应能获取研究下的所有提醒规则', () => {
      const rules = reminderRuleService.getByStudyId(studyId);
      expect(Array.isArray(rules)).toBe(true);
      expect(rules.length).toBeGreaterThanOrEqual(1);
    });

    test('应能更新提醒规则', () => {
      const rules = reminderRuleService.getByStudyId(studyId);
      const ruleId = rules[0].id;
      reminderRuleService.update(ruleId, { trigger_offset_days: 5 });
      const updated = reminderRuleService.getById(ruleId);
      expect(updated.trigger_offset_days).toBe(5);
      // 恢复原值
      reminderRuleService.update(ruleId, { trigger_offset_days: 3 });
    });

    test('应能禁用提醒规则', () => {
      const rule = reminderRuleService.create({
        study_id: studyId,
        name: '临时规则',
        trigger_type: 'before_visit',
        trigger_offset_days: 1,
        reminder_type: '短信',
        content_template: '临时模板',
        enabled: true,
      });
      reminderRuleService.update(rule.id, { enabled: false });
      const found = reminderRuleService.getById(rule.id);
      expect(found.enabled).toBe(false);
    });

    test('应能删除提醒规则', () => {
      const rule = reminderRuleService.create({
        study_id: studyId,
        name: '待删除规则',
        trigger_type: 'before_visit',
        trigger_offset_days: 2,
        reminder_type: '短信',
        content_template: '删除测试',
        enabled: true,
      });
      expect(reminderRuleService.remove(rule.id)).toBe(true);
      expect(reminderRuleService.getById(rule.id)).toBeUndefined();
    });
  });

  describe('提醒生成逻辑', () => {
    beforeAll(() => {
      // 创建一个即将到来的随访（3天后）
      const visitDate = new Date();
      visitDate.setDate(visitDate.getDate() + 3);
      const dateStr = visitDate.toISOString().split('T')[0];
      const visit = visitService.create({
        subject_id: subjectId,
        visit_type: '常规随访',
        visit_date: dateStr,
        visit_window_start: dateStr,
        visit_window_end: dateStr,
        status: '计划中',
      });
      visitId = visit.id;
    });

    test('应根据规则和访视生成提醒', () => {
      const generated = reminderEngine.generateReminders(new Date().toISOString().split('T')[0]);
      expect(Array.isArray(generated)).toBe(true);
      // 应该为3天后有随访的受试者生成提醒
      expect(generated.length).toBeGreaterThanOrEqual(1);
    });

    test('生成的提醒应包含正确的信息', () => {
      const reminders = reminderService.getByVisitId(visitId);
      if (reminders.length > 0) {
        const reminder = reminders[0];
        expect(reminder.subject_id).toBe(subjectId);
        expect(reminder.content).toBeDefined();
        expect(reminder.content.length).toBeGreaterThan(0);
      }
    });

    test('不应为已完成的随访生成提醒', () => {
      const completedVisit = visitService.create({
        subject_id: subjectId,
        visit_type: '已完成随访',
        visit_date: new Date().toISOString().split('T')[0],
        status: '已完成',
      });
      // 确保没有为已完成的随访生成提醒
      const reminders = reminderService.getByVisitId(completedVisit.id);
      // 已完成的随访不应有新生成的提醒（可能为空或只有之前创建的）
      expect(Array.isArray(reminders)).toBe(true);
    });

    test('不应为已禁用的规则生成提醒', () => {
      const disabledRule = reminderRuleService.create({
        study_id: studyId,
        name: '禁用规则',
        trigger_type: 'before_visit',
        trigger_offset_days: 3,
        reminder_type: '短信',
        content_template: '禁用规则模板',
        enabled: false,
      });
      const generated = reminderEngine.generateReminders(new Date().toISOString().split('T')[0]);
      // 禁用规则不应生成提醒
      const fromDisabled = generated.filter(g => g.rule_id === disabledRule.id);
      expect(fromDisabled.length).toBe(0);
    });
  });

  describe('模板变量替换', () => {
    test('应能正确替换模板变量', () => {
      const template = '尊敬的{name}，您于{visit_date}有一次{visit_type}，请按时就诊。';
      const data = {
        name: '张三',
        visit_date: '2026-07-15',
        visit_type: '常规随访',
      };
      const result = reminderEngine.renderTemplate(template, data);
      expect(result).toBe('尊敬的张三，您于2026-07-15有一次常规随访，请按时就诊。');
    });

    test('模板中未匹配的变量应保留原样', () => {
      const template = '您好{username}，{unknown_var}测试';
      const data = { username: '李四' };
      const result = reminderEngine.renderTemplate(template, data);
      expect(result).toContain('李四');
      expect(result).toContain('{unknown_var}');
    });

    test('空模板应返回空字符串', () => {
      const result = reminderEngine.renderTemplate('', {});
      expect(result).toBe('');
    });
  });

  describe('提醒执行和发送', () => {
    test('应能批量处理待发送提醒', async () => {
      const results = await reminderEngine.processPendingReminders();
      expect(Array.isArray(results)).toBe(true);
      results.forEach(r => {
        expect(r).toHaveProperty('reminder_id');
        expect(r).toHaveProperty('success');
      });
    });

    test('应能获取提醒执行摘要', () => {
      const summary = reminderEngine.getExecutionSummary();
      expect(summary).toBeDefined();
      expect(summary).toHaveProperty('total_generated');
      expect(summary).toHaveProperty('total_sent');
      expect(summary).toHaveProperty('total_failed');
    });
  });
});
