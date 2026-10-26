// node scripts/render-covers.cjs: renders docs/cover/cover-{a,b}.html to PNG at 1600x1200, 1000x750 and a 400x300 preview.
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const docs = path.resolve(__dirname, '..', 'docs');
  const browser = await chromium.launch();
  for (const v of ['a', 'b']) {
    for (const [w, h, suffix, dir] of [[1600, 1200, '', docs], [1000, 750, '-1000x750', docs], [400, 300, '-preview', path.join(docs, 'cover')]]) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: w / 1600 });
      await page.goto('file://' + path.join(docs, 'cover', `cover-${v}.html`), { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(dir, `upwork-cover-${v}${suffix}.png`) });
      await page.close();
    }
  }
  await browser.close();
})();
