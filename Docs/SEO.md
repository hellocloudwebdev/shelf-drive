# Product website SEO

The canonical product website is **https://hellocloudwebdev.github.io/shelf-drive/**.
GitHub Pages publishes `Docs/Telegram-Drive.html` as `/index.html` through
`.github/workflows/pages.yml`, along with `Docs/assets/`, `Docs/robots.txt`, and
`Docs/sitemap.xml`. Markdown documentation in `Docs/` is not published by this
workflow.

## Search configuration

- `robots.txt` allows crawlers to fetch the page and its assets and advertises the
  absolute sitemap URL. Do not block assets needed to render the page.
- The sitemap contains only the canonical homepage. Section anchors such as
  `#download` and `#faq` are not separate pages and must not be added as sitemap URLs.
  Add future pages only when they are published and independently indexable.
- The canonical link, Open Graph URL, Twitter card, and structured data all use the
  GitHub Pages origin this repository actually serves. If a custom domain is
  attached later, `canonical`, `og:url`, `og:image`, `twitter:image`, the
  structured-data `@id` values, `robots.txt`, and `sitemap.xml` must all change
  together; a half-migrated set of URLs splits ranking signals across two hosts.
- Keep the title and descriptions consistent with the visible product copy. The
  page is branded **Shelf Drive** and must not reintroduce upstream
  "Telegram-Drive" naming, `caamer20/Telegram-Drive` repository links, or the
  `telegram-drive.com` origin.
- `WebSite` structured data supplies the site name. `SoftwareApplication`
  describes the free application, declares `softwareVersion`, `license`, and
  `operatingSystem` (Windows, macOS, Linux only — no Android package is published),
  and keeps a zero purchase price. Do not invent ratings or reviews to satisfy
  rich-result checks. Google's software-app rich result requires a qualifying
  rating or review, which this page does not currently provide.
- All main text, FAQ answers, and download fallback links are present in the static
  HTML. JavaScript is not required to discover them; it only enriches the download
  cards from the public Releases API.
- The sitemap intentionally omits `lastmod`: a deployment time is not necessarily
  a substantive content update. Add it only when it can be maintained accurately.

## Verify after an authorized deployment

1. Confirm these URLs return HTTP 200 and the expected file contents:
   - https://hellocloudwebdev.github.io/shelf-drive/
   - https://hellocloudwebdev.github.io/shelf-drive/robots.txt
   - https://hellocloudwebdev.github.io/shelf-drive/sitemap.xml
   - https://hellocloudwebdev.github.io/shelf-drive/assets/dashboard.webp
2. Confirm the deployed HTML title starts with `Shelf Drive`, the canonical link
   matches the Pages origin, and no `caamer20` link remains in the shipped page.
3. In [Google Search Console](https://search.google.com/search-console), add the
   `https://hellocloudwebdev.github.io/shelf-drive/` URL-prefix property if it is
   not yet verified, then submit
   `https://hellocloudwebdev.github.io/shelf-drive/sitemap.xml` in **Sitemaps**.
   Use **URL inspection → Test live URL** for the homepage, then **Request indexing**.
4. Inspect the page in Google's [Rich Results Test](https://search.google.com/test/rich-results)
   and [PageSpeed Insights](https://pagespeed.web.dev/). Monitor Search Console's
   indexing, selected canonical, and search performance after Google recrawls.
   Crawl permission and structured data do not guarantee indexing or rankings.

## Google references

- [Create a robots.txt file](https://developers.google.com/search/docs/crawling-indexing/robots/intro)
- [Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Site names](https://developers.google.com/search/docs/appearance/site-names)
- [Software application structured data](https://developers.google.com/search/docs/appearance/structured-data/software-app)
