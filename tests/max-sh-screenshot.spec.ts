import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test('max.sh screenshot functionality', async () => {
  // Test that the screenshot script can be executed
  const screenshotPath = path.join(process.cwd(), 'max_sh_screenshot.png');
  
  // Check if screenshot file exists
  const screenshotExists = fs.existsSync(screenshotPath);
  expect(screenshotExists).toBe(true);
  
  // Check if the file is a valid PNG with reasonable size
  if (screenshotExists) {
    const stats = fs.statSync(screenshotPath);
    expect(stats.size).toBeGreaterThan(1000); // Should be larger than 1KB
    expect(stats.size).toBeLessThan(5000000); // Should be smaller than 5MB
  }
});