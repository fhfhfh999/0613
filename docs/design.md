# 受试者随访提醒与访视窗口计算系统 - 设计文档

## 一、项目概述

### 1.1 项目背景
某三甲医院药物临床试验机构，正在开展一项肿瘤药物III期临床试验，入组120名受试者。每位受试者需完成 筛选期→治疗期（6个周期）→随访期（3次），共计10个访视节点。

### 1.2 项目目标
开发一个轻量级Web工具，自动计算访视窗口，提供每日提醒清单，减少人工操作错误，提高临床试验管理效率。

### 1.3 技术栈
| 层次 | 技术选型 | 说明 |
|------|---------|------|
| 前端 | React 18 + Ant Design 5 | 组件化UI，表格/日历组件丰富 |
| 后端 | Node.js + Express | 轻量级，快速开发 |
| 数据库 | SQLite (better-sqlite3) | 零配置，适合单机部署 |
| 测试 | Jest + Supertest | 单元测试 + 接口测试 |
| 构建 | Vite | 前端快速构建 |
| Excel处理 | xlsx (SheetJS) | 导入导出Excel |

---

## 二、业务规则技术转化

### 2.1 访视节点定义（常量表）

```javascript
const VISIT_SCHEDULE = [
  { id: 'screening', name: '筛选期', offsetDays: 0, windowDays: 0, isKey: true },
  { id: 'c1', name: '治疗期C1', offsetDays: 21, windowDays: 3, isKey: true },
  { id: 'c2', name: '治疗期C2', offsetDays: 21, windowDays: 3, isKey: true },
  { id: 'c3', name: '治疗期C3', offsetDays: 21, windowDays: 3, isKey: true },
  { id: 'c4', name: '治疗期C4', offsetDays: 21, windowDays: 3, isKey: true },
  { id: 'c5', name: '治疗期C5', offsetDays: 21, windowDays: 3, isKey: true },
  { id: 'c6', name: '治疗期C6', offsetDays: 21, windowDays: 3, isKey: true },
  { id: 'f1', name: '随访期F1', offsetDays: 28, windowDays: 7, isKey: false },
  { id: 'f2', name: '随访期F2', offsetDays: 28, windowDays: 7, isKey: false },
  { id: 'f3', name: '随访期F3', offsetDays: 28, windowDays: 7, isKey: false },
];
```

### 2.2 核心算法逻辑

#### 2.2.1 访视计划计算
- **首次计算**：以入组日期(D0)为基准，逐个累加offsetDays生成计划日期
- **窗口期计算**：计划日期 ± windowDays 构成可接受窗口
- **级联重算**：当某个访视填入实际日期后，后续所有访视以该实际日期为新基准重新计算

#### 2.2.2 状态判定规则
| 状态 | 判定条件 |
|------|---------|
| 待访视 | 当前日期 < 窗口开始日期 |
| 窗口期内 | 窗口开始日期 ≤ 当前日期 ≤ 窗口结束日期 |
| 即将超窗 | 当前日期在窗口期内，且距窗口结束 ≤ 2天 |
| 已超窗 | 当前日期 > 窗口结束日期 且 无实际访视日期 |
| 已完成 | 已填入实际访视日期 |
| 方案偏离 | 超出窗口期未完成访视，自动标记 |

#### 2.2.3 特殊规则
- 受试者状态为"脱落"时，停止所有后续提醒
- 受试者状态为"完成"时，不再生成提醒
- 实际访视日期回填时，需校验是否在窗口期内

---

## 三、数据模型设计

### 3.1 受试者表 (subjects)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| subject_no | TEXT UNIQUE | 受试者编号 |
| name_abbr | TEXT | 姓名缩写 |
| enrollment_date | TEXT | 入组日期 (ISO格式) |
| status | TEXT | 状态: active/withdrawn/completed |
| assigned_crc | TEXT | 负责CRC |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### 3.2 访视记录表 (visits)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| subject_id | INTEGER FK | 关联受试者 |
| visit_type | TEXT | 访视类型: screening/c1-c6/f1-f3 |
| visit_order | INTEGER | 访视顺序 (0-9) |
| planned_date | TEXT | 计划日期 |
| window_start | TEXT | 窗口开始日期 |
| window_end | TEXT | 窗口结束日期 |
| actual_date | TEXT | 实际访视日期 (可为空) |
| status | TEXT | 状态: pending/in_window/overdue/completed/deviation |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### 3.3 方案偏离表 (deviations)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| subject_id | INTEGER FK | 关联受试者 |
| visit_id | INTEGER FK | 关联访视记录 |
| deviation_type | TEXT | 偏离类型 |
| deviation_date | TEXT | 偏离发现日期 |
| description | TEXT | 偏离描述 |
| status | TEXT | 处理状态: open/resolved |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

