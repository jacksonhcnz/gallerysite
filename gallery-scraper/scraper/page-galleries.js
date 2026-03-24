const { chromium } = require('playwright');
const fs = require('fs');

const BASE_URL = 'https://www.pagegalleries.co.nz/exhibitions';

function parseDateRange(text) {
  // Example: "1 March – 28 March 2026"
  const parts = text.split('–').map(s => s.trim());
  if (parts.length !== 2) return { start: null, end: null };

  return {
    start: new Date(parts[0]).toISOString().split('T')[0],
    end: new Date(parts[1]).toISOString().split('T')[0]
  };
}

function classifyExhibition(start, end) {
  const today = new Date();
  if (!start || !end) return 'unknown';
  const s = new Date(start);
  const e = new Date(end);

  if (today >= s && today <= e) return 'current';
  if (s > today) return 'upcoming';
  return 'past';
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  // Grab all exhibition links
  const exhibitionLinks = await page.$$eval('a', links =>
    links
      .map(l => l.href)
      .filter(href => href.includes('/exhibitions/'))
  );

  const uniqueLinks = [...new Set(exhibitionLinks)];

  const current = [];
  const upcoming = [];

  for (const link of uniqueLinks) {
    try {
      const p = await browser.newPage();
      await p.goto(link, { waitUntil: 'domcontentloaded' });

      // Extract title
      const title = await p.$eval('h1', el => el.innerText.trim()).catch(() => null);

      // Extract body text to parse dates
      const rawText = await p.$eval('body', el => el.innerText).catch(() => '');

      // crude date match
      const dateMatch = rawText.match(/\d{1,2}\s+\w+\s+[–-]\s+\d{1,2}\s+\w+\s+\d{4}/);

      let start = null;
      let end = null;

      if (dateMatch) {
        const parsed = parseDateRange(dateMatch[0]);
        start = parsed.start;
        end = parsed.end;
      }

      // crude artist extraction from title
      const artists = title ? [title.split(':')[0]] : [];

      // description
      const description = await p.$eval('p', el => el.innerText).catch(() => '');

      const classification = classifyExhibition(start, end);

      const exhibition = {
        title,
        artists,
        start_date: start,
        end_date: end,
        description,
        source: {
          url: link,
          method: 'heuristic'
        },
        confidence: 0.7
      };

      if (classification === 'current') current.push(exhibition);
      if (classification === 'upcoming') upcoming.push(exhibition);

      await p.close();
    } catch (err) {
      console.log('Error scraping:', link);
    }
  }

  const output = {
    generated_at: new Date().toISOString(),
    region: 'greater-wellington',
    galleries: [
      {
        id: 'page-galleries',
        name: 'Page Galleries',
        type: ['dealer'],
        contact: {
          website: BASE_URL
        },
        exhibitions: {
          current,
          upcoming
        },
        data_quality: {
          gallery_info: 'high',
          exhibitions: 'medium'
        }
      }
    ]
  };

  fs.writeFileSync(
    './output/wellington-galleries.json',
    JSON.stringify(output, null, 2)
  );

  await browser.close();
  console.log('✅ Scraping complete. JSON saved to output/wellington-galleries.json');
})();