import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors']
  });
  const page = await browser.newPage();
  await page.setViewport({
    width: 1200,
    height: 800,
  });
  await page.goto('https://max.sh', { waitUntil: 'networkidle0' });
  await page.screenshot({path: 'screenshot.png'});
  await browser.close();
})();