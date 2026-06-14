/**
 * Excel 批量导入/导出服务
 *
 * 需求 F5：支持批量导入受试者
 * 需求 F7：支持导出受试者/访视/方案偏离 Excel 报表
 *
 * 受试者导入模板列头（顺序不限，支持中英文表头别名）：
 *   受试者编号 / subject_code / 编号   (必填)
 *   姓名 / name                         (必填)
 *   性别 / gender
 *   出生日期 / birth_date
 *   电话 / phone
 *   身份证号 / id_number
 *   入组日期 / enrollment_date          (选填，用于生成访视计划)
 *   状态 / status                       (选填，默认 筛选中)
 *
 * 调用方式：
 *   const result = excelService.importSubjects(studyId, buffer);
 *   const buf = excelService.exportSubjects(studyId, { assigned_user_id });
 */

const XLSX = require('xlsx');
const subjectService = require('./subjectService');
const visitService = require('./visitService');
const deviationService = require('./deviationService');

// 表头别名映射 → 统一字段名
const HEADER_ALIASES = {
  subject_code: ['受试者编号', 'subject_code', '编号', 'code'],
  name: ['姓名', 'name', '名称'],
  gender: ['性别', 'gender'],
  birth_date: ['出生日期', 'birth_date', '生日'],
  phone: ['电话', 'phone', '手机', '联系方式'],
  id_number: ['身份证号', 'id_number', '证件号'],
  enrollment_date: ['入组日期', 'enrollment_date', '入组时间'],
  status: ['状态', 'status'],
};

const REQUIRED_FIELDS = ['subject_code', 'name'];

const VALID_STATUSES = ['筛选中', '入组', '治疗中', '随访中', '完成', '脱落'];

