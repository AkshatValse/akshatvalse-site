/**
 * The read beacon: tells the site how long a page was actually visible and how
 * far it was scrolled, so a page load can be told from a read. When the page
 * is hidden or left, it sends {"p": path, "t": seconds visible, "s": deepest
 * scroll as a fraction} to /api/read, which stores them in buckets (see
 * analytics/read.js). The total is cumulative, so a page that is hidden and
 * shown again sends a larger total each time.
 *
 * It sends nothing from an automated browser (navigator.webdriver), nor when
 * the reader has Global Privacy Control or Do Not Track on; the server checks
 * those again, and the owner's opt-out cookie. No identifier is read, stored
 * or sent. Bundled by Astro, so the site's Content-Security-Policy holds.
 */
const nav = navigator;
const MAX_SENDS = 20;

if (!nav.webdriver && nav.globalPrivacyControl !== true && nav.doNotTrack !== '1' && typeof nav.sendBeacon === 'function'
  && /^(www\.)?akshatvalse\.com$/.test(location.hostname)) {
  let visibleMs = 0;
  let since = document.visibilityState === 'visible' ? performance.now() : null;
  let deepest = 0;
  let sends = 0;

  const depth = () => {
    const total = Math.max(document.documentElement.scrollHeight, 1);
    return Math.min(1, (window.scrollY + window.innerHeight) / total);
  };
  const track = () => { deepest = Math.max(deepest, depth()); };
  track();
  addEventListener('scroll', track, { passive: true });

  const flush = () => {
    if (since === null) return; // already sent for this stretch of visibility
    visibleMs += performance.now() - since;
    since = null;
    track();
    if (sends >= MAX_SENDS) return;
    sends += 1;
    nav.sendBeacon('/api/read', JSON.stringify({
      p: location.pathname,
      t: Math.round(visibleMs / 1000),
      s: Math.round(deepest * 100) / 100,
    }));
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
    else if (since === null) since = performance.now();
  });
  addEventListener('pagehide', flush);
}
