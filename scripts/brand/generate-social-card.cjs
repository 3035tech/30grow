/** Generate the 30Grow social preview from the official wordmark. */
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '../..');
const destination = path.join(root, 'public/brand/30grow-share.png');

const card = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#111827"/>
  <rect x="0" y="0" width="16" height="630" fill="#22C55E"/>
  <circle cx="1136" cy="66" r="220" fill="#172A30"/>
  <circle cx="1120" cy="70" r="152" fill="#1B3939"/>
  <text x="72" y="260" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="700" fill="#FFFFFF">Pessoas crescem.</text>
  <text x="72" y="346" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="700" fill="#FFFFFF">Empresas vão mais longe.</text>
  <text x="74" y="413" font-family="Arial, Helvetica, sans-serif" font-size="31" fill="#CBD5E1">Recrutamento, perfil de trabalho e gestão de pessoas.</text>
  <rect x="72" y="488" width="326" height="64" rx="32" fill="#22C55E"/>
  <text x="99" y="530" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" fill="#111827">Teste grátis por 30 dias</text>
  <text x="970" y="530" font-family="Arial, Helvetica, sans-serif" font-size="25" fill="#CBD5E1">30grow.com</text>
</svg>`);

async function main() {
  const wordmark = await fs.readFile(path.join(root, 'public/brand/logo-wordmark-dark.svg'));
  await sharp(card)
    .composite([{ input: await sharp(wordmark).resize({ width: 275 }).png().toBuffer(), left: 72, top: 55 }])
    .png()
    .toFile(destination);
  console.log(destination);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
