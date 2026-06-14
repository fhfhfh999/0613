/**
 * 提醒服务
 * 管理提醒记录的 CRUD 与发送状态
 */

const { getDatabase } = require('../models/database');

const reminderService = {
  /**
   * 创建提醒记录
   */
  create(data) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO reminders
        (visit_id, subject_id, study_id, rule_id, reminder_type,
         reminder_date, content, status)
      VALUES
        (@visit_id, @subject_id, @study_id, @rule_id, @reminder_type,
         @reminder_date, @content, @status)
    `);
    const params = {
      visit_id: data.visit_id || null,
      subject_id: data.subject_id || null,
      study_id: data.study_id || null,
      rule_id: data.rule_id || null,
      reminder_type: data.reminder_type || '短信',
      reminder_date: data.reminder_date || null,
      content: data.content || '',
      status: data.status || '待发送',
    };
    const result = stmt.run(params);
    return this.getById(result.lastInsertRowid);
  },

  /**
   * 根据ID获取提醒
   */
  getById(id) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM reminders WHERE id = ?').get(id);
  },

  /**
   * 获取某随访下的所有提醒
   */
  getByVisitId(visitId) {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM reminders WHERE visit_id = ? ORDER BY id ASC')
      .all(visitId);
  },

  /**
   * 获取某受试者下的所有提醒
   */
  getBySubjectId(subjectId) {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM reminders WHERE subject_id = ? ORDER BY id ASC')
      .all(subjectId);
  },

  /**
   * 获取待发送提醒列表
   */
  getPendingReminders() {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT * FROM reminders
          WHERE status = '待发送'
          ORDER BY reminder_date ASC, id ASC`
      )
      .all();
  },

  /**
   * 按日期范围查询提醒
   */
  getByDateRange(startDate, endDate) {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT * FROM reminders
          WHERE reminder_date >= ? AND reminder_date <= ?
          ORDER BY reminder_date ASC, id ASC`
      )
      .all(startDate, endDate);
  },

  /**
   * 更新提醒
   */
  update(id, data) {
    const db = getDatabase();
    const current = this.getById(id);
    if (!current) return false;

    const merged = {
      reminder_type:
        data.reminder_type !== undefined ? data.reminder_type : current.reminder_type,
      reminder_date:
        data.reminder_date !== undefined ? data.reminder_date : current.reminder_date,
      content: data.content !== undefined ? data.content : current.content,
      status: data.status !== undefined ? data.status : current.status,
    };
    const result = db
      .prepare(
        `UPDATE reminders
           SET reminder_type = @reminder_type, reminder_date = @reminder_date,
               content = @content, status = @status,
               updated_at = datetime('now','localtime')
         WHERE id = @id`
      )
      .run({ ...merged, id });
    return result.changes > 0;
  },

  /**
   * 标记为已发送
   */
  markAsSent(id) {
    const db = getDatabase();
    const result = db
      .prepare(
        `UPDATE reminders
           SET status = '已发送', sent_at = datetime('now','localtime'),
               updated_at = datetime('now','localtime')
         WHERE id = ?`
      )
      .run(id);
    return result.changes > 0;
  },

  /**
   * 标记为发送失败
   */
  markAsFailed(id, reason) {
    const db = getDatabase();
    const result = db
      .prepare(
        `UPDATE reminders
           SET status = '发送失败', fail_reason = ?,
               updated_at = datetime('now','localtime')
         WHERE id = ?`
      )
      .run(reason || '', id);
    return result.changes > 0;
  },

  /**
   * 删除提醒
   */
  remove(id) {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
    return result.changes > 0;
  },

  /**
   * 取消受试者所有待发送提醒（脱落处理）
   * 业务规则：受试者若提前退出试验，停止所有后续提醒
   */
  cancelBySubject(subjectId, reason = '受试者脱落') {
    const db = getDatabase();
    const result = db
      .prepare(
        `UPDATE reminders
            SET status = '已取消', fail_reason = ?, updated_at = datetime('now','localtime')
          WHERE subject_id = ? AND status = '待发送'`
      )
      .run(reason, subjectId);
    return result.changes > 0;
  },

  // ============================================================
  // 每日提醒清单（需求 F3：今日/明日/本周待访视 + 超窗预警）
  // ============================================================

  /**
   * 内部方法：构建某日期范围内、含受试者/访视信息的待办访视清单
   *
   * 业务规则（设计文档 7.3）：
   * - 仅查询 status=pending/计划中 的访视
   * - 排除已脱落/完成 的受试者
   * - 参考日落在各访视窗口范围内时纳入
   * - 按 window_end 升序排序（紧急在前）
   * - 剩余天数 ≤ 2 标记 urgency=urgent（超窗预警标红）
   *
   * @param {string} startDate - 范围开始 'YYYY-MM-DD'
   * @param {string} endDate - 范围结束（可选）
   * @param {string} [referenceDate] - 参考日期（默认今天）
   * @returns {Array<Object>}
   */
  _buildDailyList(startDate, endDate, referenceDate, options = {}) {
    const db = getDatabase();
    const dateCalc = require('../utils/dateCalculator');
    const ref = referenceDate || new Date().toISOString().split('T')[0];

    // 排除脱落/完成受试者；仅未完成访视；窗口需与参考日/范围相关
    // F5 权限：支持按 study_id / assigned_user_id 过滤（CRC 仅看分配给自己的受试者）
    const conditions = [
      "s.status NOT IN ('脱落', '完成', 'withdrawn', 'completed')",
      "v.status IN ('计划中', 'pending', '已偏离', '已逾期')",
      'v.visit_window_end IS NOT NULL',
    ];
    const params = [];
    if (options.study_id !== undefined && options.study_id !== null) {
      conditions.push('v.study_id = ?');
      params.push(options.study_id);
    }
    if (
      options.assigned_user_id !== undefined &&
      options.assigned_user_id !== null
    ) {
      conditions.push('s.assigned_user_id = ?');
      params.push(options.assigned_user_id);
    }
    const visits = db
      .prepare(
        `SELECT v.*, s.subject_code, s.name AS subject_name, s.status AS subject_status
           FROM visits v
           JOIN subjects s ON v.subject_id = s.id
          WHERE ${conditions.join(' AND ')}
          ORDER BY v.visit_window_end ASC, v.id ASC`
      )
      .all(...params);

    const list = [];
    const rangeEnd = endDate || startDate;
    for (const v of visits) {
      // 窗口与查询范围重叠判定：只要访视窗口 [window_start, window_end]
      // 与查询范围 [startDate, rangeEnd] 有任意一天重叠即纳入。
      // 修复原逻辑仅比较 window_end 导致"窗口在范围内开始但结束于范围之后"
      // 的访视被错误遗漏的问题。
      const windowOverlapsRange =
        v.visit_window_start &&
        v.visit_window_end &&
        v.visit_window_start <= rangeEnd &&
        v.visit_window_end >= startDate;
      // 超窗预警：窗口截止日已过但仍未完成（参考日 > window_end）
      const overdueVisit = dateCalc.isOverdue(v.visit_window_end, ref);

      // 今日清单：参考日落在窗口内 OR 已超窗（超窗预警必须可见）
      // 范围清单：窗口与范围重叠 OR 已超窗（周清单需含未处理的超窗预警）
      if (!windowOverlapsRange && !overdueVisit) continue;

      const daysRemaining = dateCalc.daysUntilDeadline(v.visit_window_end, ref);
      const overdue = overdueVisit;
      const urgency = overdue ? 'overdue' : daysRemaining <= 2 ? 'urgent' : 'normal';

      list.push({
        subject_id: v.subject_id,
        subject_code: v.subject_code,
        name: v.subject_name,
        visit_id: v.id,
        visit_code: v.visit_code,
        visit_type: v.visit_type,
        planned_date: v.visit_date,
        window_start: v.visit_window_start,
        window_end: v.visit_window_end,
        days_remaining: daysRemaining,
        overdue,
        urgency,
        status: v.status,
      });
    }
    return list;
  },

  /**
   * 今日待访视清单
   * @param {string} [referenceDate]
   * @returns {{ date: string, reminders: Array<Object> }}
   */
  getTodayReminders(referenceDate, options = {}) {
    const ref = referenceDate || new Date().toISOString().split('T')[0];
    return {
      date: ref,
      reminders: this._buildDailyList(ref, ref, ref, options),
    };
  },

  /**
   * 明日待访视清单
   */
  getTomorrowReminders(referenceDate, options = {}) {
    const dateCalc = require('../utils/dateCalculator');
    const ref = referenceDate || new Date().toISOString().split('T')[0];
    const tomorrow = dateCalc.calculatePlannedDate(ref, 1);
    return {
      date: tomorrow,
      reminders: this._buildDailyList(tomorrow, tomorrow, ref, options),
    };
  },

  /**
   * 本周待访视清单（从参考日起 7 天）
   */
  getWeekReminders(referenceDate, options = {}) {
    const dateCalc = require('../utils/dateCalculator');
    const ref = referenceDate || new Date().toISOString().split('T')[0];
    const end = dateCalc.calculatePlannedDate(ref, 6);
    return {
      date: ref,
      reminders: this._buildDailyList(ref, end, ref, options),
    };
  },

  /**
   * 未来 N 天待访视清单
   */
  getUpcomingReminders(days = 7, referenceDate, options = {}) {
    const dateCalc = require('../utils/dateCalculator');
    const ref = referenceDate || new Date().toISOString().split('T')[0];
    const end = dateCalc.calculatePlannedDate(ref, days - 1);
    return {
      date: ref,
      reminders: this._buildDailyList(ref, end, ref, options),
    };
  },

  /**
   * 统计提醒发送情况（可按研究筛选）
   */
  getReminderStats(studyId) {
    const db = getDatabase();
    const baseWhere = studyId ? 'WHERE study_id = ?' : '';
    const params = studyId ? [studyId] : [];
    const totalRow = db
      .prepare(`SELECT COUNT(*) AS c FROM reminders ${baseWhere}`)
      .get(...params);
    const sentRow = db
      .prepare(
        `SELECT COUNT(*) AS c FROM reminders ${baseWhere} ${
          baseWhere ? 'AND' : 'WHERE'
        } status = '已发送'`
      )
      .get(...params);
    const pendingRow = db
      .prepare(
        `SELECT COUNT(*) AS c FROM reminders ${baseWhere} ${
          baseWhere ? 'AND' : 'WHERE'
        } status = '待发送'`
      )
      .get(...params);
    const failedRow = db
      .prepare(
        `SELECT COUNT(*) AS c FROM reminders ${baseWhere} ${
          baseWhere ? 'AND' : 'WHERE'
        } status = '发送失败'`
      )
      .get(...params);
    return {
      total: totalRow ? totalRow.c : 0,
      sent: sentRow ? sentRow.c : 0,
      pending: pendingRow ? pendingRow.c : 0,
      failed: failedRow ? failedRow.c : 0,
    };
  },
};

module.exports = reminderService;