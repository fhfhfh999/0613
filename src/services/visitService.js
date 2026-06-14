/**
 * 随访服务
 * 处理访视记录的 CRUD 及查询操作（含 F6 日历视图按日期范围查询）
 */

const { getDatabase } = require('../models/database');
const subjectService = require('./subjectService');
const dateCalc = require('../utils/dateCalculator');
const { getVisitPlanTemplate, getByType, getLastOrder, getVisitName } = require('../models/visitPlan');
const deviationService = require('./deviationService');

const visitService = {
  /**
   * 获取某受试者的所有随访
   * @param {number} subjectId
   * @param {Object} [options] - { status } 可选状态筛选
   */
  getBySubjectId(subjectId, options = {}) {
    const db = getDatabase();
    if (options.status) {
      return db
        .prepare(
          `SELECT * FROM visits
            WHERE subject_id = ? AND status = ?
            ORDER BY visit_date ASC`
        )
        .all(subjectId, options.status);
    }
    return db
      .prepare('SELECT * FROM visits WHERE subject_id = ? ORDER BY visit_date ASC')
      .all(subjectId);
  },

  /**
   * 根据ID获取随访记录
   */
  getById(id) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM visits WHERE id = ?').get(id);
  },

  /**
   * 获取某研究的所有随访
   * @param {Object} [options] - { assigned_user_id } 可选权限过滤（CRC 仅看分配给自己的受试者的访视）
   */
  getByStudyId(studyId, options = {}) {
    const db = getDatabase();
    if (options.assigned_user_id !== undefined && options.assigned_user_id !== null) {
      return db
        .prepare(
          `SELECT v.* FROM visits v
            LEFT JOIN subjects s ON v.subject_id = s.id
           WHERE v.study_id = ? AND s.assigned_user_id = ?
           ORDER BY v.visit_date ASC`
        )
        .all(studyId, options.assigned_user_id);
    }
    return db
      .prepare('SELECT * FROM visits WHERE study_id = ? ORDER BY visit_date ASC')
      .all(studyId);
  },

  /**
   * F6：按日期范围查询访视（日历视图）
   * @param {Object} params - { start_date, end_date, study_id?, assigned_user_id? }
   * @returns {Array<Object>} 含受试者编号/姓名/研究代码的访视列表
   */
  getByDateRange({ start_date, end_date, study_id, assigned_user_id } = {}) {
    const db = getDatabase();
    const conditions = [
      'v.visit_date IS NOT NULL',
      'v.visit_date >= @start_date',
      'v.visit_date <= @end_date',
    ];
    const params = { start_date, end_date };
    if (study_id !== undefined && study_id !== null && study_id !== '') {
      conditions.push('v.study_id = @study_id');
      params.study_id = study_id;
    }
    if (assigned_user_id !== undefined && assigned_user_id !== null) {
      conditions.push('s.assigned_user_id = @assigned_user_id');
      params.assigned_user_id = assigned_user_id;
    }
    return db
      .prepare(
        `SELECT v.*, s.subject_code, s.name AS subject_name, s.assigned_user_id,
                st.study_code, st.study_name
           FROM visits v
           LEFT JOIN subjects s ON v.subject_id = s.id
           LEFT JOIN studies st ON v.study_id = st.id
          WHERE ${conditions.join(' AND ')}
          ORDER BY v.visit_date ASC, s.subject_code ASC`
      )
      .all(params);
  },

  /**
   * 创建随访记录
   * @param {Object} data
   */
  create(data) {
    const db = getDatabase();

    // 自动补全 study_id（从受试者关联研究）
    let studyId = data.study_id;
    if (studyId === undefined && data.subject_id) {
      const subject = subjectService.getById(data.subject_id);
      if (subject) studyId = subject.study_id;
    }

    const stmt = db.prepare(`
      INSERT INTO visits
        (subject_id, study_id, visit_code, visit_type, visit_date,
         visit_window_start, visit_window_end, actual_date, status, notes)
      VALUES
        (@subject_id, @study_id, @visit_code, @visit_type, @visit_date,
         @visit_window_start, @visit_window_end, @actual_date, @status, @notes)
    `);
    const params = {
      subject_id: data.subject_id,
      study_id: studyId !== undefined ? studyId : null,
      visit_code: data.visit_code || '',
      visit_type: data.visit_type || '',
      visit_date: data.visit_date || null,
      visit_window_start: data.visit_window_start || null,
      visit_window_end: data.visit_window_end || null,
      actual_date: data.actual_date || null,
      status: data.status || '计划中',
      notes: data.notes || '',
    };
    const result = stmt.run(params);
    return this.getById(result.lastInsertRowid);
  },

  /**
   * 更新随访记录
   */
  update(id, data) {
    const db = getDatabase();
    const current = this.getById(id);
    if (!current) return false;

    const merged = {
      subject_id:
        data.subject_id !== undefined ? data.subject_id : current.subject_id,
      study_id: data.study_id !== undefined ? data.study_id : current.study_id,
      visit_code:
        data.visit_code !== undefined ? data.visit_code : current.visit_code,
      visit_type:
        data.visit_type !== undefined ? data.visit_type : current.visit_type,
      visit_date:
        data.visit_date !== undefined ? data.visit_date : current.visit_date,
      visit_window_start:
        data.visit_window_start !== undefined
          ? data.visit_window_start
          : current.visit_window_start,
      visit_window_end:
        data.visit_window_end !== undefined
          ? data.visit_window_end
          : current.visit_window_end,
      actual_date:
        data.actual_date !== undefined ? data.actual_date : current.actual_date,
      status: data.status !== undefined ? data.status : current.status,
      notes: data.notes !== undefined ? data.notes : current.notes,
    };
    const result = db
      .prepare(
        `UPDATE visits
           SET subject_id = @subject_id, study_id = @study_id,
               visit_code = @visit_code, visit_type = @visit_type,
               visit_date = @visit_date, visit_window_start = @visit_window_start,
               visit_window_end = @visit_window_end, actual_date = @actual_date,
               status = @status, notes = @notes,
               updated_at = datetime('now','localtime')
         WHERE id = @id`
       )
       .run({ ...merged, id });
    return result.changes > 0;
  },

  /**
   * 删除随访记录
   */
  remove(id) {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM visits WHERE id = ?').run(id);
    return result.changes > 0;
  },

  /**
   * 批量创建随访计划
   * @param {number} subjectId
   * @param {Array<Object>} plan
   */
  batchCreate(subjectId, plan) {
    const results = [];
    for (const item of plan) {
      results.push(this.create({ ...item, subject_id: subjectId }));
    }
    return results;
  },

  /**
   * 获取即将到来的随访（未来 N 天内、未完成）
   * @param {number} studyId
   * @param {number} days
   */
  getUpcoming(studyId, days = 7) {
    const db = getDatabase();
    const today = new Date().toISOString().split('T')[0];
    const future = new Date();
    future.setDate(future.getDate() + days);
    const futureStr = future.toISOString().split('T')[0];
    return db
      .prepare(
        `SELECT v.*, s.subject_code, s.name AS subject_name
           FROM visits v LEFT JOIN subjects s ON v.subject_id = s.id
          WHERE (v.study_id = ? OR ? IS NULL)
            AND v.visit_date IS NOT NULL
            AND v.visit_date >= ?
            AND v.visit_date <= ?
            AND v.status NOT IN ('已完成','已取消')
          ORDER BY v.visit_date ASC`
      )
      .all(studyId, studyId, today, futureStr);
  },

  // ============================================================
  // 核心业务逻辑（需求 F2：访视计划自动生成 + 实际日期回填重算）
  // ============================================================

  /**
   * 根据入组日期生成完整访视计划并批量入库
   *
   * @param {number} subjectId - 受试者ID
   * @param {string} enrollmentDate - 入组日期 'YYYY-MM-DD'
   * @returns {Array<Object>} 生成的访视记录数组
   */
  generateVisitPlanForSubject(subjectId, enrollmentDate) {
    if (!subjectService.getById(subjectId)) {
      throw new Error(`受试者不存在: ${subjectId}`);
    }
    const plan = dateCalc.generateVisitPlan(enrollmentDate);
    return this.batchCreate(
      subjectId,
      plan.map((item) => ({
        visit_code: item.type,
        visit_type: item.name,
        visit_date: item.planned_date,
        visit_window_start: item.window_start,
        visit_window_end: item.window_end,
        status: '计划中',
      }))
    );
  },

  /**
   * 回填实际访视日期
   *
   * 业务逻辑（设计文档 7.2）：
   * 1. 检查实际日期是否在窗口期内
   *    - 超窗：标记为"已偏离"，生成偏离记录
   *    - 在窗：标记为"已完成"
   * 2. 以实际日期为新基准，重算后续所有"计划中"访视的计划日期与窗口
   * 3. 若为最后一个访视且已完成，更新受试者状态为"完成"
   *
   * @param {number} visitId - 访视ID
   * @param {string} actualDate - 实际访视日期 'YYYY-MM-DD'
   * @returns {{ visit: Object, deviation: Object|null, recalculated: number, subjectCompleted: boolean }}
   */
  fillActualDate(visitId, actualDate) {
    const visit = this.getById(visitId);
    if (!visit) throw new Error(`访视记录不存在: ${visitId}`);
    if (!dateCalc.isValidDate(actualDate)) {
      throw new Error(`无效实际日期: ${actualDate}`);
    }

    // 1. 判断是否超窗
    const inWindow = visit.visit_window_start && visit.visit_window_end
      ? dateCalc.isDateInWindow(
          actualDate,
          visit.visit_window_start,
          visit.visit_window_end
        )
      : true;
    const newStatus = inWindow ? '已完成' : '已偏离';

    // 写入实际日期与状态：
    // - actual_date 存入结构化字段，便于后续查询/统计
    // - notes 追加文本记录，保持可读审计痕迹
    this.update(visitId, {
      status: newStatus,
      actual_date: actualDate,
      notes: visit.notes
        ? `${visit.notes}\n实际访视日期: ${actualDate}`
        : `实际访视日期: ${actualDate}`,
    });

    // 超窗则生成偏离记录
    let deviation = null;
    if (!inWindow) {
      deviation = deviationService.create({
        subject_id: visit.subject_id,
        visit_id: visit.id,
        deviation_type: 'window_exceeded',
        deviation_date: actualDate,
        description: `访视【${visit.visit_code || visit.visit_type || ''}】实际日期 ${actualDate} 超出窗口期 [${visit.visit_window_start}, ${visit.visit_window_end}]`,
        status: 'open',
      });
    }

    // 2. 重算后续"计划中"访视
    const subsequent = this._recalculateSubsequent(
      visit.subject_id,
      visit.visit_code,
      actualDate
    );

    // 3. 若为最后一个访视且已完成，更新受试者状态
    let subjectCompleted = false;
    const template = getVisitPlanTemplate();
    const lastType = template[template.length - 1].type;
    if (
      (visit.visit_code === lastType || visit.visit_type === getVisitName(lastType)) &&
      inWindow
    ) {
      subjectService.updateStatus(visit.subject_id, '完成');
      subjectCompleted = true;
    }

    return {
      visit: this.getById(visitId),
      deviation,
      recalculated: subsequent,
      subjectCompleted,
    };
  },

  /**
   * 从指定访视开始重算后续所有"计划中"访视
   * @param {number} subjectId
   * @param {string} fromVisitCode - 起始访视类型（不含该项，从其下一项开始重算）
   * @param {string} newBaseDate - 新基准日期（通常为前一访视的实际日期）
   * @returns {number} 重算的访视数量
   */
  _recalculateSubsequent(subjectId, fromVisitCode, newBaseDate) {
    const template = getVisitPlanTemplate();
    const fromIdx = template.findIndex((t) => t.type === fromVisitCode);
    if (fromIdx === -1) return 0;

    // 从下一项开始重算
    let count = 0;
    let prevPlanned = newBaseDate;
    for (let i = fromIdx + 1; i < template.length; i++) {
      const tpl = template[i];
      // 仅重算"计划中"的访视（已完成/已偏离的保持不变）
      const existing = getDatabase()
        .prepare(
          'SELECT * FROM visits WHERE subject_id = ? AND visit_code = ?'
        )
        .get(subjectId, tpl.type);
      if (!existing) continue;
      if (existing.status !== '计划中' && existing.status !== 'pending') continue;

      const planned = dateCalc.calculatePlannedDate(prevPlanned, tpl.offsetDays);
      const win = dateCalc.calculateWindowDates(planned, tpl.windowDays);
      this.update(existing.id, {
        visit_date: planned,
        visit_window_start: win.window_start,
        visit_window_end: win.window_end,
      });
      prevPlanned = planned;
      count++;
    }
    return count;
  },

  /**
   * 批量检查并标记方案偏离（委托给 deviationService）
   * @param {string} [referenceDate]
   * @returns {{ detected: number, records: Array<Object> }}
   */
  checkAndMarkDeviations(referenceDate) {
    return deviationService.autoDetectDeviations({ referenceDate });
  },
};

module.exports = visitService;