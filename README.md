# 受试者随访提醒与访视窗口计算系统
 
一个用于临床试验受试者随访管理的 Node.js + Express 应用，提供访视窗口自动计算、提醒清单、方案偏离检测、Excel 批量导入/导出、多角色鉴权与日历视图等功能。
 
## 技术栈
 
- 运行时：Node.js（建议 18+，实验性内置 SQLite）
- 后端：Express 4
- 存储：文件型 SQLite（data/followup.db，测试期自动隔离）
- Office：xlsx 处理 Excel 导入/导出；multer 处理文件上传
- 测试：Jest + supertest

## 目录结构
 
```
0613/
├── app.js                  # Express 入口（路由 + 鉴权中间件）
├── scripts/
│   └── init-db.js          # 初始化/重置数据库并写入种子数据
├── src/
│   ├── models/             # database.js（建表）+ visitPlan.js（访视模板）
│   ├── services/           # 业务服务（study/subject/visit/reminder/deviation/excel/auth…）
│   └── utils/              # dateCalculator 等工具
├── public/                 # 前端单页（index.html / app.js / style.css）
├── tests/                  # Jest 测试（11 个套件，154 个用例）
└── docs/                   # 设计文档
```
 
## 快速开始
 
### 1. 安装依赖
 
```bash
npm install
```
 
### 2. 初始化数据库（首次运行或需要重置时）
 
```bash
npm run init-db
```
 
该脚本会创建 data/followup.db、所有表结构，并写入：
- 示例研究项目（ONCO-2026-III、DEMO-001）
- 示例受试者与访视计划
- 默认 PI / CRC 种子账户（见下）
 
### 3. 启动服务
 
```bash
npm start          # 生产启动
# 或
npm run dev        # 文件改动自动重启（node --watch）
```
 
默认监听 http://localhost:3000 。浏览器打开该地址即可看到前端界面。

## 默认账户（种子数据）
 
> 密码仅用于本地演示，生产请修改并妥善保管。
 
| 角色 | 用户名 | 密码 | 权限 |
|------|--------|------|------|
| PI（主要研究者） | admin | admin123 | 全部功能：创建/修改/删除研究项目、受试者、用户管理、导入/导出 |
| CRC（研究协调员） | crc | crc123 | 只读 + 录入实际访视日期、查看提醒/日历/偏离 |
 
- 未登录的访客只能查看公开数据；
- 写操作（POST/PUT/DELETE）需要 Authorization: Bearer <token>；
- PI 专属接口（如创建研究项目、创建用户）对 CRC 返回 403。
 
## 主要功能与对应 API
 
| 功能 | 方法 | 路径 | 鉴权 |
|------|------|------|------|
| 健康检查 | GET | /api/health | 否 |
| 登录 | POST | /api/auth/login | 否 |
| 当前用户 | GET | /api/auth/me | 是 |
| 用户管理 | POST/GET | /api/users | PI |
| 研究项目 CRUD | GET/POST/PUT/DELETE | /api/studies[/:id] | 写需 PI |
| 受试者 CRUD | … | /api/studies/:id/subjects | 写需鉴权 |
| 生成访视计划 | POST | /api/subjects/:id/visits/generate | 是 |
| 回填实际日期 | POST | /api/visits/:id/fill-actual | 是 |
| 日历视图 | GET | /api/visits/calendar?start_date&end_date&study_id | 否 |
| 今日/明日/本周提醒 | GET | /api/reminders/today\|tomorrow\|week | 否 |
| 取消提醒（脱落） | POST | /api/subjects/:id/cancel-reminders | 是 |
| 方案偏离检测 | POST | /api/deviations/auto-detect | 是 |
| 偏离列表/汇总 | GET | /api/deviations[/:id] /summary | 否 |
| Excel 导入受试者 | POST | /api/studies/:id/import-subjects | 是 |
| Excel 导出受试者 | GET | /api/studies/:id/export/subjects | 是 |

## 访视窗口规则（示例）
 
入组日 D0 → 自动生成 10 个访视节点：
 
- 筛选期：D0，窗口 ±0
- C1～C6：每 21 天一次，窗口 ±3
- F1～F3：每 28 天一次，窗口 ±7
 
回填某访视「实际日期」后：
- 落在窗口内 → 状态置为「已完成」，并以该日期为基准重算后续访视计划；
- 超出窗口 → 状态置为「已偏离」，自动生成方案偏离记录。
 
## 测试
 
```bash
npm test                # 运行全部 154 个用例
npx jest tests/api.test.js   # 仅运行 API 集成测试
npm run test:coverage   # 覆盖率报告
```
 
测试使用独立的临时数据库（os.tmpdir()/followup-*-*/test.db），不会污染 data/followup.db。
 
## 常见问题
 
1. 端口被占用：修改 app.js 中的 PORT 或设置环境变量 PORT=3001 npm start。
2. 数据库锁定/损坏：停止服务后删除 data/followup.db，再执行 npm run init-db。
3. Node 版本提示 SQLite 实验性警告：可忽略；如需消除，使用 Node 22+ 并配合 --experimental-sqlite。
 
## 清理说明
 
项目根目录下历史遗留的无效文件 $null 已删除；data/ 目录仅保留运行期生成的 SQLite 数据库。
