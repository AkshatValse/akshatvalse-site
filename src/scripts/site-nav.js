/**
 * The navigation bar's behaviour.
 *  - A small plane sits under the current page. Point at another menu link or
 *    social icon and it flies there, facing the way it travels and climbing a
 *    little while it moves; it lands back home when the pointer leaves.
 *  - On phones a button opens the menu as a full-screen panel.
 * With prefers-reduced-motion the plane jumps instead of flying.
 */
const nav = document.getElementById('site-nav');

if (nav) {
  const menu = nav.querySelector('.menu');
  const plane = nav.querySelector('.menu-plane');
  const links = [...nav.querySelectorAll('.menu a, .social a')];
  const current = nav.querySelector('.menu a[aria-current="page"]');
  let x = null;
  let landing = 0;

  const target = (link) => {
    const m = menu.getBoundingClientRect();
    const r = link.getBoundingClientRect();
    return r.left - m.left + r.width / 2 - 7;
  };
  const fly = (link) => {
    if (!plane || !menu || !link) return;
    const to = target(link);
    if (x !== null && Math.abs(to - x) > 1) {
      plane.classList.toggle('west', to < x);
      plane.classList.add('airborne');
      clearTimeout(landing);
      landing = setTimeout(() => plane.classList.remove('airborne'), 450);
    }
    plane.style.left = `${to}px`;
    x = to;
  };
  const home = () => {
    if (!plane) return;
    if (current) { fly(current); plane.style.visibility = ''; }
    else plane.style.visibility = 'hidden';
  };

  /** Put the plane under the current page without flying it there. */
  let hovered = null;
  const settle = () => {
    const at = hovered ?? current;
    if (!at || !plane || !menu) return;
    const keep = plane.style.transition;
    plane.style.transition = 'none';
    x = target(at);
    plane.style.left = `${x}px`;
    void plane.offsetWidth;
    plane.style.transition = keep;
  };
  // Show it straight away (pages with live simulations take long to fire
  // 'load'), then settle again once fonts and layout are final.
  settle();
  home();
  requestAnimationFrame(() => requestAnimationFrame(() => plane?.classList.add('ready')));
  window.addEventListener('load', settle, { once: true });

  for (const a of links) {
    a.addEventListener('mouseenter', () => { hovered = a; fly(a); });
    a.addEventListener('focus', () => { hovered = a; fly(a); });
  }
  nav.querySelector('.site-nav-inner')?.addEventListener('mouseleave', () => { hovered = null; home(); });
  nav.addEventListener('focusout', (e) => { if (!nav.contains(e.relatedTarget)) { hovered = null; home(); } });
  // Mobile browsers fire resize when their toolbars collapse; only a width change moves the links.
  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => { if (window.innerWidth !== lastWidth) { lastWidth = window.innerWidth; settle(); } });
  document.fonts?.ready.then(settle);

  // Phone menu
  const toggle = nav.querySelector('.menu-toggle');
  const setOpen = (open) => {
    nav.classList.toggle('open', open);
    document.body.classList.toggle('nav-open', open);
    toggle?.setAttribute('aria-expanded', String(open));
    // Keep keyboard focus inside the open menu: the page behind it is inert.
    for (const el of document.body.children) if (el !== nav && el.tagName !== 'SCRIPT') el.inert = open;
  };
  toggle?.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) { setOpen(false); toggle?.focus(); } });
  for (const a of links) a.addEventListener('click', () => setOpen(false));
}

// Clarity's main.js and navbar.js build icon-only buttons without names; label them.
const nameButtons = () => {
  for (const b of document.querySelectorAll('.code-copy-btn:not([aria-label])')) b.setAttribute('aria-label', 'Copy code');
  for (const b of document.querySelectorAll('.nav-collapse:not([aria-label])')) b.setAttribute('aria-label', 'Show or hide the contents');
};
nameButtons();
window.addEventListener('DOMContentLoaded', nameButtons);
window.addEventListener('load', nameButtons);
