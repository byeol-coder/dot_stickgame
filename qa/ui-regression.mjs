import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const out = process.env.QA_OUTPUT || 'artifacts/ui-regression';
const allCases = [
  ['1920x1080', 1920, 1080, ''],
  ['1440x900', 1440, 900, ''],
  ['1366x768', 1366, 768, ''],
  ['1280x720', 1280, 720, ''],
  ['1024x768', 1024, 768, ''],
  ['1024x576', 1024, 576, ''],
  ['800x600', 800, 600, ''],
  ['768x1024', 768, 1024, ''],
  ['430x932', 430, 932, ''],
  ['390x844', 390, 844, ''],
  ['embed-1366x768', 1366, 768, '?embed=1&preview=0'],
  ['embed-1024x576', 1024, 576, '?embed=1&preview=0'],
  ['embed-800x600', 800, 600, '?embed=1&preview=0'],
  ['embed-430x700', 430, 700, '?embed=1&preview=0']
];
const requestedCases = new Set((process.env.QA_CASES || '').split(',').map(value => value.trim()).filter(Boolean));
const cases = requestedCases.size ? allCases.filter(([name]) => requestedCases.has(name)) : allCases;
if (!cases.length) throw new Error(`QA_CASES did not match a configured viewport: ${[...requestedCases].join(',')}`);

const failures = [];
const warnings = [];
await mkdir(out, { recursive: true });

function ignored(url, message = '') {
  return /fonts\.googleapis\.com|fonts\.gstatic\.com|dot-games-host\.vercel\.app\/tts\.js/.test(url)
    || /ERR_ABORTED|NS_BINDING_ABORTED/.test(message);
}

async function gameFrame(page) {
  const handle = await page.waitForSelector('#gameFrame');
  const frame = await handle.contentFrame();
  if (!frame) throw new Error('game iframe unavailable');
  await frame.waitForSelector('#startBtn', { state: 'visible' });
  return frame;
}

