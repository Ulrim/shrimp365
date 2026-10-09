// 장비 터치스크린(app/kiosk.py) 화면 점검 — pytest 가 못 보는 것만 본다.
//
// pytest 는 /api/state 가 무엇을 주는지까지만 확인한다. 그 값으로 화면이
// 무엇을 그리는지(어떤 문구가 뜨는지, 800×480 을 넘치지 않는지)는 브라우저가
// 있어야 알 수 있다. 실제로 이 점검이 두 가지를 잡아냈다.
//
//   · 연결 전 장비에 "카메라가 아직 시작되지 않았습니다" 가 그대로 남던 것
//     (화면 모드만 보고 문구를 갱신하지 않아, 첫 화면에서 안내가 틀렸다)
//   · 추이 그래프의 최대·최소 눈금이 선과 겹쳐 읽히지 않던 것
//
// 서버를 띄우지 않는다. /api/state 와 /frame.jpg 를 가로채 고정된 값을 주므로
// 결과가 흔들리지 않는다.
//
// 실행 (저장소 루트에서, node 와 크로미움이 있을 때):
//
//     node vision/tests/ui/check_kiosk_screens.js
//     CHROMIUM=/path/to/chrome node vision/tests/ui/check_kiosk_screens.js
//
// CI 에는 넣지 않았다 — 브라우저가 필요해 pytest 와 함께 돌릴 수 없다.
// 화면(PAGE_HTML)을 고쳤다면 손으로 한 번 돌려 보라.

const { chromium } = require('playwright-core');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const VISION = path.resolve(__dirname, '../..');
const OUT = process.env.OUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'kiosk-ui-'));
const CHROMIUM = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// 화면 HTML 은 파이썬 모듈 안에 있다. 복사해 두면 어긋나므로 그때그때 꺼낸다.
const PY = fs.existsSync(path.join(VISION, '.venv/bin/python'))
  ? path.join(VISION, '.venv/bin/python')
  : 'python3';
const HTML = execFileSync(PY, ['-c', 'from app.kiosk import PAGE_HTML; print(PAGE_HTML)'], {
  cwd: VISION,
  // 설정 점검이 생긴 뒤로 DATABASE_URL 하나로는 모자란다 — 셋 다 없으면
  // 모듈을 불러오는 자리에서 멈춰 HTML 대신 안내문이 나온다.
  // 설정이 0개가 된 뒤로는 아무것도 넣어 줄 필요가 없다. 기기 키 자리만
  // 임시로 돌려 둔다 — 이 기계에 서비스가 깔려 있으면 진짜 키를 읽는다.
  env: { ...process.env, DEVICE_STATE_PATH: '/tmp/kiosk-ui-check/device.json' },
  maxBuffer: 1 << 24,
}).toString();

// 1×1 회색 JPEG — 영상 자리를 채우기만 하면 된다.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');

const base = {
  version: '1.0.0', camera: null, count: null, count_age: null, confidence: null,
  history: [], simulation: false, simulation_reason: null, server_ok: null, pending_uploads: 0,
  pairing: { status: 'idle', code: null, error: null, tank_name: null,
             camera_id: null, expires_in: null, serial: '100000001a2b3c4d', linked: false },
  public_url: null, model: 'shrimp_yolov8n_416.onnx', conf_threshold: 0.3,
};
const linked = { ...base.pairing, linked: true, tank_name: 'A-1조' };
const hist = (n, c) => Array.from({ length: n }, (_, i) =>
  [Math.floor(Date.now() / 1000) - (n - i) * 5,
   Math.max(0, Math.round(c + Math.sin(i / 7) * c * 0.08 + (i % 5 - 2)))]);

