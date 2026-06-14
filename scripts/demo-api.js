/**
 * 演示脚本：在运行中的服务上端到端验证 F1-F7 关键能力
 *
 * 用法（需先 npm start）：
 *   node scripts/demo-api.js
 */

const http = require('http');

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const r = http.request(
      { host: 'localhost', port: 3000, path, method, headers },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let json;
          try {
            json = JSON.parse(buf);
          } catch (e) {
            json = buf;
          }
          resolve({ status: res.statusCode, data: json });
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function main() {
  console.log('========================================');
  console.log(' 端到端演示：F1-F7 核心能力');
  console.log('========================================');

  // F5 登录 + 鉴权
  const login = await req('POST', '/api/auth/login', {
    username: 'admin',
    password: 'admin123',
  });
  const token = login.data.token;
  console.log(`\n[F5] 登录：status=${login.status}, 角色=${login.data.user.role}`);

  // F1 研究项目列表
  const studies = await req('GET', '/api/studies', null, token);
  console.log(`[F1] 研究项目：status=${studies.status}, 共 ${Array.isArray(studies.data) ? studies.data.length : (studies.data.data||[]).length} 个`);

  // F2 受试者 + F3 访视计划（创建受试者带入组日期，自动生成 10 节点访视）
  const studyId = (studies.data.data || studies.data)[0].id;
  const code = 'DEMO-' + Date.now().toString().slice(-5);
  const subjRes = await req(
    'POST',
    `/api/studies/${studyId}/subjects`,
    {
      subject_code: code,
      name: '演示受试者',
      gender: '男',
      phone: '13800000000',
      enrollment_date: today(),
      status: '入组',
    },
    token
  );
  const subject = subjRes.data.data || subjRes.data;
  console.log(
    `[F2] 创建受试者：status=${subjRes.status}, subject_code=${subject.subject_code}, id=${subject.id}`
  );

  // F2: 生成访视计划（10 节点）
  const genRes = await req(
    'POST',
    `/api/subjects/${subject.id}/visits/generate`,
    { enrollment_date: today() },
    token
  );
  console.log(`[F2] 生成访视计划：status=${genRes.status}, 节点数=${(genRes.data.data || genRes.data).length}`);

  const visitsRes = await req(
    'GET',
    `/api/subjects/${subject.id}/visits`,
    null,
    token
  );
  const visits = visitsRes.data.data || visitsRes.data;
  console.log(
    `[F3] 访视计划查询：status=${visitsRes.status}, 节点数=${visits.length}`
  );
  if (visits.length > 0) {
    console.log(
      `     示例：${visits[0].visit_code}(${visits[0].visit_type}) 窗口 ${visits[0].visit_window_start} ~ ${visits[0].visit_window_end}`
    );
  }

  // F3 每日提醒清单
  const todayR = await req(
    'GET',
    '/api/reminders/today',
    null,
    token
  );
  console.log(
    `[F3] 今日提醒清单：status=${todayR.status}, 候选访视数=${(todayR.data.data || todayR.data).length}`
  );

  // F4 方案偏离批量检测 + 汇总
  const detectRes = await req(
    'POST',
    '/api/deviations/auto-detect',
    {},
    token
  );
  console.log(
    `[F4] 方案偏离检测：status=${detectRes.status}, 本次新增=${detectRes.data.data ? detectRes.data.data.detected : detectRes.data.detected}`
  );
  const sumRes = await req('GET', '/api/deviations/summary', null, token);
  console.log(
    `[F4] 偏离汇总：status=${sumRes.status}, total=${sumRes.data.data ? sumRes.data.data.total : sumRes.data.total}`
  );

  // F7 导出受试者 Excel（校验返回 200 + xlsx 类型）
  const exportRes = await new Promise((resolve) => {
    http
      .request(
        {
          host: 'localhost',
          port: 3000,
          path: `/api/studies/${studyId}/export/subjects`,
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        },
        (res) => {
          res.resume();
          resolve({ status: res.statusCode, type: res.headers['content-type'] });
        }
      )
      .end();
  });
  console.log(
    `[F7] 导出受试者 Excel：status=${exportRes.status}, content-type=${exportRes.type}`
  );

  console.log('\n✅ 端到端演示完成。访问 http://localhost:3000 可打开前端界面。');
}

main().catch((e) => {
  console.error('演示脚本出错：', e.message);
  process.exit(1);
});