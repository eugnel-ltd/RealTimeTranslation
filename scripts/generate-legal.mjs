import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { legalData, render, renderAll } from 'eugnel-platform/legal';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${name}`);
  return args[index + 1];
};
const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

// Only the headings, paragraphs and lists used by our fixed templates become
// markup. All input text is escaped first. Raw HTML and Markdown links remain text.
function bodyHtml(markdown) {
  return markdown.trim().split(/\n\s*\n/).map((block) => {
    const heading = /^(#{1,3}) (.+)$/.exec(block);
    if (heading) return `<h${heading[1].length}>${escape(heading[2])}</h${heading[1].length}>`;
    const lines = block.split('\n');
    if (lines.every((line) => line.startsWith('- '))) {
      return `<ul>${lines.map((line) => `<li>${escape(line.slice(2))}</li>`).join('')}</ul>`;
    }
    return `<p>${escape(block).replace(/\n/g, ' ')}</p>`;
  }).join('\n');
}

const navigation = '<nav aria-label="Legal"><a href="/">Application</a> · <a href="/legal/privacy/">Privacy</a> · <a href="/legal/terms/">Terms</a> · <a href="/legal/refunds/">Free service and refunds</a> · <a href="/legal/data-use/">Data use and storage choices</a></nav>';
const sources = [
  ['Google Gemini terms', 'https://ai.google.dev/gemini-api/terms'],
  ['Google abuse monitoring', 'https://ai.google.dev/gemini-api/docs/usage-policies'],
  ['Microsoft Speech privacy', 'https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/speech-service/speech-to-text/data-privacy-security'],
  ['Microsoft Translator privacy', 'https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/translator/data-privacy-security'],
  ['TypeSafe privacy', 'https://typesafe.ai/legal/privacy-policy'],
  ['TypeSafe data processing terms', 'https://typesafe.ai/legal/data-processing'],
  ['Cloudflare data processing terms', 'https://www.cloudflare.com/cloudflare-customer-dpa/'],
];

try {
  const manifest = parse(readFileSync(option('--manifest', join(root, 'product.yaml')), 'utf8'));
  const companyPath = option('--company', join(root, 'legal/company.snapshot.yaml'));
  const companyBytes = readFileSync(companyPath);
  if (!args.includes('--company')) {
    const provenance = JSON.parse(readFileSync(join(root, 'legal/company-source.json'), 'utf8'));
    if (createHash('sha256').update(companyBytes).digest('hex') !== provenance.sha256) {
      throw new Error('Canonical company snapshot digest mismatch; regenerate from the recorded HQ source');
    }
  }
  const company = parse(companyBytes.toString('utf8'));
  const pages = renderAll({ manifest, company });
  pages['data-use.md'] = render(readFileSync(join(root, 'legal/data-use.md'), 'utf8'), legalData({ manifest, company }));
  const pageNames = { privacy: 'privacy-policy.md', terms: 'terms-of-service.md', refunds: 'refund-policy.md', 'data-use': 'data-use.md' };
  const output = Object.fromEntries(Object.entries(pageNames).map(([route, name]) => {
    const references = route === 'data-use'
      ? `<section><h2>Provider notices</h2><ul>${sources.map(([label, href]) => `<li><a href="${href}" rel="noreferrer">${label}</a></li>`).join('')}</ul></section>`
      : '';
    const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escape(manifest.name)}: ${escape(route)}</title></head><body>${navigation}<main>${bodyHtml(pages[name])}${references}<p>Privacy: <a href="mailto:${escape(company.privacy_email)}">${escape(company.privacy_email)}</a>. Support: <a href="mailto:${escape(manifest.support)}">${escape(manifest.support)}</a>.</p></main></body></html>\n`;
    return [route, html];
  }));
  const out = option('--out', join(root, 'client/public/legal'));
  // Build every document before writing any. A missing field cannot create a
  // partial policy set that could look like a successful build.
  for (const [route, html] of Object.entries(output)) {
    mkdirSync(join(out, route), { recursive: true });
    writeFileSync(join(out, route, 'index.html'), html);
  }
  console.log(`legal: generated ${Object.keys(output).length} linked pages`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Legal generation failed');
  process.exitCode = 1;
}
