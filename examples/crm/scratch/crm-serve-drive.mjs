// Playwright drive of the REAL served CRM Node app (Phase R3 proof).
//
// Builds nothing — run `vp build` first so the styled assets exist — then starts
// scripts/serve.mjs (Node + PGlite, the interactive createApp handler) and drives
// it in real Chromium, proving the enhance server-action forms round-trip:
//   1. /contacts: add a contact -> the new person appears in the morphed list.
//   2. /: open a new deal -> the pipeline morphs (new open-deal row).
//   3. /deals/:id: move the deal to a new stage -> the detail region morphs.
//   4. /deals/:id: close the deal won -> stage badge flips to "won".
// Each step asserts the server-truth fragment morph (no full navigation) and
// reports before/after; any browser console error fails the run.
//
// Usage: cd examples/crm && vp build && node scratch/crm-serve-drive.mjs

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { chromium } from 'playwright';

const crmRoot = fileURLToPath(new URL('../', import.meta.url));
const serveScript = path.join(crmRoot, 'scripts', 'serve.mjs');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

async function startServer() {
  const child = spawn(process.execPath, [serveScript, '--port', '0'], {
    cwd: crmRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const origin = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(
      () => reject(new Error('serve.mjs did not announce an origin')),
      30_000,
    );
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(/crm-serve\/v1\n(http:\/\/[^\n]+)\n/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`serve.mjs exited early (code ${code})`)));
  });
  return { child, origin };
}

async function main() {
  const { child, origin } = await startServer();
  console.log(`crm-serve-drive: serving at ${origin}`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  try {
    // ── 1. add-contact (on /contacts) ──────────────────────────────────────────
    await page.goto(`${origin}/contacts`, { waitUntil: 'networkidle' });
    const contactsBefore = await page.locator('ul.grid > li').count();
    console.log(`contacts before: ${contactsBefore}`);
    await page.fill('input[name="name"]', 'Edsger Dijkstra');
    await page.fill('input[name="email"]', 'edsger@demo.example.com');
    await page.click('button:has-text("Add contact")');
    await page.waitForFunction(() => document.body.innerText.includes('Edsger Dijkstra'), {
      timeout: 10_000,
    });
    const contactsAfter = await page.locator('ul.grid > li').count();
    console.log(`contacts after: ${contactsAfter}`);
    if (contactsAfter !== contactsBefore + 1) {
      fail(`add-contact did not morph the list (${contactsBefore} -> ${contactsAfter})`);
    } else {
      console.log('PASS: add-contact morphed the contact list with the new person');
    }
    // It was a fragment morph, not a navigation: still on /contacts.
    if (new URL(page.url()).pathname !== '/contacts')
      fail('add-contact navigated away (not a morph)');

    // ── 2. create-deal (on /) ───────────────────────────────────────────────────
    await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
    const openBefore = await page.locator('table tbody tr').count();
    console.log(`open deals before: ${openBefore}`);
    await page.selectOption('select[name="stage"]', 'open');
    await page.fill('input[name="amount"]', '7500');
    await page.click('button:has-text("Create deal")');
    await page.waitForFunction(
      (n) => document.querySelectorAll('table tbody tr').length === n + 1,
      openBefore,
      { timeout: 10_000 },
    );
    const openAfter = await page.locator('table tbody tr').count();
    console.log(`open deals after: ${openAfter}`);
    if (openAfter !== openBefore + 1)
      fail(`create-deal did not morph the pipeline (${openBefore} -> ${openAfter})`);
    else console.log('PASS: create-deal morphed the pipeline with the new open deal');

    // ── 3. move-deal stage (on /deals/:id) ──────────────────────────────────────
    // d1 is a seeded open deal. The header stage badge is the first `.capitalize`
    // span inside the fragment region; wait for IT to change (the move buttons are
    // also `.capitalize`, so don't gate on body text containing "proposal").
    const headerBadge = page.locator('[kovo-fragment-target] .capitalize').first();
    await page.goto(`${origin}/deals/d1`, { waitUntil: 'networkidle' });
    const stageBefore = (await headerBadge.innerText()).trim();
    console.log(`deal d1 stage before: ${stageBefore}`);
    await page.click('form[action="/_m/moveDeal"] button:has-text("proposal")');
    // Gate on the HEADER badge text flipping (the move buttons are also
    // `.capitalize`, so this is the only reliable signal the region morphed).
    await page.waitForFunction(
      () => {
        const badge = document.querySelector('[kovo-fragment-target] .capitalize');
        return badge && badge.textContent.trim().toLowerCase() === 'proposal';
      },
      { timeout: 10_000 },
    );
    const stageAfter = (await headerBadge.innerText()).trim();
    console.log(`deal d1 stage after move: ${stageAfter}`);
    if (stageAfter.toLowerCase() !== 'proposal')
      fail(`move-deal did not morph the stage badge (got "${stageAfter}")`);
    else console.log('PASS: move-deal morphed the deal-detail region to proposal');

    // ── 4. close-deal won (on /deals/:id) ───────────────────────────────────────
    await page.click('form[action="/_m/closeDeal"] button:has-text("Close won")');
    await page.waitForFunction(() => document.body.innerText.includes('Commission is final'), {
      timeout: 10_000,
    });
    const stageClosed = (await headerBadge.innerText()).trim();
    console.log(`deal d1 stage after close: ${stageClosed}`);
    if (stageClosed.toLowerCase() !== 'won')
      fail(`close-deal did not morph the stage to won (got "${stageClosed}")`);
    else
      console.log(
        'PASS: close-deal morphed the deal-detail region to won (server commission applied)',
      );

    if (consoleErrors.length > 0) {
      fail(`browser console errors:\n${consoleErrors.join('\n')}`);
    } else {
      console.log('PASS: no browser console errors');
    }
  } finally {
    await browser.close();
    child.kill('SIGTERM');
  }

  if (process.exitCode) {
    console.error('\ncrm-serve-drive: FAILED');
  } else {
    console.log('\ncrm-serve-drive: ALL PASS');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
