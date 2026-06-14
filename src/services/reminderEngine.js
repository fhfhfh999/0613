/**
 * 提醒引擎
 * 依据提醒规则与访视计划，生成、发送提醒，并统计执行摘要
 */

const { getDatabase } = require('../models/database');
const reminderRuleService = require('./reminderRuleService');
const reminderService = require('./reminderService');
const visitService = require('./visitService');
const subjectService = require('./subjectService');

const reminderEngine = {
  /**
   * 模板变量替换：将 {var} 替换为 data[var]；未匹配的变量保留原样
   * @param {string} template
   * @param {Object} data
   */
  renderTemplate(template, data = {}) {
    if (!template) return '';
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        return data[key];
      }
      return match;
    });
  },

  /**
   * 根据规则与访视生成提醒。
   *
   * 触发逻辑：
   * - 对于每条"已启用"的 before_visit 规则（提前 N 天），
   *   若某访视的 visit_date - 触发日期(reminder_date) == N，
   *   即 today == visit_date - N 天，则为该访视生成一条提醒。
   * - 跳过已完成/已取消的访视。
   * - 跳过该(规则,访视)已存在的提醒（幂等）。
   *
   * @param {string} [dateStr] 触发日期（默认今天）
   * @returns {Array<Object>} 新生成的提醒列表
   */
  generateReminders(dateStr) {
    const db = getDatabase();
    const today = dateStr || new Date().toISOString().split('T')[0];

    const rules = reminderRuleService.getEnabledRules();
    const generated = [];

    for (const rule of rules) {
      const offset = rule.trigger_offset_days || 0;
      // 命中该规则的访视日期 = today + offset
      const visitDate = new Date(today);
      visitDate.setDate(visitDate.getDate() + offset);
      const targetDate = visitDate.toISOString().split('T')[0];

      // 查找命中日期、且未完成的访视
      let visits = [];
      try {
        visits = db
          .prepare(
            `SELECT * FROM visits
              WHERE visit_date = ?
                AND status NOT IN ('已完成','已取消')`
          )
          .all(targetDate);
      } catch (e) {
        visits = [];
      }

      for (const visit of visits) {
        // 幂等：同规则+同访视+未发送 的提醒已存在则跳过
        const existing = db
          .prepare(
            `SELECT id FROM reminders
              WHERE rule_id = ? AND visit_id = ? LIMIT 1`
          )
          .get(rule.id, visit.id);
        if (existing) continue;

        const subject = visit.subject_id
          ? subjectService.getById(visit.subject_id)
          : null;

        const content = this.renderTemplate(rule.content_template, {
          name: subject ? subject.name : '',
          visit_date: visit.visit_date || '',
          visit_type: visit.visit_type || '',
          subject_code: subject ? subject.subject_code : '',
        });

        const reminderDate = today; // 提醒的发送日期 = 触发日（今天）
        const reminder = reminderService.create({
          visit_id: visit.id,
          subject_id: visit.subject_id,
          study_id:
            visit.study_id || (subject ? subject.study_id : undefined),
          rule_id: rule.id,
          reminder_type: rule.reminder_type,
          reminder_date: reminderDate,
          content,
          status: '待发送',
        });
        generated.push(reminder);
      }
    }

    return generated;
  },

  /**
   * 批量处理待发送提醒（模拟发送）
   * @returns {Promise<Array<{reminder_id, success, message}>>}
   */
  async processPendingReminders() {
    const pending = reminderService.getPendingReminders();
    const results = [];
    for (const reminder of pending) {
      // 模拟发送：成功
      try {
        reminderService.markAsSent(reminder.id);
        results.push({
          reminder_id: reminder.id,
          success: true,
          message: '已发送（模拟）',
        });
      } catch (e) {
        results.push({
          reminder_id: reminder.id,
          success: false,
          message: e.message,
        });
      }
    }
    return results;
  },

  /**
   * 获取提醒执行摘要
   */
  getExecutionSummary() {
    const db = getDatabase();
    const genRow = db
      .prepare(`SELECT COUNT(*) AS c FROM reminders`)
      .get();
    const sentRow = db
      .prepare(`SELECT COUNT(*) AS c FROM reminders WHERE status = '已发送'`)
      .get();
    const failedRow = db
      .prepare(
        `SELECT COUNT(*) AS c FROM reminders WHERE status = '发送失败'`
      )
      .get();
    return {
      total_generated: genRow ? genRow.c : 0,
      total_sent: sentRow ? sentRow.c : 0,
      total_failed: failedRow ? failedRow.c : 0,
    };
  },
};

module.exports = reminderEngine;