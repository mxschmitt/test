import { test, expect } from '@playwright/test';

test('take screenshot of max.sh', async ({ page }) => {
  try {
    // Navigate to max.sh
    await page.goto('https://max.sh', { waitUntil: 'domcontentloaded' });
    
    // Take screenshot
    await page.screenshot({ path: 'max-sh-screenshot.png', fullPage: true });
    
    console.log('Screenshot saved as max-sh-screenshot.png');
    
  } catch (error) {
    console.error('Error accessing max.sh:', error);
    
    // Check if it's a blocked domain error
    if (error.message.includes('ERR_BLOCKED_BY_CLIENT')) {
      console.log('The domain max.sh is blocked in this environment');
      
      // Take a screenshot of the error page as proof
      await page.screenshot({ path: 'max-sh-blocked-error.png', fullPage: true });
      console.log('Screenshot of blocked page saved as max-sh-blocked-error.png');
    }
    
    // Re-throw the error to make the test fail with proper error reporting
    throw error;
  }
});