const excelService = {
  /**
   * 将原始表头字符串归一化为统一字段名
   * @param {string} header
   * @returns {string|null}
   */
  _normalizeHeader(header) {
    const h = String(header || '').trim().toLowerCase();
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.some((a) => a.toLowerCase() === h)) return field;
    }
    return null;
  },

  /**
   * 把一行 {原始表头: 值} 转换为 {统一字段: 值}
   */
  _mapRow(rawRow, headerMap) {
    const row = {};
    for (const [rawHeader, value] of Object.entries(rawRow)) {
      const field = headerMap[rawHeader];
      if (field) {
        row[field] = value !== undefined && value !== null ? String(value).trim() : '';
      }
    }
    return row;
  },

  /**
   * 校验单行数据，返回 { valid, errors, data }
   */
  _validateRow(row, rowNum) {
    const errors = [];

    for (const f of REQUIRED_FIELDS) {
      if (!row[f]) {
        errors.push(`第 ${rowNum} 行：缺少必填字段 ${f}`);
      }
    }

    // 日期格式粗校验 YYYY-MM-DD
    const checkDate = (field) => {
      const val = row[field];
      if (val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
        errors.push(`第 ${rowNum} 行：${field} 格式应为 YYYY-MM-DD（当前: ${val}）`);
      }
    };
    checkDate('birth_date');
    checkDate('enrollment_date');

    if (row.status && !VALID_STATUSES.includes(row.status)) {
      errors.push(`第 ${rowNum} 行：状态值非法（${row.status}）`);
    }

    return { valid: errors.length === 0, errors, data: row };
  },

  /**
   * 批量导入受试者（含可选自动生成访视计划）
   *
   * @param {number} studyId
   * @param {Buffer|ArrayBuffer} fileBuffer - xlsx 文件内容
   * @param {Object} [options] - { generateVisits: boolean, assigned_user_id?: number }
   * @returns {{ total:number, success:number, failed:number, errors:string[], imported:Array }}
   */
  importSubjects(studyId, fileBuffer, options = {}) {
    const generateVisits = options.generateVisits !== false; // 默认 true
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // 使用 header:1 获取原始表头数组，sheet_to_json 用原始键
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (rawRows.length === 0) {
      return { total: 0, success: 0, failed: 0, errors: ['Excel 无数据行'], imported: [] };
    }

    // 构建原始表头 → 统一字段 的映射
    const rawHeaders = Object.keys(rawRows[0]);
    const headerMap = {};
    for (const h of rawHeaders) {
      const field = this._normalizeHeader(h);
      if (field) headerMap[h] = field;
    }

    // 校验必填列是否存在
    const missingColumns = [];
    for (const f of REQUIRED_FIELDS) {
      const has = Object.values(headerMap).includes(f);
      if (!has) missingColumns.push(f);
    }
    if (missingColumns.length > 0) {
      return {
        total: rawRows.length,
        success: 0,
        failed: rawRows.length,
        errors: [`缺少必填列: ${missingColumns.join(', ')}`],
        imported: [],
      };
    }

    const results = { total: rawRows.length, success: 0, failed: 0, errors: [], imported: [] };

    rawRows.forEach((rawRow, idx) => {
      const rowNum = idx + 2; // Excel 行号（第1行为表头）
      const row = this._mapRow(rawRow, headerMap);
      const { valid, errors, data } = this._validateRow(row, rowNum);

      if (!valid) {
        results.errors.push(...errors);
        results.failed += 1;
        return;
      }

      try {
        const created = subjectService.create({
          subject_code: data.subject_code,
          name: data.name,
          gender: data.gender,
          birth_date: data.birth_date || null,
          phone: data.phone,
          id_number: data.id_number,
          study_id: studyId,
          status: data.status || '筛选中',
          assigned_user_id: options.assigned_user_id || null,
        });

        // 若提供入组日期，则自动生成 10 节点访视计划
        if (generateVisits && data.enrollment_date) {
          try {
            visitService.generateVisitPlanForSubject(created.id, data.enrollment_date);
          } catch (e) {
            // 访视生成失败不影响受试者导入，仅记录警告
            results.errors.push(
              `第 ${rowNum} 行：受试者已导入，但访视计划生成失败（${e.message}）`
            );
          }
        }

        results.success += 1;
        results.imported.push(created);
      } catch (e) {
        results.errors.push(`第 ${rowNum} 行：导入失败（${e.message}）`);
        results.failed += 1;
      }
    });

    return results;
  },

  // ============================================================
  // 导出（需求 F7）
  // ============================================================

  /**
   * 导出受试者清单为 xlsx Buffer
   * @param {number} studyId
   * @param {Object} [options] - { assigned_user_id?, status? }
   * @returns {Buffer}
   */
  exportSubjects(studyId, options = {}) {
    const subjects = subjectService.getByStudyId(studyId, options);
    const rows = subjects.map((s) => ({
      '受试者编号': s.subject_code,
      '姓名': s.name,
      '性别': s.gender,
      '出生日期': s.birth_date || '',
      '电话': s.phone,
      '身份证号': s.id_number,
      '状态': s.status,
      '分配用户ID': s.assigned_user_id || '',
      '创建时间': s.created_at,
    }));
    return this._buildWorkbook([{ name: '受试者', rows }]);
  },

  /**
   * 导出访视清单为 xlsx Buffer
   * @param {number} studyId
   * @param {Object} [options] - { assigned_user_id? }
   * @returns {Buffer}
   */
  exportVisits(studyId, options = {}) {
    const visits = visitService.getByStudyId(studyId, options);
    const rows = visits.map((v) => ({
      '访视编号': v.visit_code,
      '访视类型': v.visit_type,
      '受试者ID': v.subject_id,
      '计划日期': v.visit_date,
      '窗口开始': v.visit_window_start,
      '窗口结束': v.visit_window_end,
      '状态': v.status,
      '备注': v.notes,
    }));
    return this._buildWorkbook([{ name: '访视', rows }]);
  },

  /**
   * 导出方案偏离清单为 xlsx Buffer
   * @param {Object} [options] - { study_id?, subject_id? }
   * @returns {Buffer}
   */
  exportDeviations(options = {}) {
    const list = deviationService.getList(options);
    const rows = list.map((d) => ({
      '偏离ID': d.id,
      '受试者编号': d.subject_code || '',
      '受试者姓名': d.subject_name || '',
      '访视编号': d.visit_code || '',
      '偏离类型': d.deviation_type,
      '偏离日期': d.deviation_date,
      '描述': d.description,
      '状态': d.status,
      '创建时间': d.created_at,
    }));
    return this._buildWorkbook([{ name: '方案偏离', rows }]);
  },

  /**
   * 导出综合报表（多 sheet：受试者 + 访视 + 偏离）
   * @param {number} studyId
   * @param {Object} [options] - { assigned_user_id? }
   * @returns {Buffer}
   */
  exportAll(studyId, options = {}) {
    const subjects = subjectService.getByStudyId(studyId, options);
    const visits = visitService.getByStudyId(studyId, options);
    const deviations = deviationService.getList({ study_id: studyId });

    const subjectRows = subjects.map((s) => ({
      '受试者编号': s.subject_code,
      '姓名': s.name,
      '性别': s.gender,
      '状态': s.status,
      '分配用户ID': s.assigned_user_id || '',
    }));
    const visitRows = visits.map((v) => ({
      '访视编号': v.visit_code,
      '访视类型': v.visit_type,
      '受试者ID': v.subject_id,
      '计划日期': v.visit_date,
      '窗口': v.visit_window_start && v.visit_window_end
        ? `${v.visit_window_start} ~ ${v.visit_window_end}`
        : '',
      '状态': v.status,
    }));
    const deviationRows = deviations.map((d) => ({
      '受试者编号': d.subject_code || '',
      '访视编号': d.visit_code || '',
      '偏离类型': d.deviation_type,
      '偏离日期': d.deviation_date,
      '描述': d.description,
      '状态': d.status,
    }));

    return this._buildWorkbook([
      { name: '受试者', rows: subjectRows },
      { name: '访视', rows: visitRows },
      { name: '方案偏离', rows: deviationRows },
    ]);
  },

  /**
   * 构建多 sheet workbook 并返回 Buffer
   * @param {Array<{name:string, rows:Array<Object>}>} sheets
   * @returns {Buffer}
   */
  _buildWorkbook(sheets) {
    const wb = XLSX.utils.book_new();
    for (const s of sheets) {
      const ws = XLSX.utils.json_to_sheet(s.rows.length > 0 ? s.rows : [{}]);
      XLSX.utils.book_append_sheet(wb, ws, s.name);
    }
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  },
};

module.exports = excelService;