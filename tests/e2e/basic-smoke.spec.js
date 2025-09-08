const { test, expect } = require('@playwright/test');

test('Homepage loads successfully', async ({ page }) => {
  await page.goto('/');
  
  // Wait for the page to be fully loaded
  await page.waitForLoadState('networkidle');
  
  // Check that the page title contains expected text (adjust as needed)
  await expect(page).toHaveTitle(/RMIT Store|Home/i);
  
  // Check that the main navigation is present
  await expect(page.locator('nav, .navigation, .navbar')).toBeVisible();
});

test('API health check', async ({ page }) => {
  const response = await page.request.get('/api/product/list');
  
  // API should respond with 200 status
  expect(response.status()).toBe(200);
  
  const body = await response.json();
  
  // Should have the expected structure regardless of content
  expect(body).toHaveProperty('products');
  expect(body).toHaveProperty('totalPages');
  expect(body).toHaveProperty('currentPage');
  expect(body).toHaveProperty('count');
  
  // Products array should exist (may be empty)
  expect(Array.isArray(body.products)).toBe(true);
});

test('Shop page loads and renders correctly', async ({ page }) => {
  await page.goto('/shop');
  
  // Wait for the page to be fully loaded
  await page.waitForLoadState('networkidle');
  
  // Check that we're on the shop page
  expect(page.url()).toMatch(/\/shop\/?$/);
  
  // Should either show products or a "no products" message
  const hasProducts = await page.locator('.product-list').isVisible();
  const hasNoProductsMessage = await page.locator('text=No products found').isVisible();
  
  // One of these should be true
  expect(hasProducts || hasNoProductsMessage).toBe(true);
  
  if (hasProducts) {
    console.log('Shop page: Products found and displayed');
  } else {
    console.log('Shop page: No products message displayed (empty database)');
  }
});
