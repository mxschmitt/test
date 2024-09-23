import puppeteer from 'puppeteer';
import { pathToFileURL } from 'url';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
  });
  const page = await browser.newPage();
  await page.setViewport({
    width: 500,
    height: 500,
  });
  await page.goto(pathToFileURL('canvas.html'));
  await page.screenshot({path: 'screenshot.png'});
  await browser.close();
})();