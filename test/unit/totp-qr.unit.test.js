import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import QRCode from 'qrcode';
import { buildOtpAuthUrl } from '../../lib/identity/totp.js';

test('the TOTP setup URI can be rendered as a local QR Code', async () => {
  const uri = buildOtpAuthUrl({
    secret: 'JBSWY3DPEHPK3PXP',
    email: 'rh@example.com',
  });
  const dataUrl = await QRCode.toDataURL(uri, { width: 224, margin: 2 });

  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(dataUrl, /^data:image\/png;base64,/);
});

test('manager and employee profiles reuse the protected TOTP QR component', async () => {
  const [manager, employee, component] = await Promise.all([
    readFile(new URL('../../app/_components/ProfileTab.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../app/employee/profile/EmployeeProfileClient.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../app/_components/TotpQrCode.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(manager, /<TotpQrCode/);
  assert.match(employee, /<TotpQrCode/);
  assert.match(component, /QRCode\.toDataURL\(otpauthUrl/);
  assert.doesNotMatch(component, /fetch\(|https?:\/\//);
});
