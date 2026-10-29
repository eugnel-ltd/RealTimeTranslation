import { expect, it } from 'vitest';
import { companyTradingDisclosureText } from '../scripts/legal-company-lines.mjs';

it('exposes full trader disclosure text for any future checkout or order-confirmation email', () => {
  const disclosure = companyTradingDisclosureText({
    name: 'EUGNEL LTD', number: '17505169',
    registered_office: '122 New Road, Ascot, SL5 8QH',
    privacy_email: 'hello@eugnel.com', ico_registration: 'ZC277339',
  });
  expect(disclosure).toContain('17505169');
  expect(disclosure).toContain('122 New Road, Ascot, SL5 8QH');
  expect(disclosure).toContain('hello@eugnel.com');
  expect(disclosure).toContain('ZC277339');
});
