// 범위 설정(관심영역) 화면 점검 — 손가락으로 긋는 동작은 브라우저가 있어야 안다.
//
//     node vision/tests/ui/check_tune_roi.js
//
// pytest 는 거르는 계산(app/services/tuning.py)까지만 본다. 그 값을 **사람이
// 어떻게 입력하는가** 는 여기서만 확인된다. 네모가 안 그어지면 거르는 계산이
// 아무리 옳아도 쓸 수 없다.
//
// 좌표는 이미지가 실제로 그려진 사각형 기준이어야 한다. 무대(stage) 기준으로
// 재면 레터박스(남는 여백)만큼 어긋나, 화면에서 그은 자리와 실제로 세는 자리가
// 달라진다 — 눈으로는 알아채기 어려운 어긋남이다.
const { chromium } = require('playwright-core');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const VISION = path.resolve(__dirname, '../..');
const CHROMIUM = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PY = fs.existsSync(path.join(VISION, '.venv/bin/python'))
  ? path.join(VISION, '.venv/bin/python') : 'python3';
const HTML = execFileSync(PY, ['-c', 'from app.kiosk import PAGE_HTML; print(PAGE_HTML)'], {
  cwd: VISION,
  env: { ...process.env, DEVICE_STATE_PATH: '/tmp/kiosk-ui-check/device.json' },
  maxBuffer: 1 << 24,
}).toString();

// 가로로 긴 가짜 프레임(16:9). 화면(800x480)보다 납작해 **세로 여백**이 생기고,
// 그래야 레터박스를 빼는 좌표 계산이 실제로 검증된다. 1x1 로는 그을 수가 없다.
const JPEG = Buffer.from(execFileSync(PY, ['-c',
  'import base64,io;from PIL import Image;' +
  'b=io.BytesIO();Image.new("RGB",(640,360),(40,60,90)).save(b,"JPEG");' +
  'print(base64.b64encode(b.getvalue()).decode())'
], { cwd: VISION }).toString().trim(), 'base64');

const state = {
  version: '1.0.0',
  camera: { id: 'c1', name: 'A-1조 수중 카메라', status: 'running', type: 'picamera' },
  count: 8, count_age: 1, confidence: 0.65, history: [], simulation: false,
  simulation_reason: null, server_ok: true, pending_uploads: 0,
  pairing: { status: 'idle', code: null, error: null, tank_name: 'A-1조', camera_id: 'c1',
             expires_in: null, serial: '1000', linked: true },
  public_url: null, model: 'shrimp_yolov8n_416.onnx', conf_threshold: 0.3,
};

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--no-proxy-server'] });
  const p = await b.newPage({ viewport: { width: 800, height: 480 }, hasTouch: true });
  const errs = [];
  let posted = null;
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await p.route('**/api/state', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(state) }));
  await p.route('**/frame.jpg*', r => r.fulfill({ contentType: 'image/jpeg', body: JPEG }));
  await p.route('**/favicon.ico', r => r.fulfill({ status: 204, body: '' }));
  await p.route('**/api/tuning', r => {
    if (r.request().method() === 'POST') {
      posted = JSON.parse(r.request().postData() || '{}');
      return r.fulfill({ contentType: 'application/json',
        body: JSON.stringify({ saved: true, roi: posted.roi, min_conf: posted.min_conf }) });
    }
    r.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ camera: 'c1', roi: null, min_conf: null, base_conf: 0.3 }) });
  });
  await p.route('http://kiosk.test/', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: HTML }));
  await p.goto('http://kiosk.test/', { waitUntil: 'load' });
  await p.waitForTimeout(1200);

  const problems = [];
  const btn = await p.$('#tunebtn');
  if (!btn) problems.push('범위 설정 버튼이 없다');
  else {
    await btn.click();
    await p.waitForTimeout(600);
    if (!(await p.$('#tune'))) problems.push('범위 설정 화면이 안 열린다');
    else {
      const body = await p.evaluate(() => document.body.innerText);
      for (const t of ['세는 범위', '최소 신뢰도', '저장', '전체로'])
        if (!body.includes(t)) problems.push(`문구 없음: ${t}`);

      // 이미지가 그려진 사각형의 가운데 절반을 긋는다.
      const r = await p.evaluate(() => {
        const s = document.getElementById('tstage').getBoundingClientRect();
        const i = document.getElementById('timg').getBoundingClientRect();
        return { sx: s.left, sy: s.top, x: i.left, y: i.top, w: i.width, h: i.height };
      });
      if (r.w < 2 || r.h < 2) problems.push(`영상이 안 그려졌다 (${r.w}x${r.h})`);
      await p.mouse.move(r.x + r.w * 0.25, r.y + r.h * 0.25);
      await p.mouse.down();
      await p.mouse.move(r.x + r.w * 0.75, r.y + r.h * 0.75, { steps: 8 });
      await p.mouse.up();
      await p.waitForTimeout(300);

      if (!(await p.$('#tune .box'))) problems.push('그었는데 네모가 안 보인다');
      if ((await p.$$('#tune .shade')).length === 0) problems.push('바깥이 어두워지지 않는다');

      await p.screenshot({ path: '/tmp/tune-roi.png' });
      await p.click('#tune button.primary');
      await p.waitForTimeout(400);
      if (!posted) problems.push('저장이 서버로 안 갔다');
      else {
        const roi = posted.roi || [];
        if (roi.length !== 4) problems.push('보낸 네모가 4칸이 아니다: ' + JSON.stringify(roi));
        else {
          // 그은 자리(0.25~0.75)와 보낸 값이 맞아야 한다. 여유 0.05.
          const want = [0.25, 0.25, 0.75, 0.75];
          for (let i = 0; i < 4; i++)
            if (Math.abs(roi[i] - want[i]) > 0.05)
              problems.push(`좌표 어긋남 [${i}]: ${roi[i].toFixed(3)} (기대 ${want[i]})`);
        }
        if (typeof posted.min_conf !== 'number') problems.push('신뢰도가 안 갔다');
      }
      if (await p.$('#tune')) problems.push('저장 뒤에도 화면이 안 닫힌다');
    }
  }
  if (errs.length) problems.push('콘솔: ' + errs.join('; '));

  console.log(problems.length ? '✗ ' + problems.join('\n✗ ') : '✓ 범위 설정 통과 — 그은 자리와 보낸 값이 일치');
  await b.close();
  process.exit(problems.length ? 1 : 0);
})();
