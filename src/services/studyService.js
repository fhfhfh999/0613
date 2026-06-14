/**
 * 研究项目服务
 * 处理研究项目的 CRUD 操作
 */

const { getDatabase } = require('../models/database');

const studyService = {
  /**
   * 获取所有研究项目
   * @param {Object} [options] - { status } 可选状态筛选
   * @returns {Array}
   */
  getAll(options = {}) {
    const db = getDatabase();
    if (options.status) {
      return db
        .prepare('SELECT * FROM studies WHERE status = ? ORDER BY created_at DESC')
        .all(options.status);
    }
    return db.prepare('SELECT * FROM studies ORDER BY created_at DESC').all();
  },

  /**
   * 根据ID获取研究项目
   */
  getById(id) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM studies WHERE id = ?').get(id);
  },

  /**
   * 根据研究代码获取研究项目
   */
  getByCode(studyCode) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM studies WHERE study_code = ?').get(studyCode);
  },

  /**
   * 创建研究项目
   * @param {Object} data - { study_code, study_name, description?, status? }
   */
  create(data) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO studies (study_code, study_name, description, status)
      VALUES (@study_code, @study_name, @description, @status)
    `);
    const params = {
      study_code: data.study_code,
      study_name: data.study_name,
      description: data.description || '',
      status: data.status || '进行中',
    };
    const result = stmt.run(params);
    return this.getById(result.lastInsertRowid);
  },

  /**
   * 更新研究项目
   */
  update(id, data) {
    const db = getDatabase();
    const current = this.getById(id);
    if (!current) return false;

    const merged = {
      study_code: data.study_code !== undefined ? data.study_code : current.study_code,
      study_name:
        data.study_name !== undefined ? data.study_name : current.study_name,
      description:
        data.description !== undefined ? data.description : current.description,
      status: data.status !== undefined ? data.status : current.status,
    };
    const result = db
      .prepare(
        `UPDATE studies
           SET study_code = @study_code, study_name = @study_name,
               description = @description, status = @status,
               updated_at = datetime('now','localtime')
         WHERE id = @id`
       )
       .run({ ...merged, id });
    return result.changes > 0;
  },

  /**
   * 删除研究项目
   */
  remove(id) {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM studies WHERE id = ?').run(id);
    return result.changes > 0;
  },

  /**
   * 关键字搜索（按研究名称或研究代码）
   */
  search(keyword) {
    const db = getDatabase();
    const like = `%${keyword}%`;
    return db
      .prepare(
        `SELECT * FROM studies
          WHERE study_name LIKE ? OR study_code LIKE ?
          ORDER BY created_at DESC`
      )
      .all(like, like);
  },
};

module.exports = studyService;