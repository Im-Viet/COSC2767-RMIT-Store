const { test, expect } = require('@playwright/test');

test('User can login and is redirected to dashboard', async ({ page }) => {
  await page.goto('/login');

  // Use more specific selector to target the login form email input only
  await page.locator('main input[name="email"]').fill(process.env.E2E_EMAIL || 'admin@rmit.edu.vn');
  await page.locator('main input[name="password"]').fill(process.env.E2E_PASSWORD || 'mypassword');
  await page.getByRole('button', { name: 'Sign In' }).click();

  // This app redirects authenticated users to /dashboard
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await expect(page).toHaveURL(/\/dashboard$/);
});
