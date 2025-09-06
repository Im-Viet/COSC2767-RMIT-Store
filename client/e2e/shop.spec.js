const { test, expect } = require('@playwright/test');

test('Shop page renders product cards with names and prices', async ({ page }) => {
  await page.goto('/shop');
  await page.waitForSelector('.product-list .item-name');
  const names = await page.locator('.product-list .item-name').allTextContents();
  expect(names.length).toBeGreaterThan(0);
  // Check at least one price element renders
  const priceCount = await page.locator('.product-list .price').count();
  expect(priceCount).toBeGreaterThan(0);
});
