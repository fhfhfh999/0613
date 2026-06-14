/**
 * 提醒规则服务
 * 管理提醒规则（触发条件、模板等）
 */

const { getDatabase } = require('../models/database');

function normalizeRow(row) {
  if (!row) return row;
  const out = { ...row };
  if (out.enabled !== undefined && out.enabled !== null) {
    out.enabled = !!out.enabled || out.enabled === 1 || out.enabled === true;
  }
  return out;
}

const reminderRuleService = {
  /**
   * 获取研究下的所有提醒规则
   */
  getByStudyId(studyId) {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM reminder_rules WHERE study_id = ? ORDER BY id ASC')
      .all(studyId);
    return rows.map(normalizeRow);
  },

  /**
   * 获取所有已启用的规则
   */
  getEnabledRules() {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM reminder_rules WHERE enabled = 1 ORDER BY id ASC')
      .all();
    return rows.map(normalizeRow);
  },

  /**
   * 根据ID获取规则
   */
  getById(id) {
    const db = getDatabase();
    return normalizeRow(
      db.prepare('SELECT * FROM reminder_rules WHERE id = ?').get(id)
    );
  },

  /**
   * 创建提醒规则
   * @param {Object} data
   */
  create(data) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO reminder_rules
        (study_id, name, trigger_type, trigger_offset_days,
         reminder_type, content_template, enabled)
      VALUES
        (@study_id, @name, @trigger_type, @trigger_offset_days,
         @reminder_type, @content_template, @enabled)
    `);
    const enabledVal =
      data.enabled === false || data.enabled === 0 ? 0 : 1;
    const params = {
      study_id: data.study_id || null,
      name: data.name || '',
      trigger_type: data.trigger_type || 'before_visit',
      trigger_offset_days:
        data.trigger_offset_days !== undefined ? data.trigger_offset_days : 0,
      reminder_type: data.reminder_type || '短信',
      content_template: data.content_template || '',
      enabled: enabledVal,
    };
    const result = stmt.run(params);
    return this.getById(result.lastInsertRowid);
  },

  /**
   * 更新规则
   */
  update(id, data) {
    const db = getDatabase();
    const current = this.getById(id);
    if (!current) return false;

    const enabledVal =
      data.enabled === false || data.enabled === 0
        ? 0
        : data.enabled === true || data.enabled === 1
          ? 1
          : current.enabled
            ? 1
            : 0;

    const merged = {
      study_id:
        data.study_id !== undefined ? data.study_id : current.study_id,
      name: data.name !== undefined ? data.name : current.name,
      trigger_type:
        data.trigger_type !== undefined ? data.trigger_type : current.trigger_type,
      trigger_offset_days:
        data.trigger_offset_days !== undefined
          ? data.trigger_offset_days
          : current.trigger_offset_days,
      reminder_type:
        data.reminder_type !== undefined ? data.reminder_type : current.reminder_type,
      content_template:
        data.content_template !== undefined
          ? data.content_template
          : current.content_template,
      enabled: enabledVal,
    };
    const result = db
      .prepare(
        `UPDATE reminder_rules
           SET study_id = @study_id, name = @name, trigger_type = @trigger_type,
               trigger_offset_days = @trigger_offset_days,
               reminder_type = @reminder_type,
                content_template = @content_template, enabled = @enabled,
                updated_at = datetime('now','localtime')
         WHERE id = @id`
       )
       .run({ ...merged, id });
    return result.changes > 0;
  },

  /**
   * 删除规则
   */
  remove(id) {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM reminder_rules WHERE id = ?').run(id);
    return result.changes > 0;
  },
};

module.exports = reminderRuleService;