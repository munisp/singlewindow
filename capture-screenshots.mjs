/**
 * Playwright screenshot capture for TradeGateway NGSWTP UI showcase
 * Captures all major pages at desktop (1440x900) and mobile (390x844) viewports
 */
import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';

const BASE_URL = 'https://3000-ivykdymiuwfs32wlq46pd-9842df75.us2.manus.computer';
const OUT_DIR = '/home/ubuntu/ui-screenshots';

// Public pages (no auth required)
const PUBLIC_PAGES = [
  { name: '01-landing-hero', path: '/', waitFor: 'h1' },
  { name: '05-specification', path: '/specification', waitFor: '.prose, h1, h2' },
  { name: '06-system-status', path: '/status', waitFor: 'h1, h2, .status' },
];

// App pages - will show auth gate (still useful for the showcase)
const APP_PAGES = [
  { name: '07-trader-dashboard', path: '/app/trader', waitFor: 'body' },
  { name: '08-new-declaration', path: '/app/trader/new', waitFor: 'body' },
  { name: '09-customs-dashboard', path: '/app/customs', waitFor: 'body' },
  { name: '10-oga-portal', path: '/app/oga', waitFor: 'body' },
  { name: '11-admin-console', path: '/app/admin', waitFor: 'body' },
  { name: '12-security-ops', path: '/app/security', waitFor: 'body' },
  { name: '13-port-heatmap', path: '/app/geo/heatmap', waitFor: 'body' },
  { name: '14-developer-portal', path: '/app/developer', waitFor: 'body' },
  { name: '15-finance-ledger', path: '/app/finance', waitFor: 'body' },
  { name: '16-cargo-tracking', path: '/app/cargo', waitFor: 'body' },
  { name: '17-kyc-portal', path: '/app/trader/kyc', waitFor: 'body' },
  { name: '18-executive-dashboard', path: '/app/executive', waitFor: 'body' },
  { name: '19-notifications', path: '/app/notifications', waitFor: 'body' },
  { name: '20-audit-log', path: '/app/audit', waitFor: 'body' },
];

async function capture() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  // Desktop viewport
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const dPage = await desktop.newPage();

  // Mobile viewport
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const mPage = await mobile.newPage();

  const allPages = [...PUBLIC_PAGES, ...APP_PAGES];

  for (const pg of allPages) {
    console.log(`Capturing: ${pg.name} (${pg.path})`);
    try {
      // Desktop
      await dPage.goto(`${BASE_URL}${pg.path}`, { waitUntil: 'networkidle', timeout: 15000 });
      await dPage.waitForTimeout(1500);
      await dPage.screenshot({
        path: `${OUT_DIR}/${pg.name}-desktop.png`,
        fullPage: false,
      });
      console.log(`  ✓ Desktop saved`);

      // Mobile (only for key pages)
      if (['01-landing-hero', '07-trader-dashboard', '09-customs-dashboard', '04-auth-gate'].includes(pg.name) ||
          pg.name.startsWith('0')) {
        await mPage.goto(`${BASE_URL}${pg.path}`, { waitUntil: 'networkidle', timeout: 15000 });
        await mPage.waitForTimeout(1500);
        await mPage.screenshot({
          path: `${OUT_DIR}/${pg.name}-mobile.png`,
          fullPage: false,
        });
        console.log(`  ✓ Mobile saved`);
      }
    } catch (e) {
      console.error(`  ✗ Error: ${e.message}`);
    }
  }

  // Also capture the full landing page (scrolled)
  console.log('Capturing full landing page...');
  await dPage.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 15000 });
  await dPage.waitForTimeout(2000);
  await dPage.screenshot({
    path: `${OUT_DIR}/00-landing-full.png`,
    fullPage: true,
  });
  console.log('  ✓ Full landing page saved');

  await browser.close();
  console.log('\nAll screenshots captured!');
}

capture().catch(console.error);
