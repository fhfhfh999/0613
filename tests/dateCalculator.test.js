/**
 * 日期计算工具单元测试（核心业务逻辑）
 *
 * 覆盖需求 F2：访视窗口计算 + 实际日期回填重算
 */

const dateCalc = require('../src/utils/dateCalculator');
const { getVisitPlanTemplate } = require('../src/models/visitPlan');

describe('日期计算工具', () => {
  describe('parseDate / formatDate', () => {
    test('应能正确解析 YYYY-MM-DD', () => {
      const d = dateCalc.parseDate('2026-06-13');
      expect(d).toBeInstanceOf(Date);
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(5); // 6月
      expect(d.getDate()).toBe(13);
    });

    test('formatDate 应输出 YYYY-MM-DD 并补零', () => {
      const d = new Date(2026, 0, 5);
      expect(dateCalc.formatDate(d)).toBe('2026-01-05');
    });

    test('parseDate 空值应返回 null', () => {
      expect(dateCalc.parseDate(null)).toBeNull();
      expect(dateCalc.parseDate('')).toBeNull();
    });

    test('parseDate 非法格式应抛错', () => {
      expect(() => dateCalc.parseDate('2026/06/13')).toThrow();
      expect(() => dateCalc.parseDate('abc')).toThrow();
    });
  });

  describe('isValidDate', () => {
    test('合法日期应返回 true', () => {
      expect(dateCalc.isValidDate('2026-06-13')).toBe(true);
      expect(dateCalc.isValidDate('2026-02-28')).toBe(true);
    });

    test('非法格式应返回 false', () => {
      expect(dateCalc.isValidDate('2026-6-13')).toBe(false);
      expect(dateCalc.isValidDate('2026/06/13')).toBe(false);
      expect(dateCalc.isValidDate('')).toBe(false);
      expect(dateCalc.isValidDate(null)).toBe(false);
    });

    test('不存在的日期应返回 false（如2月30日）', () => {
      expect(dateCalc.isValidDate('2026-02-30')).toBe(false);
      expect(dateCalc.isValidDate('2026-13-01')).toBe(false);
      expect(dateCalc.isValidDate('2026-00-01')).toBe(false);
    });
  });

  describe('calculatePlannedDate', () => {
    test('应正确计算正偏移', () => {
      expect(dateCalc.calculatePlannedDate('2026-01-01', 21)).toBe('2026-01-22');
    });

    test('应正确计算负偏移', () => {
      expect(dateCalc.calculatePlannedDate('2026-01-22', -3)).toBe('2026-01-19');
    });

    test('偏移 0 应返回同一天', () => {
      expect(dateCalc.calculatePlannedDate('2026-06-13', 0)).toBe('2026-06-13');
    });

    test('应正确处理跨月', () => {
      expect(dateCalc.calculatePlannedDate('2026-01-31', 1)).toBe('2026-02-01');
      expect(dateCalc.calculatePlannedDate('2026-12-31', 1)).toBe('2027-01-01');
    });
  });

  describe('calculateWindowDates', () => {
    test('窗口期 ±3 天应返回正确的开始/结束', () => {
      const win = dateCalc.calculateWindowDates('2026-01-22', 3);
      expect(win.window_start).toBe('2026-01-19');
      expect(win.window_end).toBe('2026-01-25');
    });

    test('窗口期 ±7 天应返回正确的开始/结束', () => {
      const win = dateCalc.calculateWindowDates('2026-03-15', 7);
      expect(win.window_start).toBe('2026-03-08');
      expect(win.window_end).toBe('2026-03-22');
    });

    test('窗口期 0 天应返回同一天', () => {
      const win = dateCalc.calculateWindowDates('2026-06-13', 0);
      expect(win.window_start).toBe('2026-06-13');
      expect(win.window_end).toBe('2026-06-13');
    });
  });

  describe('isDateInWindow', () => {
    test('窗口内的日期应返回 true', () => {
      expect(
        dateCalc.isDateInWindow('2026-01-22', '2026-01-19', '2026-01-25')
      ).toBe(true);
    });

    test('边界日期应返回 true（含边界）', () => {
      expect(
        dateCalc.isDateInWindow('2026-01-19', '2026-01-19', '2026-01-25')
      ).toBe(true);
      expect(
        dateCalc.isDateInWindow('2026-01-25', '2026-01-19', '2026-01-25')
      ).toBe(true);
    });

    test('窗口外的日期应返回 false', () => {
      expect(
        dateCalc.isDateInWindow('2026-01-18', '2026-01-19', '2026-01-25')
      ).toBe(false);
      expect(
        dateCalc.isDateInWindow('2026-01-26', '2026-01-19', '2026-01-25')
      ).toBe(false);
    });
  });

  describe('diffDays / daysUntilDeadline / isOverdue', () => {
    test('diffDays 应正确计算天数差', () => {
      expect(dateCalc.diffDays('2026-01-01', '2026-01-22')).toBe(21);
      expect(dateCalc.diffDays('2026-01-22', '2026-01-01')).toBe(-21);
    });

    test('isOverdue 参考日期晚于截止日应返回 true', () => {
      expect(dateCalc.isOverdue('2026-01-01', '2026-01-02')).toBe(true);
    });

    test('isOverdue 参考日期等于截止日应返回 false（仍在窗口）', () => {
      expect(dateCalc.isOverdue('2026-01-01', '2026-01-01')).toBe(false);
    });

    test('isOverdue 参考日期早于截止日应返回 false', () => {
      expect(dateCalc.isOverdue('2026-01-05', '2026-01-01')).toBe(false);
    });

    test('daysUntilDeadline 应返回剩余天数', () => {
      expect(dateCalc.daysUntilDeadline('2026-01-10', '2026-01-05')).toBe(5);
      expect(dateCalc.daysUntilDeadline('2026-01-10', '2026-01-15')).toBe(-5);
    });
  });

  describe('generateVisitPlan', () => {
    const plan = dateCalc.generateVisitPlan('2026-01-01');

    test('应生成 10 个访视节点', () => {
      expect(plan).toHaveLength(10);
    });

    test('筛选期应为入组当天，窗口为 ±0', () => {
      const screening = plan[0];
      expect(screening.type).toBe('screening');
      expect(screening.planned_date).toBe('2026-01-01');
      expect(screening.window_start).toBe('2026-01-01');
      expect(screening.window_end).toBe('2026-01-01');
    });

    test('C1 应为 D0 + 21 天，窗口 ±3', () => {
      const c1 = plan.find((v) => v.type === 'c1');
      expect(c1.planned_date).toBe('2026-01-22');
      expect(c1.window_start).toBe('2026-01-19');
      expect(c1.window_end).toBe('2026-01-25');
    });

    test('C2 应为 C1 + 21 天', () => {
      const c1 = plan.find((v) => v.type === 'c1');
      const c2 = plan.find((v) => v.type === 'c2');
      expect(c2.planned_date).toBe(
        dateCalc.calculatePlannedDate(c1.planned_date, 21)
      );
    });

    test('F1 应为 C6 + 28 天，窗口 ±7', () => {
      const c6 = plan.find((v) => v.type === 'c6');
      const f1 = plan.find((v) => v.type === 'f1');
      expect(f1.planned_date).toBe(
        dateCalc.calculatePlannedDate(c6.planned_date, 28)
      );
      const win = dateCalc.calculateWindowDates(f1.planned_date, 7);
      expect(f1.window_start).toBe(win.window_start);
      expect(f1.window_end).toBe(win.window_end);
    });

    test('F3 应为 F2 + 28 天', () => {
      const f2 = plan.find((v) => v.type === 'f2');
      const f3 = plan.find((v) => v.type === 'f3');
      expect(f3.planned_date).toBe(
        dateCalc.calculatePlannedDate(f2.planned_date, 28)
      );
    });

    test('非法入组日期应抛错', () => {
      expect(() => dateCalc.generateVisitPlan('invalid')).toThrow();
    });
  });

  describe('recalculateSubsequentVisits', () => {
    test('应以实际日期为新基准重算后续访视', () => {
      const plan = dateCalc.generateVisitPlan('2026-01-01');
      // 假设 C1 实际日期为 2026-01-28（比计划的 01-22 偏后 6 天）
      const actualC1 = '2026-01-28';
      const recalced = dateCalc.recalculateSubsequentVisits(plan, 1, actualC1);

      // C1 自身：planned = actualDate
      const c1 = recalced.find((v) => v.type === 'c1');
      expect(c1.planned_date).toBe(actualC1);

      // C2 应为 C1实际 + 21 天
      const c2 = recalced.find((v) => v.type === 'c2');
      expect(c2.planned_date).toBe('2026-02-18');

      // F1 应为 C6（重算后）+ 28 天
      const c6 = recalced.find((v) => v.type === 'c6');
      const f1 = recalced.find((v) => v.type === 'f1');
      expect(f1.planned_date).toBe(
        dateCalc.calculatePlannedDate(c6.planned_date, 28)
      );
    });

    test('不应修改 fromOrder 之前的访视', () => {
      const plan = dateCalc.generateVisitPlan('2026-01-01');
      const originalC1 = plan.find((v) => v.type === 'c1').planned_date;
      const recalced = dateCalc.recalculateSubsequentVisits(plan, 2, '2026-02-15');
      const c1 = recalced.find((v) => v.type === 'c1');
      expect(c1.planned_date).toBe(originalC1);
    });

    test('空数组应返回空数组', () => {
      expect(dateCalc.recalculateSubsequentVisits([], 1, '2026-01-01')).toEqual([]);
    });

    test('非法实际日期应抛错', () => {
      const plan = dateCalc.generateVisitPlan('2026-01-01');
      expect(() =>
        dateCalc.recalculateSubsequentVisits(plan, 1, 'invalid')
      ).toThrow();
    });
  });
});

describe('访视计划模型', () => {
  test('应提供 10 个访视模板项', () => {
    const template = getVisitPlanTemplate();
    expect(template).toHaveLength(10);
    expect(template[0].type).toBe('screening');
    expect(template[9].type).toBe('f3');
  });

  test('每个模板项应包含 type/name/order/offsetDays/windowDays', () => {
    const template = getVisitPlanTemplate();
    for (const item of template) {
      expect(item).toHaveProperty('type');
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('order');
      expect(item).toHaveProperty('offsetDays');
      expect(item).toHaveProperty('windowDays');
    }
  });

  test('getVisitPlanTemplate 应返回只读副本（修改不影响原数据）', () => {
    const t1 = getVisitPlanTemplate();
    t1[0].type = 'modified';
    const t2 = getVisitPlanTemplate();
    expect(t2[0].type).toBe('screening');
  });
});