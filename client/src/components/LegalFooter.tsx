import companyLines from '../generated/company-lines.json';

export function LegalFooter() {
  return (
    <footer aria-label="Legal and data controls">
      <p>
        {companyLines.copyright}
        {' · '}
        <a href={companyLines.companyInformationPath}>{companyLines.companyInformationLabel}</a>
      </p>
    </footer>
  );
}
