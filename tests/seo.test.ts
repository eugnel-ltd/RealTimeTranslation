import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const origin = 'https://rtt.eugnel.com';
const publicRoot = 'client/public';
const read = (path: string) => readFileSync(path, 'utf8');
function attribute(html: string, tag: string, key: string, value: string, result: string) {
  const element = [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))]
    .map(([match]) => match).filter((match) => match.includes(`${key}="${value}"`));
  expect(element, `${key}=${value} must occur exactly once`).toHaveLength(1);
  const match = element[0].match(new RegExp(`\\b${result}="([^"]+)"`));
  expect(match, `${key}=${value} needs ${result}`).not.toBeNull();
  return match![1];
}
function metadata(html: string, path: string) {
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  expect(title?.length).toBeGreaterThanOrEqual(25);
  expect(title!.length).toBeLessThanOrEqual(65);
  const description = attribute(html, 'meta', 'name', 'description', 'content');
  expect(description.length).toBeGreaterThanOrEqual(90);
  expect(description.length).toBeLessThanOrEqual(165);
  expect(attribute(html, 'link', 'rel', 'canonical', 'href')).toBe(`${origin}${path}`);
  expect(attribute(html, 'meta', 'property', 'og:title', 'content')).toBe(title);
  expect(attribute(html, 'meta', 'property', 'og:description', 'content')).toBe(description);
  expect(attribute(html, 'meta', 'property', 'og:url', 'content')).toBe(`${origin}${path}`);
  expect(attribute(html, 'meta', 'property', 'og:type', 'content')).toBe('website');
  expect(attribute(html, 'meta', 'property', 'og:locale', 'content')).toBe('en_GB');
  expect(attribute(html, 'meta', 'property', 'og:image', 'content')).toBe(`${origin}/social-card.png`);
  expect(attribute(html, 'meta', 'property', 'og:image:width', 'content')).toBe('1200');
  expect(attribute(html, 'meta', 'property', 'og:image:height', 'content')).toBe('630');
  expect(attribute(html, 'meta', 'property', 'og:image:alt', 'content')).toBeTruthy();
  expect(attribute(html, 'meta', 'name', 'twitter:card', 'content')).toBe('summary_large_image');
  for (const [key, value] of Object.entries({ title, description, image: `${origin}/social-card.png` })) {
    expect(attribute(html, 'meta', 'name', `twitter:${key}`, 'content')).toBe(value);
  }
  expect(attribute(html, 'meta', 'name', 'twitter:image:alt', 'content')).toBeTruthy();
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  expect(scripts).toHaveLength(1);
  const data = JSON.parse(scripts[0][1]);
  expect(data).toMatchObject({ '@context': 'https://schema.org', '@type': 'WebApplication',
    name: 'Real-Time Translation', applicationCategory: 'UtilitiesApplication', operatingSystem: 'Web', url: `${origin}/` });
  const visible = html.replace(/<head>[\s\S]*?<\/head>/, '');
  expect(visible).toContain(data.name);
  expect(visible).toContain(data.description);
  expect(data).not.toHaveProperty('offers');
  expect(JSON.stringify(data) + visible).not.toMatch(/AggregateRating|ratingValue|reviewCount|"Review"|downloadCount|#1\b|award/i);
  expect(html).not.toMatch(/spellingcamp\.eugnel\.com|wordcamp\.eugnel\.uk|wingkwok@eugnel\.com/i);
  return { title, description };
}

describe('search metadata and crawl boundaries', () => {
  it('completes the private app shell metadata and keeps every SPA fallback noindex', () => {
    const html = read('client/index.html');
    metadata(html, '/');
    expect(attribute(html, 'meta', 'name', 'robots', 'content')).toBe('noindex, nofollow');
    expect(html).not.toMatch(/vite\.svg/);
  });

  it('gives every indexable static page unique complete metadata and truthful visible structured data', () => {
    const pages: string[] = [];
    function discover(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) discover(path);
        else if (entry.name.endsWith('.html')) {
          const noindex = /<meta\b(?=[^>]*\bname\s*=\s*["']robots["'])(?=[^>]*\bcontent\s*=\s*["'][^"']*noindex[^"']*["'])[^>]*>/i.test(read(path));
          if (!noindex) pages.push(path);
        }
      }
    }
    discover(publicRoot);
    expect(pages).toEqual(['client/public/about/index.html']);
    const app = metadata(read('client/index.html'), '/');
    for (const page of pages) {
      const html = read(page);
      const result = metadata(html, '/about/');
      expect(result.title).not.toBe(app.title);
      expect(result.description).not.toBe(app.description);
      expect(attribute(html, 'meta', 'name', 'robots', 'content')).toBe('index, follow');
      expect(html).toContain('Access is currently restricted to the owner');
      expect(html).not.toMatch(/<footer|<script(?! type="application\/ld\+json")|<iframe/i);
      for (const [image] of html.matchAll(/<img\b[^>]*>/g)) {
        expect(image).toMatch(/\balt="[^"]*"/);
        expect(image).toMatch(/\bwidth="\d+"/);
        expect(image).toMatch(/\bheight="\d+"/);
      }
      for (const [, href] of html.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
        expect(href.startsWith('/')).toBe(true);
        if (href.startsWith('/legal/')) {
          // Policies are generated during build, after npm test on a clean checkout.
          const route = href.split('/')[2];
          const generator = read('scripts/generate-legal.mjs');
          expect(generator).toMatch(new RegExp(`(?:\\b${route}|'${route}'):\\s*'[^']+\\.md'`));
        } else if (href !== '/') {
          expect(() => read(join(publicRoot, href, 'index.html'))).not.toThrow();
        }
      }
    }
  });

  it('publishes a valid bounded sitemap with consistent host and trailing slash', () => {
    const xml = read(`${publicRoot}/sitemap.xml`);
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\s*<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    expect(xml.trim()).toMatch(/<\/urlset>$/);
    const urls = [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<\/url>/g)].map((match) => match[1]);
    expect(urls).toEqual([`${origin}/about/`]);
    expect(xml.match(/<url>/g)).toHaveLength(urls.length);
    for (const url of urls) {
      const parsed = new URL(url);
      expect(parsed.origin).toBe(origin);
      expect(parsed.pathname.endsWith('/')).toBe(true);
      expect(parsed.search + parsed.hash).toBe('');
      expect(read(join(publicRoot, parsed.pathname, 'index.html'))).not.toContain('content="noindex');
    }
  });

  it('allows public information crawling without blocking discovery of app noindex', () => {
    const robots = read(`${publicRoot}/robots.txt`);
    expect(robots).toBe(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /_internal/\n\nSitemap: ${origin}/sitemap.xml\n`);
  });

  it('provides a real 1200 by 630 PNG social card from its SVG source', () => {
    const png = readFileSync(`${publicRoot}/social-card.png`);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    const source = read(`${publicRoot}/social-card.svg`);
    expect(source).toContain('width="1200" height="630"');
    expect(source).toContain('<title');
    expect(source).not.toMatch(/https?:\/\/(?!www\.w3\.org)|<image|<script/);
  });
});
