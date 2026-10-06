// Runs after `vite build`. Writes a real, crawlable HTML file for every page
// (title, meta, schema, visible-to-bots text) plus sitemap.xml, robots.txt and 404.html.
// Usage: SITE_URL=https://yourdomain.com npm run build
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const SEO = JSON.parse(fs.readFileSync(path.join(root, 'src', 'seoPages.json'), 'utf8'))
const SITE = (process.env.SITE_URL || 'http://localhost:5000').replace(/\/$/, '')
const template = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`
const text = (p) => p.replace('{{EMAIL}}', SEO.contactEmail)
const isTool = (p) => p.kind !== 'info'

function head(page) {
  const url = SITE + page.path
  const t = esc(page.title)
  const d = esc(page.description)
  const crumbs = [{ name: 'Home', url: SITE + '/' }]
  if (page.path !== '/') crumbs.push({ name: page.label, url })

  const blocks = [
    ld({
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url })),
    }),
  ]
  if (page.path === '/') {
    blocks.push(ld({ '@context': 'https://schema.org', '@type': 'WebSite', name: SEO.siteName, url: SITE + '/' }))
  }
  if (isTool(page)) {
    blocks.push(ld({
      '@context': 'https://schema.org', '@type': 'WebApplication', name: SEO.siteName, url,
      description: page.description, applicationCategory: 'MultimediaApplication', operatingSystem: 'Any',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    }))
    blocks.push(ld({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: SEO.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    }))
    blocks.push(ld({
      '@context': 'https://schema.org', '@type': 'HowTo', name: page.h1 + ' ' + page.h1grad,
      step: SEO.howTo.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, text: s })),
    }))
  }
  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}">`,
    `<meta name="keywords" content="${esc(page.keywords)}">`,
    '<meta name="robots" content="index, follow, max-image-preview:large">',
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(SEO.siteName)}">`,
    `<meta property="og:title" content="${t}"><meta property="og:description" content="${d}"><meta property="og:url" content="${url}">`,
    `<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${t}"><meta name="twitter:description" content="${d}">`,
    '<style>.seo-fallback{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}</style>',
    ...blocks,
  ].join('')
}

function fallback(page) {
  const nav = SEO.pages.filter((p) => p.nav).map((p) => `<a href="${p.path}">${esc(p.label)}</a>`).join(' ')
  const foot = SEO.pages.filter((p) => p.kind === 'info').map((p) => `<a href="${p.path}">${esc(p.label)}</a>`).join(' ')
  const faq = isTool(page)
    ? '<h2>Frequently asked questions</h2>' + SEO.faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')
    : ''
  const body = (page.article || []).map((a) => `<h2>${esc(a.h)}</h2><p>${esc(text(a.p))}</p>`).join('')
  return `<div class="seo-fallback"><nav>${nav}</nav><h1>${esc(page.h1)} ${esc(page.h1grad)}</h1><p>${esc(page.sub)}</p>${body}${faq}<nav>${foot}</nav></div>`
}

function render(page) {
  return template
    .replace(/<title>.*?<\/title>/s, '')
    .replace('</head>', head(page) + '</head>')
    .replace('<div id="root"></div>', `<div id="root">${fallback(page)}</div>`)
}

for (const page of SEO.pages) {
  const dir = page.path === '/' ? dist : path.join(dist, page.path)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.html'), render(page))
}

const today = new Date().toISOString().slice(0, 10)
const prio = (p) => (p.path === '/' ? '1.0' : p.kind === 'info' ? '0.3' : '0.8')
fs.writeFileSync(path.join(dist, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
  SEO.pages.map((p) => `<url><loc>${SITE}${p.path}</loc><lastmod>${today}</lastmod><priority>${prio(p)}</priority></url>`).join('') +
  '</urlset>')
fs.writeFileSync(path.join(dist, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n`)

const nf = template.replace(/<title>.*?<\/title>/s, '<title>Page not found - ' + esc(SEO.siteName) + '</title>')
  .replace('</head>', '<meta name="robots" content="noindex"></head>')
  .replace('<div id="root"></div>', '<div id="root"><h1>Page not found</h1><p><a href="/">Go to the homepage</a></p></div>')
fs.writeFileSync(path.join(dist, '404.html'), nf)

console.log(`prerendered ${SEO.pages.length} pages for ${SITE}`)
