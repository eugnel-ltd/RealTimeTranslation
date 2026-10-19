import companyLines from '../generated/company-lines.json';

export function LegalFooterLinks() {
  return (
    <>
      <a href="/legal/privacy/">Privacy</a>
      {' · '}
      <a href="/legal/terms/">Terms</a>
      {' · '}
      <a href="/legal/refunds/">Free service and refunds</a>
      {' · '}
      <a href="/legal/data-use/">Data use and storage choices</a>
    </>
  );
}

export function LegalFooter() {
  return (
    <footer aria-label="Legal and data controls">
      <LegalFooterLinks />
      <p>{companyLines.footer}</p>
    </footer>
  );
}
