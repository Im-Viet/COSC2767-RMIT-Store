const { test, expect } = require('@playwright/test');

test('Shop page renders product cards with names and prices', async ({ page }) => {
  await page.goto('/shop');
  
  // Wait for the page to be fully loaded and API calls to complete
  await page.waitForLoadState('networkidle');
  
  // Wait for product list to be visible first
  await page.waitForSelector('.product-list', { timeout: 30000 });
  
  // Wait for at least one product item to be fully loaded
  await page.waitForFunction(() => {
    const itemNames = document.querySelectorAll('.product-list .item-name');
    return itemNames.length > 0 && itemNames[0].textContent.trim().length > 0;
  }, { timeout: 30000 });
  
  const names = await page.locator('.product-list .item-name').allTextContents();
  expect(names.length).toBeGreaterThan(0);
  // Check at least one price element renders
  const priceCount = await page.locator('.product-list .price').count();
  expect(priceCount).toBeGreaterThan(0);
});