---

## 四、API设计

### 4.1 受试者管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/subjects | 获取受试者列表 (支持分页/筛选) |
| GET | /api/subjects/:id | 获取受试者详情 |
| POST | /api/subjects | 新增受试者 |
| PUT | /api/subjects/:id | 更新受试者信息 |
| DELETE | /api/subjects/:id | 删除受试者 |
| POST | /api/subjects/import | Excel批量导入 |
| PUT | /api/subjects/:id/status | 更新受试者状态(脱落/完成) |

### 4.2 访视管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/subjects/:id/visits | 获取某受试者的所有访视计划 |
| PUT | /api/visits/:id/actual-date | 回填实际访视日期 |
| POST | /api/subjects/:id/recalculate | 重算某受试者的访视计划 |

### 4.3 每日提醒
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/reminders/today | 今日待访视列表 |
| GET | /api/reminders/tomorrow | 明日待访视列表 |
| GET | /api/reminders/week | 本周待访视列表 |
| GET | /api/reminders/warnings | 超窗预警列表 |

### 4.4 方案偏离
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/deviations | 偏离记录列表 |
| GET | /api/deviations/summary | 偏离汇总报表 |
| PUT | /api/deviations/:id/resolve | 处理偏离记录 |

### 4.5 导出 (增强功能)
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/export/visits | 导出访视计划Excel |
| GET | /api/export/deviations | 导出偏离报表Excel |

---

## 五、项目目录结构

```
0613/
├── docs/
│   └── design.md                          # 本设计文档
├── server/
│   ├── package.json
│   ├── jest.config.js
│   ├── src/
│   │   ├── app.js                         # Express应用配置
│   │   ├── server.js                      # 服务入口
│   │   ├── config.js                      # 配置管理
│   │   ├── database/
│   │   │   ├── init.js                    # 数据库初始化
│   │   │   └── migrations/                # 数据库迁移
│   │   ├── routes/
│   │   │   ├── subjects.js                # 受试者路由
│   │   │   ├── visits.js                  # 访视路由
│   │   │   ├── reminders.js               # 提醒路由
│   │   │   ├── deviations.js              # 偏离路由
│   │   │   └── export.js                  # 导出路由
│   │   ├── controllers/
│   │   │   ├── subjectController.js
│   │   │   ├── visitController.js
│   │   │   ├── reminderController.js
│   │   │   └── deviationController.js
│   │   ├── services/
│   │   │   ├── visitCalculator.js         # 核心：访视窗口计算
│   │   │   ├── reminderService.js         # 每日提醒逻辑
│   │   │   ├── deviationDetector.js       # 偏离检测
│   │   │   └── excelService.js            # Excel处理
│   │   ├── models/
│   │   │   ├── subjectModel.js
│   │   │   ├── visitModel.js
│   │   │   └── deviationModel.js
│   │   ├── middleware/
│   │   │   ├── errorHandler.js
│   │   │   └── auth.js
│   │   └── utils/
│   │       ├── dateUtils.js               # 日期工具函数
│   │       └── constants.js               # 常量定义
│   └── __tests__/
│       ├── unit/
│       │   ├── visitCalculator.test.js    # 核心算法单元测试
│       │   ├── dateUtils.test.js          # 日期工具测试
│       │   ├── deviationDetector.test.js  # 偏离检测测试
│       │   └── reminderService.test.js    # 提醒服务测试
│       └── integration/
│           ├── subjects.test.js           # 受试者API集成测试
│           ├── visits.test.js             # 访视API集成测试
│           ├── reminders.test.js          # 提醒API集成测试
│           └── deviations.test.js         # 偏离API集成测试
├── client/
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── api/
│       │   └── index.js                   # API调用封装
│       ├── pages/
│       │   ├── Subjects.jsx               # 受试者管理页
│       │   ├── VisitSchedule.jsx          # 访视计划页
│       │   ├── DailyReminder.jsx          # 每日提醒页
│       │   ├── Deviations.jsx             # 方案偏离页
│       │   └── Calendar.jsx               # 日历视图(增强)
│       ├── components/
│       │   ├── SubjectForm.jsx            # 受试者表单
│       │   ├── VisitTable.jsx             # 访视表格
│       │   ├── ReminderList.jsx           # 提醒列表
│       │   ├── ImportModal.jsx            # Excel导入弹窗
│       │   └── Layout.jsx                 # 布局组件
│       └── utils/
│           └── constants.js
└── README.md
```

