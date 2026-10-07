const { test, expect } = require('@playwright/test');

for (const width of [1440, 390]) {
  test(`DP attachments use equal available width at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const documents = ['address_proof', 'bank_data', 'dependents'].map((docKey, index) => ({
      docKey, status: 'received', hasFile: true, signatureStatus: 'none',
      fileName: ['Comprovante_de_endereco_com_nome_muito_longo_para_validar_o_layout.pdf', 'NF.pdf', 'DIT (4).pdf'][index],
    }));
    await page.route('**/api/employee/dp', route => route.fulfill({ json: { profile: {}, documents, leaves: [], pendingDocs: 0 } }));
    await page.goto('/employee/dp');
    const downloads = page.getByRole('button', { name: /^Baixar arquivo:/ });
    await expect(downloads).toHaveCount(3);
    const cards = await downloads.evaluateAll(buttons => buttons.map(button => {
      const card = button.parentElement.parentElement;
      const rect = card.getBoundingClientRect();
      return { width: rect.width, left: rect.left, fits: card.scrollWidth <= card.clientWidth };
    }));
    expect(Math.max(...cards.map(card => card.width)) - Math.min(...cards.map(card => card.width))).toBeLessThan(1);
    expect(Math.max(...cards.map(card => card.left)) - Math.min(...cards.map(card => card.left))).toBeLessThan(1);
    expect(cards.every(card => card.fits)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`dp-attachments-${width}.png`), fullPage: true, animations: 'disabled' });
  });
}