const scenes = {
  // 정상 — 세고 있는 중
  running: [{ ...base,
    camera: { id: 'x', name: 'A-1조 수중 카메라', status: 'running', type: 'csi' },
    count: 131, count_age: 2, confidence: 0.55, history: hist(300, 131),
    server_ok: true, pairing: linked },
    { want: ['#live'], text: ['131', '마리', 'A-1조', 'v1.0.0'] }],

  // 원격 업데이트가 되돌려진 장비 — 농장에서 눈으로 알아볼 수 있어야 한다.
  // 서비스는 멀쩡히(이전 버전으로) 돌고 측정도 계속되므로, 이 표시가 없으면
  // 옛 버전으로 도는 파이가 조용히 남는다.
  rolledback: [{ ...base,
    camera: { id: 'x', name: 'A-1조 수중 카메라', status: 'running', type: 'csi' },
    count: 131, count_age: 2, confidence: 0.55, history: hist(300, 131),
    server_ok: true, pairing: linked,
    update: { status: 'rolled_back', version: '1.0.0',
              message: '재시작 후 자리를 잡지 못했습니다', at: 1760000000 } },
    { want: ['#live', '.warn'], text: ['v1.0.0', '업데이트 되돌림'] }],

  // 잘 올라간 경우에는 아무 말도 덧붙이지 않는다. 늘 무언가 떠 있으면
  // 정작 문제가 생겼을 때 눈에 띄지 않는다.
  updated: [{ ...base,
    camera: { id: 'x', name: 'A-1조 수중 카메라', status: 'running', type: 'csi' },
    count: 131, count_age: 2, confidence: 0.55, history: hist(300, 131),
    server_ok: true, pairing: linked, version: '1.1.0',
    update: { status: 'applied', version: '1.1.0', message: '정상', at: 1760000000 } },
    { want: ['#live'], text: ['v1.1.0'], absent: ['업데이트 되돌림', '업데이트 거부됨'] }],

  // 설치 직후 — 무엇을 해야 하는지가 화면 한가운데 있어야 한다
  unpaired: [{ ...base },
    { want: ['#camempty', '.cta button'],
      text: ['이 카메라를 수조에 연결하세요', '기기 연결 시작', '100000001a2b3c4d'] }],

  // 카메라는 등록됐는데 프레임이 끊김 + 서버도 못 닿음
  offline: [{ ...base,
    camera: { id: 'x', name: 'A-1조 수중 카메라', status: 'offline', type: 'csi' },
    count: 118, count_age: 94, confidence: 0.51, history: hist(200, 118),
    server_ok: false, pending_uploads: 37, pairing: linked },
    { want: ['#camempty'],
      text: ['카메라에서 신호가 오지 않습니다', '서버 끊김 · 37건 보관', '94초 전 값'] }],

  // 가짜 개체수 — 숨기면 안 된다
  simulation: [{ ...base,
    camera: { id: 'x', name: 'A-1조 수중 카메라', status: 'running', type: 'csi' },
    count: 24, count_age: 1, confidence: 0.9, history: hist(120, 24),
    simulation: true,
    simulation_reason: '모델 파일이 없습니다: ./ai/models/shrimp_yolov8n.pt (MODEL_PATH 를 .onnx 파일의 실제 경로로 지정하세요)',
    server_ok: true, pairing: linked },
    { want: ['.simbar'], text: ['이 개체수는 가짜입니다', 'MODEL_PATH'] }],

  // 코드 대기
  pairing: [{ ...base,
    pairing: { ...base.pairing, status: 'waiting', code: '482917', expires_in: 741 } },
    { want: ['.overlay', '.code'], text: ['4 8 2 9 1 7', '12분 21초 남음'] }],

  // 코드를 못 받음 — 사유가 화면에 보여야 한다
  pairfail: [{ ...base,
    pairing: { ...base.pairing, status: 'failed', error: '인터넷 연결을 확인하세요' } },
    { want: ['.overlay'], text: ['연결 코드를 받지 못했습니다', '인터넷 연결을 확인하세요'] }],
};

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  let bad = 0;
  for (const [name, [state, check]] of Object.entries(scenes)) {
    const p = await b.newPage({ viewport: { width: 800, height: 480 } });
    const errs = [];
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    p.on('pageerror', e => errs.push('pageerror: ' + e.message));

    // 상대경로 fetch 가 풀리려면 실제 origin 이 있어야 한다. about:blank 에
    // setContent 하면 /api/state 가 어디로도 가지 못해 화면이 빈 채로 통과한다.
    await p.route('**/api/state', r => r.fulfill({
      contentType: 'application/json', body: JSON.stringify(state) }));
    await p.route('**/frame.jpg*', r => r.fulfill({ contentType: 'image/jpeg', body: JPEG }));
    await p.route('**/favicon.ico', r => r.fulfill({ status: 204, body: '' }));
    await p.route('http://kiosk.test/', r => r.fulfill({
      contentType: 'text/html; charset=utf-8', body: HTML }));
    await p.goto('http://kiosk.test/', { waitUntil: 'load' });
    await p.waitForTimeout(1400);
    await p.screenshot({ path: path.join(OUT, `${name}.png`) });

    const problems = [];
    for (const sel of check.want) if (!(await p.$(sel))) problems.push(`없음: ${sel}`);
    const body = await p.evaluate(() => document.body.innerText);
    for (const t of check.text) if (!body.includes(t)) problems.push(`문구 없음: "${t}"`);
    // 없어야 하는 문구. "잘 됐을 때 조용한가" 는 "문제일 때 보이는가" 만큼
    // 중요하다 — 늘 무언가 떠 있으면 아무도 읽지 않게 된다.
    for (const t of (check.absent || [])) {
      if (body.includes(t)) problems.push(`없어야 할 문구: "${t}"`);
    }
    const h = await p.evaluate(() => document.body.scrollHeight);
    if (h > 480) problems.push(`세로 넘침: ${h}px (화면은 480 이다)`);
    if (errs.length) problems.push(`콘솔: ${errs.join('; ')}`);

    if (problems.length) { bad++; console.log(`✗ ${name.padEnd(11)} ${problems.join(' | ')}`); }
    else console.log(`✓ ${name.padEnd(11)} 통과`);
    await p.close();
  }
  await b.close();
  console.log(`\n화면 그림: ${OUT}`);
  console.log(bad ? `${bad}개 장면 실패` : '모든 장면 통과');
  process.exit(bad ? 1 : 0);
})();