---

## 六、核心服务功能说明

### 6.1 visitCalculator.js - 访视计算服务
**职责**：实现访视计划的核心计算逻辑
- `generateVisitPlan(enrollmentDate)` - 根据入组日期生成完整访视计划
- `recalculateFromVisit(subjectId, visitOrder)` - 从指定访视开始重算
- `calculateWindow(plannedDate, windowDays)` - 计算窗口期
- `fillActualDate(visitId, actualDate)` - 回填实际日期并触发级联重算

### 6.2 reminderService.js - 提醒服务
**职责**：生成每日提醒清单
- `getTodayReminders()` - 获取今日待访视列表
- `getTomorrowReminders()` - 获取明日待访视列表
- `getWeekReminders()` - 获取本周待访视列表
- `getWarnings()` - 获取超窗预警（剩余天数≤2天）

### 6.3 deviationDetector.js - 偏离检测服务
**职责**：自动检测和记录方案偏离
- `detectDeviation(visitId)` - 检测单个访视是否偏离
- `scanAllDeviations()` - 扫描所有受试者偏离
- `generateSummary()` - 生成偏离汇总报表

### 6.4 excelService.js - Excel服务
**职责**：处理Excel导入导出
- `importSubjects(filePath)` - 批量导入受试者
- `exportVisitPlan(subjectIds)` - 导出访视计划
- `exportDeviationReport()` - 导出偏离报表

### 6.5 dateUtils.js - 日期工具
**职责**：统一的日期处理
- `addDays(date, days)` - 日期加减天数
- `formatDate(date)` - 格式化日期
- `diffDays(date1, date2)` - 计算两日期差天数
- `isInWindow(date, windowStart, windowEnd)` - 判断日期是否在窗口内

---

## 七、前端页面说明

### 7.1 受试者管理页 (Subjects)
- 受试者列表表格（支持搜索、筛选、分页）
- 新增/编辑受试者弹窗
- Excel批量导入按钮
- 状态标签（在组/脱落/完成）

### 7.2 访视计划页 (VisitSchedule)
- 选择受试者后展示该受试者完整访视时间线
- 每个访视节点显示：计划日期、窗口期、实际日期、状态
- 支持回填实际访视日期（点击日期即可编辑）
- 状态颜色标识（绿色=已完成，蓝色=窗口期内，黄色=即将超窗，红色=已超窗）

### 7.3 每日提醒页 (DailyReminder)
- Tab切换：今日/明日/本周/预警
- 提醒卡片列表，按窗口紧急程度排序
- 快速跳转到受试者访视详情

### 7.4 方案偏离页 (Deviations)
- 偏离记录列表
- 汇总统计（偏离总数、各类型占比）
- 导出报表按钮

### 7.5 日历视图页 (Calendar) - 增强功能
- 月/周视图切换
- 访视节点在日历上以颜色标签展示
- 点击日历项跳转详情

---

## 八、开发计划

### 第一阶段：核心功能 MVP（7天）
| 天数 | 任务 | 交付物 |
|------|------|--------|
| Day 1 | 项目搭建、数据库设计、核心算法实现 | 项目框架 + visitCalculator |
| Day 2 | 受试者管理CRUD + Excel导入 | subject API + 导入功能 |
| Day 3 | 访视计划生成 + 回填重算 | visit API + 级联重算 |
| Day 4 | 每日提醒 + 偏离检测 | reminder API + deviation API |
| Day 5 | 前端：受试者管理 + 访视计划页 | Subjects + VisitSchedule 页面 |
| Day 6 | 前端：每日提醒 + 偏离页 | DailyReminder + Deviations 页面 |
| Day 7 | 联调测试 + Bug修复 | 可运行的MVP |

### 第二阶段：增强功能（3天）
| 天数 | 任务 | 交付物 |
|------|------|--------|
| Day 8 | 权限控制 | 登录 + 角色权限 |
| Day 9 | 日历视图 | Calendar页面 |
| Day 10 | 导出功能 + 优化 | Excel导出 + 性能优化 |