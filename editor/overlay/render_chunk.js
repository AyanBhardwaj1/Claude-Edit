// Renders frames [f0,f1) of an overlay job to a transparent PNG-in-MOV via ffmpeg.
// usage: node render_chunk.js JOB.json OUT.mov f0 f1      (frame indices are global: t = i / fps)
//        node render_chunk.js --check                      (exit 0 when Playwright + Chromium start)
// JOB.json is written by editor/overlay/__init__.py: {width, height, scale, fps, theme, faces, elements}.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { once } = require('events');

function playwright() {
  // `playwright` from the usual node resolution (global installs, NODE_PATH), then playwright-core,
  // then the copy inside the Python playwright package (CLAUDE_EDIT_PLAYWRIGHT, set by the Python side)
  const tries = ['playwright', 'playwright-core', process.env.CLAUDE_EDIT_PLAYWRIGHT].filter(Boolean);
  for (const m of tries) {
    try { return require(m); } catch (e) { /* next */ }
  }
  console.error('[overlay] Node cannot find Playwright. Install it: npm i -g playwright && npx playwright install chromium');
  process.exit(3);
}

async function launch() {
  const { chromium } = playwright();
  try {
    return await chromium.launch({ args: ['--disable-gpu', '--font-render-hinting=none', '--force-color-profile=srgb', '--disable-lcd-text', '--allow-file-access-from-files'] });
  } catch (e) {
    console.error('[overlay] Chromium did not start (npx playwright install chromium): ' + String(e.message || e).split('\n')[0]);
    process.exit(4);
  }
}

(async () => {
  if (process.argv[2] === '--check') {
    const b = await launch();
    await b.close();
    console.log('ok');
    process.exit(0);
  }
  const [jobPath, outPath, f0s, f1s] = process.argv.slice(2);
  const f0 = +f0s, f1 = +f1s;
  const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
  const fps = job.fps || 30, scale = job.scale || 1;
  const browser = await launch();
  // the layout is in CSS px (= output px / scale); the capture clip's scale brings it to the output size
  const vw = Math.round(job.width), vh = Math.round(job.height);
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(__dirname, 'page.html'));
  const info = await page.evaluate(j => window.init(j), job);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  const shot = async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, captureBeyondViewport: false,
    ...(scale !== 1 ? { clip: { x: 0, y: 0, width: vw, height: vh, scale } } : {}) })).data, 'base64');

  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
    '-c:v', 'png', '-pix_fmt', 'rgba', '-r', String(fps), '-f', 'mov', outPath], { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = once(ff, 'close');

  // dedupe: an unchanged state key reuses the previous PNG; the empty frame is captured once
  let prevKey = null, prevBuf = null, emptyBuf = null, shots = 0;
  const t0 = Date.now();
  for (let i = f0; i < f1; i++) {
    const t = i / fps;
    const key = await page.evaluate(t => window.seek(t), t);
    let buf;
    if (key === prevKey && prevBuf) buf = prevBuf;
    else if (key === '' && emptyBuf) buf = emptyBuf;
    else { buf = await shot(); shots++; if (key === '') emptyBuf = buf; }
    prevKey = key; prevBuf = buf;
    if (!ff.stdin.write(buf)) await once(ff.stdin, 'drain');
  }
  ff.stdin.end();
  const [code] = await ffDone;
  await browser.close();
  const secs = (Date.now() - t0) / 1000;
  console.log(JSON.stringify({ frames: f1 - f0, shots, secs, code, fonts: info.fontsLoaded, warnings: info.errs }));
  process.exit(code === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
