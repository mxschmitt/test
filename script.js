// @ts-check
const playwright = require('playwright');

(async () => {
  // Try to add 'firefox' to the list ↓
  for (const browserType of ['chromium', 'webkit', 'firefox']) {
    /** @type {import('playwright').Browser} */
    const browser = await playwright[browserType].launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('http://whatsmyuseragent.org/');
    await page.screenshot({ path: `example-${browserType}.png` });
    await browser.close();
    console.log(`Done: ${browserType}`)
  }
})();