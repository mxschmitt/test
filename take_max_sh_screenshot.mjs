import puppeteer from 'puppeteer';

(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: '/usr/bin/google-chrome',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--ignore-certificate-errors',
        '--ignore-ssl-errors',
        '--ignore-certificate-errors-spki-list'
      ]
    });
    
    const page = await browser.newPage();
    await page.setViewport({
      width: 1200,
      height: 800,
    });
    
    console.log('Navigating to https://max.sh...');
    await page.goto('https://max.sh', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    console.log('Taking screenshot...');
    await page.screenshot({
      path: 'max_sh_screenshot.png',
      fullPage: true
    });
    
    console.log('Screenshot saved as max_sh_screenshot.png');
    await browser.close();
  } catch (error) {
    console.error('Error taking screenshot:', error);
    process.exit(1);
  }
})();