import { companyBodyLine } from './legal-company-lines.mjs';

const COMPLAINTS_HEADING = '## Complaints';

/** @param {string} text */
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Idempotent RTT-side refresh for shared policy markdown when the pinned platform
 * revision predates eugnel-platform PR #78. No-op once PR #78 wording is present.
 * @param {string} route
 * @param {string} markdown
 * @param {Record<string, unknown>} company
 */
export function refreshPolicyMarkdown(route, markdown, company) {
  if (!['privacy', 'terms', 'refunds'].includes(route)) return markdown;
  const name = String(company.name);
  const privacyEmail = String(company.privacy_email);
  const registration = company.ico_registration ? String(company.ico_registration) : '';
  const bodyLine = companyBodyLine(company);
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

  if (!text.includes(bodyLine)) {
    const officePattern = new RegExp(
      `${escapeRegExp(name)}[^\\n]*${escapeRegExp(office)}[^\\n]*`,
      'gi',
    );
    text = text.replace(officePattern, bodyLine);
    text = text.replace(new RegExp(escapeRegExp(office), 'g'), bodyLine);
  }

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
      `The privacy page states our ICO registration (${registration}).`,
    );
  }
  return text;
}
