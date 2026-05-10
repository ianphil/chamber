import { expect, test } from '@playwright/test';

test.describe('web app boot', () => {
  test('renders without console errors or a blank root', async ({ page }) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('requestfailed', (request) => {
      failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`.trim());
    });

    await page.goto('/?token=e2e-token');
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect(page.locator('body')).toContainText(/Chamber|Welcome|Sign in|Genesis|agent|mind/i);

    await expect.poll(() => consoleErrors, {
      message: `console errors: ${consoleErrors.join('\n')}`,
    }).toEqual([]);
    expect(failedRequests, `failed requests: ${failedRequests.join('\n')}`).toEqual([]);
  });
});
