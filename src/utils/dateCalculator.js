/**
 * 日期计算工具（访视窗口计算核心）
 *
 * 所有日期均采用 'YYYY-MM-DD' 字符串格式，使用本地时区。
 * 不依赖第三方库，避免 dayjs 时区/插件问题。
 */

const { getVisitPlanTemplate, getByOrder, getLastOrder } = require('../models/visitPlan');

/**
 * 将日期字符串解析为本地午夜的 Date 对象
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @returns {Date}
 */
function parseDate(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) {
    const d = new Date(dateStr.getFullYear(), dateStr.getMonth(), dateStr.getDate());
    return d;
  }
  const parts = String(dateStr).split('-');
  if (parts.length !== 3) {
    throw new Error(`无效日期格式: ${dateStr}（应为 YYYY-MM-DD）`);
  }
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    throw new Error(`无效日期格式: ${dateStr}（应为 YYYY-MM-DD）`);
  }
  return new Date(year, month - 1, day);
}

/**
 * 格式化日期为 'YYYY-MM-DD'（本地时区，补零）
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 判断是否为合法日期字符串
 */
function isValidDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(dateStr)) return false;
  const parts = dateStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  if (month < 1 || month > 12) return false;
  const d = new Date(year, month - 1, day);
  return (
    d.getFullYear() === year &&
    d.getMonth() === month - 1 &&
    d.getDate() === day
  );
}

/**
 * 计算计划日期：baseDate + offsetDays
 * @param {string|Date} baseDate - 基准日期
 * @param {number} offsetDays - 偏移天数（可为负）
 * @returns {string} 'YYYY-MM-DD'
 */
function calculatePlannedDate(baseDate, offsetDays) {
  const base = parseDate(baseDate);
  if (base === null) return null;
  base.setDate(base.getDate() + Number(offsetDays || 0));
  return formatDate(base);
}

/**
 * 计算窗口期：返回 [plannedDate - windowDays, plannedDate + windowDays]
 * @param {string|Date} plannedDate - 计划日期
 * @param {number} windowDays - 窗口期天数（±）
 * @returns {{window_start: string, window_end: string}}
 */
function calculateWindowDates(plannedDate, windowDays) {
  if (windowDays === 0 || windowDays === undefined || windowDays === null) {
    const pd = formatDate(parseDate(plannedDate));
    return { window_start: pd, window_end: pd };
  }
  const w = Number(windowDays);
  return {
    window_start: calculatePlannedDate(plannedDate, -w),
    window_end: calculatePlannedDate(plannedDate, w),
  };
}

/**
 * 判断日期是否在窗口期内（含边界）
 * @param {string|Date} date
 * @param {string|Date} windowStart
 * @param {string|Date} windowEnd
 * @returns {boolean}
 */
function isDateInWindow(date, windowStart, windowEnd) {
  const d = parseDate(date);
  const s = parseDate(windowStart);
  const e = parseDate(windowEnd);
  if (!d || !s || !e) return false;
  const dt = d.getTime();
  return dt >= s.getTime() && dt <= e.getTime();
}

/**
 * 计算两个日期之间的天数差（to - from），返回整数（可负）
 */
function diffDays(fromDate, toDate) {
  const from = parseDate(fromDate);
  const to = parseDate(toDate);
  if (!from || !to) return null;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * 判断是否超窗：参考日期已超过窗口结束日期
 * @param {string|Date} windowEnd - 窗口截止日期
 * @param {string|Date} referenceDate - 参考日期（默认今天）
 * @returns {boolean}
 */
function isOverdue(windowEnd, referenceDate) {
  const ref = referenceDate ? parseDate(referenceDate) : new Date();
  const end = parseDate(windowEnd);
  if (!end) return false;
  return parseDate(formatDate(ref)).getTime() > end.getTime();
}

/**
 * 计算距截止日剩余天数：windowEnd - today（负值表示已超窗）
 * @param {string|Date} windowEnd
 * @param {string|Date} referenceDate - 参考日期（默认今天）
 * @returns {number}
 */
function daysUntilDeadline(windowEnd, referenceDate) {
  const ref = referenceDate ? parseDate(referenceDate) : new Date();
  return diffDays(formatDate(ref), windowEnd);
}

/**
 * 生成完整访视计划（基于入组日期）
 *
 * 顺序计算：每个访视的 plannedDate 以前一访视的 plannedDate 为基准 + offsetDays
 * （首次以 enrollmentDate 为基准）
 *
 * @param {string} enrollmentDate - 入组日期
 * @returns {Array<Object>} 访视计划数组，每项含 type/name/order/planned_date/window_start/window_end
 */
function generateVisitPlan(enrollmentDate) {
  if (!isValidDate(enrollmentDate)) {
    throw new Error(`无效入组日期: ${enrollmentDate}`);
  }
  const template = getVisitPlanTemplate();
  const plan = [];
  let prevPlanned = enrollmentDate;
  for (const item of template) {
    const plannedDate = calculatePlannedDate(prevPlanned, item.offsetDays);
    const { window_start, window_end } = calculateWindowDates(
      plannedDate,
      item.windowDays
    );
    plan.push({
      type: item.type,
      name: item.name,
      order: item.order,
      planned_date: plannedDate,
      window_start,
      window_end,
    });
    prevPlanned = plannedDate;
  }
  return plan;
}

/**
 * 以实际日期重算后续访视
 *
 * 业务难点：若某访视实际发生日期偏离计划日期，
 * 后续所有访视需以该实际日期为新基准重新计算。
 *
 * @param {Array<Object>} visits - 已生成的访视计划（按 order 升序）
 * @param {number} fromOrder - 从哪个 order（含）开始重算
 * @param {string} actualDate - 实际发生日期（作为新基准）
 * @returns {Array<Object>} 更新后的访视计划（planned_date/window 已重算）
 */
function recalculateSubsequentVisits(visits, fromOrder, actualDate) {
  if (!visits || visits.length === 0) return [];
  if (!isValidDate(actualDate)) {
    throw new Error(`无效实际日期: ${actualDate}`);
  }
  // 复制以避免修改原数组
  const result = visits.map((v) => ({ ...v }));
  // 以 actualDate 作为 fromOrder 的计划日期，后续依次累加
  let prevPlanned = actualDate;
  const template = getVisitPlanTemplate();
  for (const v of result) {
    if (v.order < fromOrder) continue;
    const tpl = template.find((t) => t.order === v.order);
    if (!tpl) continue;
    // fromOrder 这一项：planned = actualDate（offset 不再叠加）
    // 其后各项：planned = prevPlanned + offsetDays
    const planned =
      v.order === fromOrder ? actualDate : calculatePlannedDate(prevPlanned, tpl.offsetDays);
    const { window_start, window_end } = calculateWindowDates(
      planned,
      tpl.windowDays
    );
    v.planned_date = planned;
    v.window_start = window_start;
    v.window_end = window_end;
    prevPlanned = planned;
  }
  return result;
}

module.exports = {
  parseDate,
  formatDate,
  isValidDate,
  calculatePlannedDate,
  calculateWindowDates,
  isDateInWindow,
  diffDays,
  isOverdue,
  daysUntilDeadline,
  generateVisitPlan,
  recalculateSubsequentVisits,
};