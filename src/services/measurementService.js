/**
 * 测量数据服务
 * 处理体温/血压等测量数据的 CRUD 操作
 */

const { getDatabase } = require('../models/database');

const measurementService = {
  /**
   * 获取某次访视的所有测量数据
   * @param {number} visitId
   * @returns {Array}
   */
  getByVisitId(visitId) {
    const db = getDatabase();
    return db.prepare(`
      SELECT m.*, mt.type_name, mt.unit
      FROM measurements m
      JOIN measurement_types mt ON m.type_id = mt.id
      WHERE m.visit_id = ?
      ORDER BY mt.type_name
    `).all(visitId);
  },

  /**
   * 根据ID获取测量记录
   * @param {number} id
   * @returns {Object|undefined}
   */
  getById(id) {
    const db = getDatabase();
    return db.prepare(`
      SELECT m.*, mt.type_name, mt.unit
      FROM measurements m
      JOIN measurement_types mt ON m.type_id = mt.id
      WHERE m.id = ?
    `).get(id);
  },

  /**
   * 创建测量记录
   * @param {Object} data - { visit_id, type_id, value, measured_at }
   * @returns {Object}
   */
  create(data) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO measurements (visit_id, type_id, value, measured_at)
      VALUES (@visit_id, @type_id, @value, @measured_at)
    `);
    const result = stmt.run(data);
    return { id: result.lastInsertRowid, ...data };
  },

  /**
   * 更新测量记录
   * @param {number} id
   * @param {Object} data
   * @returns {boolean}
   */
  update(id, data) {
    const db = getDatabase();
    const result = db.prepare(`
      UPDATE measurements SET value = @value, measured_at = @measured_at,
        updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run({ ...data, id });
    return result.changes > 0;
  },

  /**
   * 删除测量记录
   * @param {number} id
   * @returns {boolean}
   */
  remove(id) {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM measurements WHERE id = ?').run(id);
    return result.changes > 0;
  },
};

module.exports = measurementService;