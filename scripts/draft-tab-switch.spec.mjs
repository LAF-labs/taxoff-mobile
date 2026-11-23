import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { it } from 'node:test';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const base = process.env.GALLERY_URL ?? 'http://localhost:4173/';
const evidence = process.env.DRAFT_SCREENSHOTS;

it('keeps the confirmed invoice draft amount and item when returning to Home', async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN });
  try {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, colorScheme: 'light' });
    const card = page.getByTestId('chat-card');
    const amount = '987,654원';
    const item = '디자인 용역';
    const assertConfirmed = async () => {
      const text = await card.innerText();
      assert.deepEqual(
        { amount: text.includes(amount), item: text.includes(item) },
        { amount: true, item: true },
        text,
      );
    };

    await page.goto(new URL('?s=issue-card', base).href);
    await card.getByRole('button', { name: '수정' }).click();
    await card.getByTestId('card-amount').fill('987654');
    await card.getByTestId('card-item').fill(item);
    await card.getByRole('button', { name: '완료' }).click();
    await card.getByRole('button', { name: '수정' }).waitFor();
    await assertConfirmed();
    if (evidence) await page.screenshot({ path: `${evidence}-confirmed.png` });

    await page.getByRole('tab', { name: '돈' }).click();
    await page.getByTestId('money').waitFor();
    await page.getByRole('tab', { name: '홈, 대화' }).click();
    await card.waitFor();
    if (evidence) await page.screenshot({ path: `${evidence}-returned.png` });
    await assertConfirmed();
  } finally {
    await browser.close();
  }
});
