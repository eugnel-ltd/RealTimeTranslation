import { COMPANY_INFORMATION_PATH } from './legal-company-lines.mjs';

const COMPLAINTS_HEADING = '## Complaints';

/** @param {string} text */
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} html
 * @param {Record<string, unknown>} company
 */
export function stripCompanyIdentifiersFromPolicyHtml(html, company) {
  const office = String(company.registered_office).replace(/Berkshire,\s*/g, '');
  const number = String(company.number);
  let text = html.replace(/Berkshire,\s*/g, '');
  text = text.replace(new RegExp(escapeRegExp(office), 'g'), '');
  text = text.replace(new RegExp(escapeRegExp(number), 'g'), '');
  text = text.replace(/company no\.?\s*/gi, '');
  text = text.replace(/registered office:?\s*/gi, '');
  text = text.replace(/registered in England &amp; Wales,?\s*/gi, '');
  text = text.replace(/registered in England & Wales,?\s*/gi, '');
  return text;
}

/** @param {string} html */
export function linkCompanyNameInPolicyHtml(html) {
  let linked = false;
  return html.replace(/EUGNEL LTD/g, (match) => {
    if (linked) return match;
    linked = true;
    return `<a href="${COMPANY_INFORMATION_PATH}">EUGNEL LTD</a>`;
  });
}

/**
 * @param {string} route
 * @param {string} markdown
 * @param {Record<string, unknown>} company
 */
export function refreshPolicyMarkdown(route, markdown, company) {
  if (!['privacy', 'terms', 'refunds'].includes(route)) return markdown;
  const name = String(company.name);
  const privacyEmail = String(company.privacy_email);
  const registration = company.ico_registration ? String(company.ico_registration) : '';
  const office = String(company.registered_office).replace(/Berkshire,\s*/g, '');

  let text = markdown.replace(/Berkshire,\s*/g, '');

  const icoLine = `We are registered with the Information Commission (ICO), registration number ${registration}.`;
  if (registration && !text.includes('Information Commission (ICO), registration number')) {
    text = text.replace(/Registered with ICO[^.\n]*\./gi, icoLine);
    text = text.replace(
      /We have applied to the Information Commissioner[^.]*\./gi,
      icoLine,
    );
    text = text.replace(/Our ICO registration application[^.]*\./gi, icoLine);
    text = text.replace(/application[^.\n]*pending[^.\n]*C2062045[^.\n]*\./gi, icoLine);
  }

  const identityPattern = new RegExp(
    `${escapeRegExp(name)}[^\\n]*(${escapeRegExp(office)}|${escapeRegExp(String(company.number))})[^\\n]*`,
    'gi',
  );
  text = text.replace(identityPattern, name);
  text = text.replace(new RegExp(escapeRegExp(office), 'g'), '');
  text = text.replace(new RegExp(String(company.number), 'g'), '');
  text = text.replace(/, registered in England & Wales, company no\.?\s*/gi, '');
  text = text.replace(/EUGNEL LTD, registered in England & Wales[^.\n]*/gi, name);

  const complaintsBlock = `${COMPLAINTS_HEADING}

You can complain to ${name} about how we use your personal data. Email ${privacyEmail} with enough detail for us to understand your concern. We will acknowledge your complaint within 30 days, take appropriate steps to respond without undue delay, and tell you the outcome.

You also have the right to make a complaint to us under section 164A of the Data Protection Act 2018.

If you remain dissatisfied, you can make a complaint to the Information Commission (ICO): https://ico.org.uk/make-a-complaint/`;

  if (text.includes(COMPLAINTS_HEADING)) {
    text = text.replace(/## Complaints[\s\S]*?(?=\n## |\n# |$)/, `${complaintsBlock}\n`);
  } else if (route === 'privacy') {
    text = `${text.trim()}\n\n${complaintsBlock}\n`;
  }

  text = text
    .replace(/Information Commissioner's Office/gi, 'Information Commission (ICO)')
    .replace(/Information Commissioner(?!'s Office)/gi, 'Information Commission (ICO)');

  return text;
}

/** @param {string} markdown */
export function refreshDataUseMarkdown(markdown, company) {
  const registration = company.ico_registration ? String(company.ico_registration) : '';
  let text = markdown.replace(/Berkshire,\s*/g, '');
  if (registration) {
    text = text.replace(
      /The privacy page gives the current ICO application status\./,
      `Company information and the privacy notice state our ICO registration (${registration}).`,
    );
    text = text.replace(
      /The privacy page states our ICO registration \([^)]+\)\./,
      `Company information and the privacy notice state our ICO registration (${registration}).`,
    );
  }
  return text;
}
