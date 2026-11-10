// npm run test:visits
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldLog, isSpeculative, isBot, deviceOf, referrerLabel, cleanPath, hourOf, buildVisit, insertArgs,
  pruneBefore, RETENTION_DAYS, optOutRequest, isOptedOut, optOutCookie,
} from './visit.js';

const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const page = { method: 'GET', hostname: 'akshatvalse.com', pathname: '/research', status: 200, contentType: 'text/html; charset=utf-8', navigate: true };

test('logs a normal page view, and a revalidated one while navigating', () => {
  assert.equal(shouldLog(page), true);
  assert.equal(shouldLog({ ...page, hostname: 'www.akshatvalse.com' }), true);
  assert.equal(shouldLog({ ...page, status: 304, contentType: null, navigate: true }), true);
});

test('skips everything that is not a page view on the real site', () => {
  assert.equal(shouldLog({ ...page, method: 'HEAD' }), false);
  assert.equal(shouldLog({ ...page, method: 'POST' }), false);
  assert.equal(shouldLog({ ...page, hostname: 'akshatvalse-site.pages.dev' }), false);
  assert.equal(shouldLog({ ...page, hostname: 'ea266ca.akshatvalse-site.pages.dev' }), false);
  assert.equal(shouldLog({ ...page, hostname: 'localhost' }), false);
  assert.equal(shouldLog({ ...page, status: 404 }), false);
  assert.equal(shouldLog({ ...page, status: 301 }), false);
  assert.equal(shouldLog({ ...page, status: 304, navigate: false }), false);
  assert.equal(shouldLog({ ...page, contentType: 'image/svg+xml' }), false);
  assert.equal(shouldLog({ ...page, contentType: null }), false);
  assert.equal(shouldLog({ ...page, pathname: '/akshat-valse-cv-2026-11.pdf' }), false);
  assert.equal(shouldLog({ ...page, pathname: '/research/langevin/cover-art.svg' }), false);
  assert.equal(shouldLog({ ...page, pathname: '/404' }), false);
  assert.equal(shouldLog({ ...page, pathname: '/404.html' }), false);
});

test('speculative loads are recognised', () => {
  assert.equal(isSpeculative('prefetch', null), true);
  assert.equal(isSpeculative('prefetch;prerender', null), true);
  assert.equal(isSpeculative('prefetch;anonymous-client-ip', null), true);
  assert.equal(isSpeculative(null, 'prefetch'), true);
  assert.equal(isSpeculative(null, null), false);
});

test('tells people from automated clients', () => {
  for (const ua of [SAFARI, CHROME, EDGE, FIREFOX, IPHONE, ANDROID]) assert.equal(isBot(ua), false, ua);
  for (const ua of [
    null, '',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
    'Mozilla/5.0 (compatible; Google-InspectionTool/1.0)',
    'GoogleOther',
    'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'facebookexternalhit/1.1',
    'Mastodon/4.3.0 (http.rb/5.2.0; +https://mastodon.social/) Bot',
    'Iframely/1.3.1 (+https://iframely.com/docs/about)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 ms-office',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
    'curl/8.7.1', 'python-requests/2.32.3', 'Scrapy/2.11.0 (+https://scrapy.org)', 'HTTPie/3.2.2',
    'Mozilla/5.0 (Macintosh) Chrome-Lighthouse',
  ]) assert.equal(isBot(ua), true, String(ua));
});

test('device class', () => {
  assert.equal(deviceOf(IPHONE), 'mobile');
  assert.equal(deviceOf(ANDROID), 'mobile');
  assert.equal(deviceOf(SAFARI), 'desktop');
  assert.equal(deviceOf(null), 'desktop');
});

test('referrers become labels, never arbitrary host names', () => {
  const cases = {
    'https://scholar.google.com/scholar?q=akshat+valse&hl=en': 'scholar.google',
    'https://www.google.com/': 'google',
    'https://www.google.co.in/': 'google',
    'https://gemini.google.com/app': 'gemini',
    'android-app://com.google.android.gm/': 'gmail',
    'https://www.linkedin.com/in/someone/?trk=abc': 'linkedin',
    'android-app://com.linkedin.android/': 'linkedin',
    'https://t.co/abc': 'x',
    'https://outlook.office.com/mail/': 'outlook',
    'https://chatgpt.com/': 'chatgpt',
    'https://akshatvalse.com/research': 'internal',
    'https://www.akshatvalse.com/': 'internal',
    'https://cs.stanford.edu/people/someone/': 'stanford.edu',
    'https://www.iastate.edu/': 'iastate.edu',
    'https://www.cl.cam.ac.uk/teaching/': 'cam.ac.uk',
    'https://students.unimelb.edu.au/': 'unimelb.edu.au',
    'https://jane-doe.github.io/blog/': 'other',
    'https://myproj-git-main-jsmith.vercel.app/': 'other',
    'http://73.12.34.56/': 'other',
    'http://[2001:db8::1]/': 'other',
    'http://192.168.1.23:8080/notes': 'other',
    'http://jsmith-macbook.local/': 'other',
    'http://intranet/': 'other',
    ['https://' + 'a'.repeat(3000) + '.com/']: 'other',
    'not a url': null,
    '': null,
  };
  for (const [ref, want] of Object.entries(cases)) assert.equal(referrerLabel(ref), want, ref.slice(0, 60));
  assert.equal(referrerLabel(null), null);
});

