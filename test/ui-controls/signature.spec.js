const { test, expect } = require('@playwright/test');

test('saved signature preview keeps separate strokes visible', async ({ page }) => {
  await page.goto('/signature');
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  for (const x of [60, 290]) {
    await page.mouse.move(box.x + x, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x + x + 70, box.y + 80, { steps: 12 });
    await page.mouse.up();
  }

  await page.getByRole('button', { name: 'Salvar' }).click();
  const preview = page.locator('figure img');
  await expect(preview).toBeVisible();
  const ink = await preview.evaluate((image) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const quarters = [0, 0, 0, 0];
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const index = (y * canvas.width + x) * 4;
        if (data[index] < 140 && data[index + 1] < 140 && data[index + 2] < 140) {
          quarters[Math.min(3, Math.floor(x / canvas.width * 4))]++;
        }
      }
    }
    return quarters;
  });
  expect(ink[0]).toBeGreaterThan(0);
  expect(ink[2]).toBeGreaterThan(0);
  expect((await preview.boundingBox()).height).toBeGreaterThan(80);
});
