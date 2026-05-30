// One-off mobile snapshot helper. Drives headless Chrome at iPhone-sized
// viewports against the local Vite dev server and writes PNGs + an overflow
// report so we can spot horizontal-scroll regressions visually.
//
// Run: node .snapshots/snap.cjs
const path = require('path');
const fs = require('fs');

(async () => {
  const puppeteer = require('puppeteer-core');
  const chromePath =
    process.env.CHROME_PATH ||
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const routes = [
    { name: 'login', url: 'http://localhost:5173/login' },
    { name: 'signup', url: 'http://localhost:5173/signup' },
    { name: 'landing', url: 'http://localhost:5173/' },
    { name: 'pricing', url: 'http://localhost:5173/pricing' },
    { name: 'about', url: 'http://localhost:5173/about' },
  ];

  const viewport = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const outDir = path.join(__dirname);
  fs.mkdirSync(outDir, { recursive: true });

  const report = [];
  for (const r of routes) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    );
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`);
    });
    try {
      await page.goto(r.url, { waitUntil: 'networkidle0', timeout: 30000 });
    } catch (e) {
      errors.push(`[goto] ${e.message}`);
    }
    // Give React a beat for hydration / suspense.
    await new Promise((res) => setTimeout(res, 800));

    const overflow = await page.evaluate(() => ({
      docW: document.documentElement.scrollWidth,
      bodyW: document.body.scrollWidth,
      vpW: window.innerWidth,
      hasHorizontalScroll:
        document.documentElement.scrollWidth > window.innerWidth + 1,
    }));

    const file = path.join(outDir, `${r.name}-390.png`);
    await page.screenshot({ path: file, fullPage: true });

    report.push({ route: r.name, file, overflow, errors });
    await page.close();
  }

  await browser.close();
  fs.writeFileSync(
    path.join(outDir, 'report.json'),
    JSON.stringify(report, null, 2)
  );
  for (const r of report) {
    console.log(
      `${r.route.padEnd(10)} | scrollW=${r.overflow.docW} vp=${r.overflow.vpW} ${
        r.overflow.hasHorizontalScroll ? 'OVERFLOW' : 'ok'
      } | errors=${r.errors.length}`
    );
    if (r.errors.length) {
      r.errors.slice(0, 3).forEach((e) => console.log('   - ' + e));
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