async function audit(frame, name, state, height, embed) {
  const result = await frame.evaluate(({ state, height, embed }) => {
    const bad = [];
    const warn = [];
    const $ = selector => document.querySelector(selector);
    const visible = element => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const root = document.documentElement;
    const body = document.body;

    if (root.scrollWidth > root.clientWidth + 2 || body.scrollWidth > body.clientWidth + 2) {
      bad.push(`horizontal overflow ${root.scrollWidth}/${body.scrollWidth}/${root.clientWidth}`);
    }
    if (embed && (root.scrollHeight > height + 2 || body.scrollHeight > height + 2)) {
      bad.push(`embed vertical overflow ${root.scrollHeight}/${body.scrollHeight}/${height}`);
    }

    const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    if (duplicateIds.length) bad.push(`duplicate ids ${duplicateIds.join(',')}`);

    const referencedIds = [...document.querySelectorAll('[aria-labelledby],[aria-describedby],[aria-controls]')]
      .flatMap(element => ['aria-labelledby', 'aria-describedby', 'aria-controls']
        .flatMap(attribute => (element.getAttribute(attribute) || '').split(/\s+/).filter(Boolean)));
    const missingReferences = [...new Set(referencedIds.filter(id => !document.getElementById(id)))];
    if (missingReferences.length) bad.push(`missing aria references ${missingReferences.join(',')}`);

    for (const button of document.querySelectorAll('button')) {
      if (!visible(button)) continue;
      const rect = button.getBoundingClientRect();
      const name = button.getAttribute('aria-label') || button.textContent.trim();
      if (!name) bad.push(`unnamed button ${button.id || 'anonymous'}`);
      if (rect.width < 32 || rect.height < 32) {
        bad.push(`small button ${button.id || 'anonymous'} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      } else if (rect.width < 44 || rect.height < 44) {
        warn.push(`compact target ${button.id || 'anonymous'} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
    }

    const requiredTargets = state === 'intro'
      ? ['#startBtn', '.intro-difficulty__button']
      : state === 'play'
        ? ['.choice', '#takeBtn']
        : ['.result-action', '#tactileReplayBtn'];
    for (const selector of requiredTargets) {
      for (const element of document.querySelectorAll(selector)) {
        if (!visible(element)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width < 44 || rect.height < 44) {
          bad.push(`${selector} target ${Math.round(rect.width)}x${Math.round(rect.height)}`);
        }
      }
    }

    if (state === 'intro') {
      const leftEdges = ['.intro-eyebrow', '.intro-title', '.intro-tagline', '.intro-summary', '.intro-rule-card']
        .map(selector => {
          const element = $(selector);
          return visible(element) ? element.getBoundingClientRect().left : null;
        })
        .filter(Number.isFinite);
      if (leftEdges.length && Math.max(...leftEdges) - Math.min(...leftEdges) > 2) {
        bad.push(`intro left edges differ ${leftEdges.map(value => Math.round(value * 10) / 10).join('/')}`);
      }
      const title = parseFloat(getComputedStyle($('.intro-title__ko')).fontSize);
      const tagline = parseFloat(getComputedStyle($('.intro-tagline')).fontSize);
      const summary = visible($('.intro-summary')) ? parseFloat(getComputedStyle($('.intro-summary')).fontSize) : 0;
      if (!(title > tagline && (!summary || tagline > summary))) {
        bad.push(`type hierarchy ${title}/${tagline}/${summary}`);
      }
      const button = $('#startBtn').getBoundingClientRect();
      const label = $('.intro-start__label').getBoundingClientRect();
      if (Math.abs(button.left + button.width / 2 - label.left - label.width / 2) > 3) {
        bad.push('start label off center');
      }
    }

    const active = state === 'intro' ? $('#screenTitle') : state === 'play' ? $('#screenPlay') : $('#screenResult');
    if (!visible(active)) bad.push(`${state} hidden`);
    return { bad, warn };
  }, { state, height, embed });

  failures.push(...result.bad.map(issue => `${name}/${state}: ${issue}`));
  warnings.push(...result.warn.map(issue => `${name}/${state}: ${issue}`));
}

async function prepareGame(page, query) {
  await page.goto(base + query, { waitUntil: 'commit', timeout: 30000 });
  const frame = await gameFrame(page);
  await frame.evaluate(() => {
    Math.random = () => 0;
    const voiceToggle = document.getElementById('voiceToggleBtn');
    if (voiceToggle && voiceToggle.getAttribute('aria-pressed') === 'false') voiceToggle.click();
    document.querySelector('.diff[data-diff="easy"]')?.click();
  });
  return frame;
}

async function playToResult(frame, expected) {
  await frame.locator('#startBtn').click();
  await frame.waitForSelector('#screenPlay:not(.hidden)', { state: 'visible' });

  for (let turn = 0; turn < 12; turn += 1) {
    await frame.waitForFunction(() => {
      const result = document.getElementById('screenResult');
      const take = document.getElementById('takeBtn');
      return !result.classList.contains('hidden') || !take.disabled;
    }, null, { timeout: 5000 });

    if (await frame.locator('#screenResult').evaluate(element => !element.classList.contains('hidden'))) break;
    const remaining = Number(await frame.locator('#countBig').textContent());
    const take = expected === 'win' ? (remaining % 3 || 1) : 1;
    await frame.locator(take === 2 ? '#choice2' : '#choice1').click();
    await frame.locator('#takeBtn').click();
  }

  await frame.waitForSelector('#screenResult:not(.hidden)', { state: 'visible', timeout: 10000 });
  const actual = await frame.locator('#screenResult').getAttribute('data-result');
  if (actual !== expected) throw new Error(`expected ${expected} result, received ${actual}`);
}

const launchOptions = { headless: true };
if (process.env.BROWSER_PROXY) launchOptions.proxy = { server: process.env.BROWSER_PROXY };
const browser = await chromium.launch(launchOptions);
try {
  for (const [name, width, height, query] of cases) {
    console.log(`Auditing ${name}`);
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: 'reduce',
      ignoreHTTPSErrors: process.env.QA_IGNORE_HTTPS_ERRORS === '1'
    });
    const runtime = [];
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (/dot-games-host\.vercel\.app\/tts\.js/.test(url)) {
        await route.abort('blockedbyclient');
      } else {
        await route.continue();
      }
    });
    page.on('pageerror', error => runtime.push(`pageerror ${error.message}`));
    page.on('requestfailed', request => {
      const message = request.failure()?.errorText || '';
      if (!ignored(request.url(), message)) runtime.push(`requestfailed ${request.url()} ${message}`);
    });

    try {
      let frame = await prepareGame(page, query);
      const embed = query.includes('embed=1');

      await frame.locator('#startBtn').focus();
      const focusRing = await frame.locator('#startBtn').evaluate(element => {
        const style = getComputedStyle(element);
        return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 3;
      });
      if (!focusRing) failures.push(`${name}/intro: focus ring missing`);
      await audit(frame, name, 'intro', height, embed);
      await page.screenshot({ path: path.join(out, `${name}-intro.png`), animations: 'disabled' });

      await frame.locator('#introHelpBtn').click();
      await frame.waitForSelector('#helpModal:not([hidden])', { state: 'visible' });
      const focusInsideHelp = await frame.evaluate(() => document.getElementById('helpModal').contains(document.activeElement));
      if (!focusInsideHelp) failures.push(`${name}/help: focus did not enter dialog`);
      await page.screenshot({ path: path.join(out, `${name}-help.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await frame.waitForSelector('#helpModal', { state: 'hidden' });
      const returned = await frame.evaluate(() => document.activeElement?.id === 'introHelpBtn');
      if (!returned) failures.push(`${name}/help: focus did not return to trigger`);

      await frame.locator('#startBtn').click();
      await frame.waitForSelector('#screenPlay:not(.hidden)', { state: 'visible' });
      await audit(frame, name, 'play', height, embed);
      await page.screenshot({ path: path.join(out, `${name}-play.png`), animations: 'disabled' });

      frame = await prepareGame(page, query);
      await playToResult(frame, 'win');
      await audit(frame, name, 'result', height, embed);
      await page.screenshot({ path: path.join(out, `${name}-win.png`), animations: 'disabled' });

      frame = await prepareGame(page, query);
      await playToResult(frame, 'lose');
      await audit(frame, name, 'result', height, embed);
      await page.screenshot({ path: path.join(out, `${name}-lose.png`), animations: 'disabled' });

      failures.push(...runtime.map(issue => `${name}: ${issue}`));
    } catch (error) {
      failures.push(`${name}: ${error.stack || error.message}`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}

const report = {
  cases: cases.map(([name, width, height, query]) => ({ name, width, height, query })),
  failures,
  warnings
};
await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));

if (warnings.length) {
  console.warn(`UI audit recorded ${warnings.length} warning(s)`);
  for (const warning of warnings) console.warn(`- ${warning}`);
}
if (failures.length) {
  console.error(`UI audit found ${failures.length} issue(s)`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`UI audit passed for ${cases.length} viewport configurations`);
