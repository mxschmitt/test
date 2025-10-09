import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
  });
  const page = await browser.newPage();
  await page.setViewport({
    width: 500,
    height: 500,
  });
  await page.goto('https://playwright.dev/');
  await page.screenshot({path: 'foo.png'});
  await browser.close();
})();