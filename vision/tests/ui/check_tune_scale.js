// 길이 기준 잡기(먹이망 격자) 점검.
//
//     node vision/tests/ui/check_tune_scale.js
//
// 여기서만 잡히는 것: 화면에 그린 네모를 **원본 프레임 픽셀**로 환산하는 부분.
// 화면에 그려진 크기 그대로 보내면 모니터 해상도가 바뀔 때 축척이 통째로
// 틀어지는데, 숫자는 그럴듯해 보여서 눈으로는 모른다.
const { chromium } = require('playwright-core');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const VISION = path.resolve(__dirname, '../..');
const CHROMIUM = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PY = fs.existsSync(path.join(VISION, '.venv/bin/python'))
  ? path.join(VISION, '.venv/bin/python') : 'python3';
const HTML = execFileSync(PY, ['-c', 'from app.kiosk import PAGE_HTML; print(PAGE_HTML)'], {
  cwd: VISION, env: { ...process.env, DEVICE_STATE_PATH: '/tmp/kiosk-ui-check/device.json' },
  maxBuffer: 1 << 24,
}).toString();

// 원본 640x360. 화면(800x480)에 넣으면 축소되어 그려지므로, 화면 픽셀과
// 원본 픽셀이 다르다 — 그 차이를 처리하는지 보는 것이 이 점검의 핵심이다.
const FRAME_W = 640, FRAME_H = 360;
const JPEG = Buffer.from(execFileSync(PY, ['-c',
  'import base64,io;from PIL import Image;' +
  `b=io.BytesIO();Image.new("RGB",(${FRAME_W},${FRAME_H}),(40,60,90)).save(b,"JPEG");` +
  'print(base64.b64encode(b.getvalue()).decode())'
], { cwd: VISION }).toString().trim(), 'base64');

const state = {
  version: '1.0.0',
  camera: { id: 'c1', name: 'A-1조 수중 카메라', status: 'running', type: 'picamera' },
  count: 8, count_age: 1, confidence: 0.65, history: [], simulation: false,
  simulation_reason: null, server_ok: true, pending_uploads: 0, length_cm: 12.4,
  pairing: { status: 'idle', code: null, error: null, tank_name: 'A-1조', camera_id: 'c1',
             expires_in: null, serial: '1000', linked: true },
  public_url: null, model: 'm.onnx', conf_threshold: 0.3,
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
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ saved: true }) });
    }
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(
      { camera: 'c1', roi: null, min_conf: null, base_conf: 0.3, px_per_cm: null, cell_cm: [8, 7.5] }) });
  });
  await p.route('http://kiosk.test/', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: HTML }));
  await p.goto('http://kiosk.test/', { waitUntil: 'load' });
  await p.waitForTimeout(1200);

  const problems = [];
  // 본 화면에 추정 체장이 보여야 한다
  const main = await p.evaluate(() => document.body.innerText);
  if (!main.includes('추정 체장 12.4cm')) problems.push('본 화면에 추정 체장이 없다');

  await p.click('#tunebtn'); await p.waitForTimeout(500);
  await p.click('#tswap'); await p.waitForTimeout(400);   // 길이 기준 모드로

  const head = await p.evaluate(() => document.body.innerText);
  for (const t of ['길이 기준 잡기', '덮은 칸', '8 × 7.5 cm'])
    if (!head.includes(t)) problems.push(`문구 없음: ${t}`);

  // 가로 절반 × 세로 절반을 덮는다 → 원본 320 x 180 픽셀
  const r = await p.evaluate(() => {
    const s = document.getElementById('tstage').getBoundingClientRect();
    const i = document.getElementById('timg').getBoundingClientRect();
    return { x: i.left, y: i.top, w: i.width, h: i.height, sw: s.width };
  });
  await p.mouse.move(r.x + r.w * 0.25, r.y + r.h * 0.25);
  await p.mouse.down();
  await p.mouse.move(r.x + r.w * 0.75, r.y + r.h * 0.75, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(300);

  if (!(await p.$('#tune .calbox'))) problems.push('기준 네모가 안 보인다');

  // 덮은 칸을 4 × 3 으로 적는다
  await p.fill('#tcx', '4');
  await p.fill('#tcy', '3');
  await p.waitForTimeout(300);
  const preview = await p.evaluate(() => document.getElementById('tscale').textContent);
  if (!/px·cm/.test(preview || '')) problems.push('축척 미리보기가 없다: ' + preview);

  await p.screenshot({ path: '/tmp/tune-scale.png' });
  await p.click('#tune button.primary');
  await p.waitForTimeout(400);

  if (!posted || !posted.calibration) problems.push('축척이 저장으로 안 갔다');
  else {
    const c = posted.calibration;
    // 원본 640x360 의 절반 = 320 x 180. 여유 5%.
    if (Math.abs(c.w_px - FRAME_W * 0.5) > FRAME_W * 0.05)
      problems.push(`가로 픽셀이 원본 기준이 아니다: ${c.w_px.toFixed(0)} (기대 ${FRAME_W * 0.5})`);
    if (Math.abs(c.h_px - FRAME_H * 0.5) > FRAME_H * 0.05)
      problems.push(`세로 픽셀이 원본 기준이 아니다: ${c.h_px.toFixed(0)} (기대 ${FRAME_H * 0.5})`);
    if (c.cells_x !== 4 || c.cells_y !== 3)
      problems.push(`칸 수가 안 갔다: ${c.cells_x}x${c.cells_y}`);
    // 화면 픽셀을 그대로 보냈다면 가로가 400 근처로 나온다 — 그 사고를 집어낸다
    if (Math.abs(c.w_px - r.w * 0.5) < 5 && Math.abs(FRAME_W * 0.5 - r.w * 0.5) > 10)
      problems.push('화면 픽셀을 그대로 보냈다(원본 환산 누락)');
  }
  if (errs.length) problems.push('콘솔: ' + errs.join('; '));

  console.log(problems.length ? '✗ ' + problems.join('\n✗ ') : '✓ 길이 기준 통과 — 원본 프레임 픽셀로 저장됨');
  await b.close();
  process.exit(problems.length ? 1 : 0);
})();
