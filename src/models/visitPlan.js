/**
 * 访视计划模型
 * 定义临床试验的访视节点规则（筛选期→治疗期6周期→随访期3次）
 *
 * 业务规则（见 docs/设计文档.md 2.1）：
 * - 筛选期: 入组当天 D0，窗口 ±0 天
 * - 治疗期 C1~C6: 前一节点 + 21 天，窗口 ±3 天
 * - 随访期 F1~F3: 前一节点 + 28 天，窗口 ±7 天
 *
 * 特殊规则：若某访视实际发生日期偏离计划日期，后续所有访视需以实际发生日期重新计算。
 */

/**
 * 访视计划模板
 * @property {string} type - 访视类型（screening/c1..c6/f1..f3）
 * @property {string} name - 访视名称
 * @property {number} order - 访视顺序（0-9）
 * @property {number} offsetDays - 相对前一访视计划日期的偏移天数
 * @property {number} windowDays - 窗口期天数（±）
 */
const VISIT_PLAN_TEMPLATE = [
  { type: 'screening', name: '筛选期', order: 0, offsetDays: 0, windowDays: 0 },
  { type: 'c1', name: '治疗期C1', order: 1, offsetDays: 21, windowDays: 3 },
  { type: 'c2', name: '治疗期C2', order: 2, offsetDays: 21, windowDays: 3 },
  { type: 'c3', name: '治疗期C3', order: 3, offsetDays: 21, windowDays: 3 },
  { type: 'c4', name: '治疗期C4', order: 4, offsetDays: 21, windowDays: 3 },
  { type: 'c5', name: '治疗期C5', order: 5, offsetDays: 21, windowDays: 3 },
  { type: 'c6', name: '治疗期C6', order: 6, offsetDays: 21, windowDays: 3 },
  { type: 'f1', name: '随访期F1', order: 7, offsetDays: 28, windowDays: 7 },
  { type: 'f2', name: '随访期F2', order: 8, offsetDays: 28, windowDays: 7 },
  { type: 'f3', name: '随访期F3', order: 9, offsetDays: 28, windowDays: 7 },
];

/**
 * 访视类型 → 中文名称 映射
 */
const VISIT_TYPE_NAME_MAP = VISIT_PLAN_TEMPLATE.reduce((acc, item) => {
  acc[item.type] = item.name;
  return acc;
}, {});

/**
 * 访视类型 → 模板项 映射
 */
const VISIT_TYPE_MAP = VISIT_PLAN_TEMPLATE.reduce((acc, item) => {
  acc[item.type] = item;
  return acc;
}, {});

/**
 * 访视顺序 → 模板项 映射
 */
const VISIT_ORDER_MAP = VISIT_PLAN_TEMPLATE.reduce((acc, item) => {
  acc[item.order] = item;
  return acc;
}, {});

/**
 * 获取访视计划模板（只读副本）
 */
function getVisitPlanTemplate() {
  return VISIT_PLAN_TEMPLATE.map((item) => ({ ...item }));
}

/**
 * 根据访视类型获取模板项
 */
function getByType(type) {
  const item = VISIT_TYPE_MAP[type];
  return item ? { ...item } : undefined;
}

/**
 * 根据访视顺序获取模板项
 */
function getByOrder(order) {
  const item = VISIT_ORDER_MAP[order];
  return item ? { ...item } : undefined;
}

/**
 * 获取访视中文名称
 */
function getVisitName(type) {
  return VISIT_TYPE_NAME_MAP[type] || '';
}

/**
 * 获取最后一个访视的顺序号
 */
function getLastOrder() {
  return VISIT_PLAN_TEMPLATE.length - 1;
}

module.exports = {
  VISIT_PLAN_TEMPLATE,
  VISIT_TYPE_NAME_MAP,
  VISIT_TYPE_MAP,
  VISIT_ORDER_MAP,
  getVisitPlanTemplate,
  getByType,
  getByOrder,
  getVisitName,
  getLastOrder,
};