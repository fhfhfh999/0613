/**
 * 方案偏离服务
 * 自动检测超出窗口期的访视、记录与汇总报表
 *
 * 业务规则（需求 F4 / 设计文档 2.2.2）：
 * - 若超出窗口期未完成访视，标记为"方案偏离"
 * - 提供偏离汇总报表供机构质控使用
 */

const { getDatabase } = require('../models/database');
const dateCalc = require('../utils/dateCalculator');

const deviationService = {
  /**
   * 创建偏离记录
   * @param {Object} data
   */
  create(data) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO deviations
        (subject_id, visit_id, deviation_type, deviation_date, description, status)
      VALUES
        (@subject_id, @visit_id, @deviation_type, @deviation_date, @description, @status)
    `);
    const params = {
      subject_id: data.subject_id || null,
      visit_id: data.visit_id || null,
      deviation_type: data.deviation_type || 'window_exceeded',
      deviation_date:
        data.deviation_date || new Date().toISOString().split('T')[0],
      description: data.description || '',
      status: data.status || 'open',
    };
    const result = stmt.run(params);
    return this.getById(result.lastInsertRowid);
  },

  /**
   * 根据ID获取偏离记录
   */
  getById(id) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM deviations WHERE id = ?').get(id);
  },

  /**
   * 按受试者查询偏离记录
   */
  getBySubjectId(subjectId) {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT * FROM deviations WHERE subject_id = ? ORDER BY deviation_date DESC, id DESC`
      )
      .all(subjectId);
  },

  /**
   * 获取所有偏离记录（含关联信息）
   * @param {Object} [filter] - { study_id, subject_id, visit_id, status, deviation_type, assigned_user_id }
   */
  getList(filter = {}) {
    const db = getDatabase();
    const conditions = [];
    const params = [];
    if (filter.study_id !== undefined && filter.study_id !== null) {
      conditions.push('s.study_id = ?');
      params.push(filter.study_id);
    }
    if (filter.subject_id !== undefined) {
      conditions.push('d.subject_id = ?');
      params.push(filter.subject_id);
    }
    if (filter.visit_id !== undefined) {
      conditions.push('d.visit_id = ?');
      params.push(filter.visit_id);
    }
    if (filter.assigned_user_id !== undefined && filter.assigned_user_id !== null) {
      conditions.push('s.assigned_user_id = ?');
      params.push(filter.assigned_user_id);
    }
    if (filter.status) {
      conditions.push('d.status = ?');
      params.push(filter.status);
    }
    if (filter.deviation_type) {
      conditions.push('d.deviation_type = ?');
      params.push(filter.deviation_type);
    }
    const where =
      conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    return db
      .prepare(
        `SELECT d.*, s.subject_code, s.name AS subject_name,
                v.visit_code, v.visit_type
           FROM deviations d
           LEFT JOIN subjects s ON d.subject_id = s.id
           LEFT JOIN visits v ON d.visit_id = v.id
          ${where}
          ORDER BY d.deviation_date DESC, d.id DESC`
      )
      .all(...params);
  },

  /**
   * 判断某访视是否已存在偏离记录（避免重复生成）
   */
  existsForVisit(visitId) {
    const db = getDatabase();
    const row = db
      .prepare('SELECT COUNT(*) AS c FROM deviations WHERE visit_id = ?')
      .get(visitId);
    return row ? row.c > 0 : false;
  },

  /**
   * 对单个访视检测是否超窗并生成偏离记录
   *
   * 判定：访视状态非"已完成"/"已取消"，且 visit_window_end < referenceDate
   *
   * @param {Object} visit - 含 id/visit_code/visit_window_end/status 等
   * @param {string} [referenceDate] - 参考日期（默认今天）
   * @returns {Object|null} 生成的偏离记录，或 null（未超窗/已存在）
   */
  detectForVisit(visit, referenceDate) {
    if (!visit) return null;
    // 已完成/已取消的访视不再判超窗
    if (['已完成', '已取消', 'completed', 'cancelled'].includes(visit.status)) {
      return null;
    }
    if (!visit.visit_window_end) return null;
    // 已有偏离记录则跳过
    if (visit.id && this.existsForVisit(visit.id)) return null;

    const ref = referenceDate || new Date().toISOString().split('T')[0];
    if (!dateCalc.isOverdue(visit.visit_window_end, ref)) return null;

    return this.create({
      subject_id: visit.subject_id,
      visit_id: visit.id,
      deviation_type: 'window_exceeded',
      deviation_date: ref,
      description: `访视【${visit.visit_code || visit.visit_type || ''}】超出窗口期（截止日 ${visit.visit_window_end}）`,
      status: 'open',
    });
  },

  /**
   * 批量自动检测方案偏离
   * @param {Object} [options] - { referenceDate }
   * @returns {{ detected: number, records: Array<Object> }}
   */
  autoDetectDeviations(options = {}) {
    const db = getDatabase();
    const ref = options.referenceDate || new Date().toISOString().split('T')[0];
    // 查询所有未完成且未取消的访视
    const visits = db
      .prepare(
        `SELECT * FROM visits
          WHERE visit_window_end IS NOT NULL
            AND status NOT IN ('已完成','已取消','completed','cancelled')
          ORDER BY visit_window_end ASC`
      )
      .all();
    const records = [];
    for (const v of visits) {
      const rec = this.detectForVisit(v, ref);
      if (rec) records.push(rec);
    }
    return { detected: records.length, records };
  },

  /**
   * 获取偏离汇总报表
   * @returns {{ total: number, byType: Object, byStatus: Object, byStudy: Array }}
   */
  getSummary() {
    const db = getDatabase();
    const totalRow = db.prepare('SELECT COUNT(*) AS c FROM deviations').get();
    const total = totalRow ? totalRow.c : 0;

    const byTypeRows = db
      .prepare(
        `SELECT deviation_type, COUNT(*) AS c FROM deviations GROUP BY deviation_type`
      )
      .all();
    const byType = byTypeRows.reduce((acc, r) => {
      acc[r.deviation_type] = r.c;
      return acc;
    }, {});

    const byStatusRows = db
      .prepare(`SELECT status, COUNT(*) AS c FROM deviations GROUP BY status`)
      .all();
    const byStatus = byStatusRows.reduce((acc, r) => {
      acc[r.status] = r.c;
      return acc;
    }, {});

    const byStudyRows = db
      .prepare(
        `SELECT s.study_id, st.study_name, COUNT(*) AS c
           FROM deviations d
           LEFT JOIN subjects s ON d.subject_id = s.id
           LEFT JOIN studies st ON s.study_id = st.id
          GROUP BY s.study_id
          ORDER BY c DESC`
      )
      .all();

    return { total, byType, byStatus, byStudy: byStudyRows };
  },

  /**
   * 删除偏离记录
   */
  remove(id) {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM deviations WHERE id = ?').run(id);
    return result.changes > 0;
  },
};

module.exports = deviationService;