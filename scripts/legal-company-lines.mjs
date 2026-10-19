/** @typedef {{ name: string; number: string; registered_office: string; privacy_email: string }} CompanyFacts */

/** @param {CompanyFacts} company */
export function companyBodyLine(company) {
  return `${company.name}, registered in England & Wales, company no. ${company.number} · ${company.privacy_email}`;
}

/** @param {CompanyFacts} company */
export function companyFooterLine(company) {
  const office = String(company.registered_office).replace(/Berkshire,\s*/g, '');
  return `${company.name} · Registered in England & Wales · Company no. ${company.number} · Registered office: ${office} · ${company.privacy_email}`;
}
