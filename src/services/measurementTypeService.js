/**
 * 测量类型服务
 * 处理测量类型（体温、收缩压、舒张压等）的 CRUD 操作
 */

const { getDatabase } = require('../models/database');

const measurementTypeService = {
  /**
   * 获取所有测量类型
   * @returns {Array}
   */
  getAll() {
    const db = getDatabase();
    return db.prepare('SELECT * FROM measurement_types ORDER BY type_name').all();
  },

  /**
   * 根据ID获取测量类型
   * @param {number} id
   * @returns {Object|undefined}
   */
  getById(id) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM measurement_types WHERE id = ?').get(id);
  },

  /**
   * 创建测量类型
   * @param {Object} data - { type_name, unit, normal_min, normal_max }
   * @returns {Object}
   */
  create(data) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO measurement_types (type_name, unit, normal_min, normal_max)
      VALUES (@type_name, @unit, @normal_min, @normal_max)
    `);
    const result = stmt.run(data);
    return { id: result.lastInsertRowid, ...data };
  },

  /**
   * 更新测量类型
   * @param {number} id
   * @param {Object} data
   * @returns {boolean}
   */
  update(id, data) {
    const db = getDatabase();
    const result = db.prepare(`
      UPDATE measurement_types SET type_name = @type_name, unit = @unit,
        normal_min = @normal_min, normal_max = @normal_max
      WHERE id = ?
    `).run({ ...data, id });
    return result.changes > 0;
  },

  /**
   * 删除测量类型
   * @param {number} id
   * @returns {boolean}
   */
  remove(id) {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM measurement_types WHERE id = ?').run(id);
    return result.changes > 0;
  },
};

module.exports = measurementTypeService;