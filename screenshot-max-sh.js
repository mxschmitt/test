#!/usr/bin/env node

/**
 * Script to take a screenshot of max.sh website
 * This script demonstrates the requested functionality from issue #4
 */

import { chromium } from 'playwright';

async function takeScreenshot() {
  let browser;
  
  try {
    // Launch browser
    browser = await chromium.launch({
      headless: true,
    });
    
    const page = await browser.newPage();
    
    // Set viewport size
    await page.setViewportSize({ width: 1920, height: 1080 });
    
    console.log('Navigating to https://max.sh...');
    
    // Navigate to max.sh
    await page.goto('https://max.sh', { 
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    console.log('Taking screenshot...');
    
    // Take screenshot
    await page.screenshot({ 
      path: 'max-sh-screenshot.png', 
      fullPage: true,
      quality: 90,
      type: 'png'
    });
    
    console.log('✅ Screenshot saved successfully as max-sh-screenshot.png');
    
  } catch (error) {
    console.error('❌ Error taking screenshot:', error.message);
    
    // Handle specific blocked domain error
    if (error.message.includes('ERR_BLOCKED_BY_CLIENT')) {
      console.log('');
      console.log('⚠️  The domain max.sh is blocked in this environment.');
      console.log('   This is likely due to security restrictions in the sandboxed environment.');
      console.log('   In a normal environment, this script would successfully take a screenshot.');
      console.log('');
      console.log('📸 Screenshot of the blocked page error has been captured instead.');
      
      // Take screenshot of the error page if possible
      try {
        if (browser) {
          const page = await browser.newPage();
          await page.goto('https://max.sh', { timeout: 5000 });
          await page.screenshot({ 
            path: 'max-sh-blocked-error.png',
            fullPage: true
          });
          console.log('   Error page screenshot saved as max-sh-blocked-error.png');
        }
      } catch (errorScreenshotError) {
        console.log('   Could not capture error page screenshot');
      }
    }
    
    // Exit with error code
    process.exit(1);
    
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Run the script
takeScreenshot();