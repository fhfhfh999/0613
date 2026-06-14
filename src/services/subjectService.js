/**
 * 受试者服务
 * 处理受试者信息的 CRUD 操作（含 F5 权限过滤字段 assigned_user_id）
 */

const { getDatabase } = require('../models/database');

const subjectService = {
  /**
   * 获取某研究下所有受试者
   * @param {number} studyId
   * @param {Object} [options] - { status, assigned_user_id } 可选筛选；
   *        当 assigned_user_id 存在时按权限过滤（CRC 仅看分配给自己的受试者）
   */
  getByStudyId(studyId, options = {}) {
    const db = getDatabase();
    const conditions = ['study_id = ?'];
    const params = [studyId];
    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }
    // 权限过滤：CRC 只能看 assigned_user_id = 自己
    if (options.assigned_user_id !== undefined && options.assigned_user_id !== null) {
      conditions.push('assigned_user_id = ?');
      params.push(options.assigned_user_id);
    }
    return db
      .prepare(
        `SELECT * FROM subjects WHERE ${conditions.join(' AND ')} ORDER BY subject_code ASC`
      )
      .all(...params);
  },

  /**
   * 根据ID获取受试者
   */
  getById(id) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM subjects WHERE id = ?').get(id);
  },

  /**
   * 根据受试者编号获取（同一研究内）
   */
  getByNumber(studyId, subjectCode) {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM subjects WHERE study_id = ? AND subject_code = ?')
      .get(studyId, subjectCode);
  },

  /**
   * 创建受试者
   * @param {Object} data - 支持 assigned_user_id（受试者所属 CRC）
   */
  create(data) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO subjects
        (subject_code, name, gender, birth_date, phone, id_number, study_id, status, assigned_user_id)
      VALUES
        (@subject_code, @name, @gender, @birth_date, @phone, @id_number, @study_id, @status, @assigned_user_id)
    `);
    const params = {
      subject_code: data.subject_code,
      name: data.name || '',
      gender: data.gender || '',
      birth_date: data.birth_date || null,
      phone: data.phone || '',
      id_number: data.id_number || '',
      study_id: data.study_id,
      status: data.status || '筛选中',
      assigned_user_id: data.assigned_user_id || null,
    };
    const result = stmt.run(params);
    return this.getById(result.lastInsertRowid);
  },

  /**
   * 更新受试者信息
   */
  update(id, data) {
    const db = getDatabase();
    const current = this.getById(id);
    if (!current) return false;

    const merged = {
      subject_code:
        data.subject_code !== undefined ? data.subject_code : current.subject_code,
      name: data.name !== undefined ? data.name : current.name,
      gender: data.gender !== undefined ? data.gender : current.gender,
      birth_date: data.birth_date !== undefined ? data.birth_date : current.birth_date,
      phone: data.phone !== undefined ? data.phone : current.phone,
      id_number: data.id_number !== undefined ? data.id_number : current.id_number,
      study_id: data.study_id !== undefined ? data.study_id : current.study_id,
      status: data.status !== undefined ? data.status : current.status,
      assigned_user_id:
        data.assigned_user_id !== undefined ? data.assigned_user_id : current.assigned_user_id,
    };
    const result = db
      .prepare(
        `UPDATE subjects
           SET subject_code = @subject_code, name = @name, gender = @gender,
               birth_date = @birth_date, phone = @phone, id_number = @id_number,
               study_id = @study_id, status = @status,
               assigned_user_id = @assigned_user_id,
               updated_at = datetime('now','localtime')
         WHERE id = @id`
       )
       .run({ ...merged, id });
    return result.changes > 0;
  },

  /**
   * 更新受试者状态
   */
  updateStatus(id, status) {
    const db = getDatabase();
    const result = db
      .prepare(
        `UPDATE subjects SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?`
      )
      .run(status, id);
    return result.changes > 0;
  },

  /**
   * 删除受试者
   */
  remove(id) {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM subjects WHERE id = ?').run(id);
    return result.changes > 0;
  },

  /**
   * 获取某研究的受试者总数
   * @param {Object} [options] - { assigned_user_id } 可选权限过滤
   */
  countByStudyId(studyId, options = {}) {
    const db = getDatabase();
    const conditions = ['study_id = ?'];
    const params = [studyId];
    if (options.assigned_user_id !== undefined && options.assigned_user_id !== null) {
      conditions.push('assigned_user_id = ?');
      params.push(options.assigned_user_id);
    }
    const row = db
      .prepare(`SELECT COUNT(*) AS count FROM subjects WHERE ${conditions.join(' AND ')}`)
      .get(...params);
    return row ? row.count : 0;
  },

  /**
   * 按姓名或编号搜索某研究下的受试者
   * @param {Object} [options] - { assigned_user_id } 可选权限过滤
   */
  search(studyId, keyword, options = {}) {
    const db = getDatabase();
    const like = `%${keyword}%`;
    const conditions = ['study_id = ?', '(name LIKE ? OR subject_code LIKE ?)'];
    const params = [studyId, like, like];
    if (options.assigned_user_id !== undefined && options.assigned_user_id !== null) {
      conditions.push('assigned_user_id = ?');
      params.push(options.assigned_user_id);
    }
    return db
      .prepare(
        `SELECT * FROM subjects WHERE ${conditions.join(' AND ')} ORDER BY subject_code ASC`
      )
      .all(...params);
  },

  /**
   * 判断指定用户能否访问该受试者（PI 可访问全部；CRC 仅可访问分配给自己的）
   * @param {Object} user - { id, role }
   * @param {number} subjectId
   * @returns {boolean}
   */
  canAccess(user, subjectId) {
    if (!user) return false;
    if (user.role === 'pi') return true;
    const subject = this.getById(subjectId);
    return !!subject && subject.assigned_user_id === user.id;
  },
};

module.exports = subjectService;