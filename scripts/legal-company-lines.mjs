/** @typedef {{ name: string; number: string; registered_office: string; privacy_email: string; ico_registration?: string | null }} CompanyFacts */

export const COMPANY_INFORMATION_PATH = '/company/';

/** @param {CompanyFacts} company */
export function companyPageMarkdown(company) {
  const office = String(company.registered_office).replace(/Berkshire,\s*/g, '');
  const registration = company.ico_registration ? String(company.ico_registration) : '';
  return `# Company information

${company.name}, registered in England & Wales, company no. ${company.number}.

Registered office: ${office}

Privacy contact: ${company.privacy_email}

ICO registration: ${registration}`;
}

/** @param {(text: string) => string} escape */
export function companyPageMainHtml(company, escape) {
  const office = String(company.registered_office).replace(/Berkshire,\s*/g, '');
  const registration = company.ico_registration ? String(company.ico_registration) : '';
  return `<h1>Company information</h1>
<p>${escape(company.name)}, registered in England &amp; Wales, company no. ${escape(company.number)}.</p>
<p>Registered office: ${escape(office)}</p>
<p>Privacy contact: <a href="mailto:${escape(company.privacy_email)}">${escape(company.privacy_email)}</a></p>
<p>ICO registration: ${escape(registration)}</p>`;
}

export function siteFooterHtml() {
  return `<footer aria-label="Legal and data controls"><p>© EUGNEL LTD · <a href="${COMPANY_INFORMATION_PATH}">Company information</a></p></footer>`;
}

/** Full trader details for pre-payment screens and paid order-confirmation email (not policy page bodies). */
/** @param {CompanyFacts} company */
export function companyTradingDisclosureText(company) {
  const office = String(company.registered_office).replace(/Berkshire,\s*/g, '');
  const registration = company.ico_registration ? String(company.ico_registration) : '';
  return `${company.name}, registered in England & Wales, company no. ${company.number}. Registered office: ${office}. Privacy: ${company.privacy_email}. ICO registration: ${registration}.`;
}
