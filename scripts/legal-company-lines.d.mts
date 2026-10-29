export interface CompanyFacts {
  name: string;
  number: string;
  registered_office: string;
  privacy_email: string;
  ico_registration?: string | null;
}

export const COMPANY_INFORMATION_PATH: '/company/';
export function companyPageMarkdown(company: CompanyFacts): string;
export function companyPageMainHtml(company: CompanyFacts, escape: (text: string) => string): string;
export function siteFooterHtml(): string;
export function companyTradingDisclosureText(company: CompanyFacts): string;