test('paths are normalised and capped', () => {
  assert.equal(cleanPath('/research.html'), '/research');
  assert.equal(cleanPath('/research/'), '/research');
  assert.equal(cleanPath('//research//langevin'), '/research/langevin');
  assert.equal(cleanPath('/Research'), '/research');
  assert.equal(cleanPath('/research/%6Cangevin'), '/research/langevin');
  assert.equal(cleanPath('/%E0%A4%A'), '/%e0%a4%a');
  assert.equal(cleanPath('/index.html'), '/');
  assert.equal(cleanPath('/'), '/');
  assert.equal(cleanPath(''), '/');
  assert.equal(cleanPath('/' + 'x'.repeat(500)).length, 200);
});

test('a row holds exactly the documented fields, at hour precision, and no identifiers', () => {
  const now = new Date('2026-11-10T15:04:05.678Z');
  const v = buildVisit({
    url: 'https://akshatvalse.com/research/inside-the-trap?utm_source=newsletter&email=someone%40example.com#x',
    userAgent: IPHONE,
    referer: 'https://scholar.google.com/scholar?q=prefix+cache',
    speculative: false,
    cf: { country: 'US', asOrganization: 'Iowa State University', asn: 2698, city: 'Ames', latitude: '42.0', clientTcpRtt: 12 },
  }, now);
  assert.deepEqual(v, {
    ts: '2026-11-10T15:00Z',
    path: '/research/inside-the-trap',
    country: 'US',
    org: 'Iowa State University',
    asn: 2698,
    referrer: 'scholar.google',
    device: 'mobile',
    bot: 0,
  });
  const text = JSON.stringify(v);
  for (const leak of ['utm_source', 'example.com', 'Ames', '42.0', 'iPhone', 'prefix+cache', ':04', ':05']) assert.ok(!text.includes(leak), leak);
  assert.deepEqual(insertArgs(v), ['2026-11-10T15:00Z', '/research/inside-the-trap', 'US', 'Iowa State University', 2698, 'scholar.google', 'mobile', 0]);
});

test('bot flag: automated beats prefetch', () => {
  const base = { url: 'https://akshatvalse.com/', referer: null, cf: {} };
  assert.equal(buildVisit({ ...base, userAgent: SAFARI, speculative: true }, new Date(0)).bot, 2);
  assert.equal(buildVisit({ ...base, userAgent: 'curl/8', speculative: true }, new Date(0)).bot, 1);
  assert.equal(buildVisit({ ...base, userAgent: SAFARI, speculative: false }, new Date(0)).bot, 0);
});

test('missing Cloudflare data gives nulls, not errors', () => {
  const v = buildVisit({ url: 'https://akshatvalse.com/', userAgent: SAFARI, referer: null, cf: undefined }, new Date(0));
  assert.equal(v.country, null);
  assert.equal(v.org, null);
  assert.equal(v.asn, null);
  assert.equal(v.referrer, null);
  assert.equal(v.path, '/');
});

test('retention cutoff uses the stored format and the right distance', () => {
  const now = new Date('2026-11-10T15:30:00Z');
  const cut = pruneBefore(now);
  assert.match(cut, /^\d{4}-\d{2}-\d{2}T\d{2}:00Z$/);
  assert.equal(Math.round((now - new Date(cut.replace('Z', ':00Z'))) / 86400e3), RETENTION_DAYS);
  assert.ok('2025-10-01T00:00Z' < cut && hourOf(now) > cut);
});

test('owner opt-out', () => {
  assert.equal(optOutRequest(new URLSearchParams('nolog=1')), '1');
  assert.equal(optOutRequest(new URLSearchParams('nolog=0')), '0');
  assert.equal(optOutRequest(new URLSearchParams('nolog=yes')), null);
  assert.equal(optOutRequest(new URLSearchParams('')), null);
  assert.equal(isOptedOut('a=b; nolog=1'), true);
  assert.equal(isOptedOut('nolog=1'), true);
  assert.equal(isOptedOut('nolog=10'), false);
  assert.equal(isOptedOut('xnolog=1'), false);
  assert.equal(isOptedOut(null), false);
  assert.match(optOutCookie('1'), /^nolog=1;.*Max-Age=31536000.*Secure.*HttpOnly/);
  assert.match(optOutCookie('0'), /^nolog=;.*Max-Age=0/);
});
