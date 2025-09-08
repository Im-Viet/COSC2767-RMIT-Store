const { test, expect } = require('@playwright/test');

test('Debug: Application health check', async ({ page }) => {
  console.log('Starting application health check...');
  console.log('Base URL:', process.env.E2E_BASE_URL || 'http://localhost:8080');
  
  // Test that we can reach the homepage
  const response = await page.goto('/', { waitUntil: 'networkidle' });
  console.log('Homepage response status:', response.status());
  expect(response.status()).toBe(200);
  
  // Check page title
  const title = await page.title();
  console.log('Page title:', title);
  
  // Check if main elements are present
  const bodyText = await page.locator('body').textContent();
  console.log('Page contains text (first 200 chars):', bodyText.substring(0, 200));
  
  // Test API endpoint
  try {
    const apiResponse = await page.request.get('/api/product/list');
    console.log('API response status:', apiResponse.status());
    
    if (apiResponse.ok()) {
      const apiData = await apiResponse.json();
      console.log('API response:', JSON.stringify(apiData, null, 2));
    } else {
      console.log('API error - response not OK');
    }
  } catch (error) {
    console.log('API request failed:', error.message);
  }
  
  // Check if login page is accessible
  try {
    await page.goto('/login');
    const loginFormExists = await page.locator('form, .login-form').isVisible();
    console.log('Login form exists:', loginFormExists);
  } catch (error) {
    console.log('Could not access login page:', error.message);
  }
  
  // Check if shop page is accessible
  try {
    await page.goto('/shop');
    const shopPageLoaded = await page.locator('body').isVisible();
    console.log('Shop page loaded:', shopPageLoaded);
    
    // Check what's on the shop page
    const shopContent = await page.locator('body').textContent();
    console.log('Shop page content preview:', shopContent.substring(0, 300));
  } catch (error) {
    console.log('Could not access shop page:', error.message);
  }
});
