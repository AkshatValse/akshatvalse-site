# Building pages on akshatvalse.com: Clarity, exactly

Every page is a page of the Clarity template (shikun.io/projects/clarity, CC0,
Shikun Liu). `Base.astro` links the template's own files, unmodified, from
`public/clarity/`: `assets/stylesheets/main_free.css`, `clarity/clarity.css`,
`assets/scripts/main.js` (slide dots, auto slideshow, code copy buttons),
`assets/scripts/navbar.js` (floating table of contents, on project pages),
Font Awesome Free 7.2.0, highlight.js 9.18.1, and the `img-comparison-slider`
web component. Reference copy of the template: `../clarity-ref/clarity.html`
(the full showcase page) and `../clarity-ref/minimal.html`.

**Rule: write the template's markup and classes, nothing else.** Do not add
CSS that restyles Clarity elements, do not invent card/badge/chip designs, do
not add shadows. A scoped `<style>` is allowed only for genuinely new things
(an SVG diagram's internals, a widget's internals). The only departures the
owner approved: rounded covers and figures (radius 10px, handled globally),
native dark mode (handled globally in `src/styles/global.css`), and the
shikun.io-style nav bar.

## Page skeleton (project pages)

```astro
---
import ProjectLayout from '../../layouts/ProjectLayout.astro';
import Container from '../../components/clarity/Container.astro';
import Icon from '../../components/clarity/Icon.astro';
---
<ProjectLayout slug="langevin"
  description="≤ 160 chars, name the method and the problem in plain words"
  authors="Akshat Valse, with David Herzog"
  affiliation="Department of Mathematics, Iowa State University"
  abstract="2–4 sentences"
  buttons={[{ label: 'Code', href: 'https://github.com/…', icon: 'github' }]}
  info="Ongoing · NSF DMS-2246491"
  cover={{ src: '/research/langevin/x.webp', alt: '…', width: 1600, height: 1000 }}>
  <Container first> <h1>Introduction</h1> <p class="text">…</p> </Container>
  <Container width="large" tone="gray"> <img class="fig" src=… alt=…> <p class="caption"><b>Figure 1.</b> …</p> </Container>
  …
</ProjectLayout>
```

- Title page: `ProjectLayout` renders Clarity's `#first-content` (title,
  `p.author` lines, `p.abstract`, `.info` buttons, venue line, `.blog-cover`).
  Pass `cover` for an image cover (foreground + blurred background, as in the
  template), or a `<Fragment slot="cover">` for a custom one (a diagram, a
  live-figure poster). With neither, the project's thumbnail is used.
- Icons (Font Awesome Free): paper, pdf, code, mail, github, linkedin, cv,
  quote, arrow, arrow-left, external, flask, play, pause, copy, check, book,
  chart, data.

## Containers (`Container.astro` → `<div class="container blog …">`)

`width`: `main` (text) · `large` · `extra-large` · `extra-extra-large` · `max`.
`tone`: `gray` (figures and diagrams) · `gray-linear` (soft gallery band).
`first` on the first container after the title page.

Clarity's rhythm, as in clarity.html: a `main` container with `<h1>` and
`<p class="text">`; then a `main gray` / `large gray` / `extra-large gray`
container holding the figure and its `<p class="caption">`; then text again.

## Text (Clarity classes)

- Section heading: `<h1>` inside a `main` container. Sub-section: `<h2>`.
  navbar.js builds the table of contents from exactly these, so every section
  of a project page starts with an `<h1>` in a `main` container.
- Paragraph: `<p class="text">`. Lists: `<ul><li><p class="text">…</p></li></ul>`.
- Caption: `<p class="caption">`, starting `<b>Figure N.</b>`. Variants
  `caption inline`, `caption inline center` (short captions in gray-linear bands).
- Tables: `<div class="table-wrapper"><table><thead>…<tbody>…</table></div>`.
- Code: `<CodeBlock code={…} lang="bash" />` → `<pre><code>`; main.js adds the copy button.
- Buttons: `<a class="button icon" href>Label <Icon name="…" /></a>` (label first, icon after).
- Math: `import Tex from '../../components/Tex.astro'`, `<Tex src={String.raw`…`} />`
  (inline) or `block`. Server-rendered KaTeX.

## Clarity design features

- Images: `<img class="fig" …>` (class `fig` lets dark mode invert white-background plots).
  Grids: `<div class="columns-2|3|4|5|6">` with a `<div>` per cell (img + caption).
- Slide Display: `Slides.astro` (`count`, optional `labels`), followed by
  `<div class="slide-content">` panels. ONE per page (main.js uses an id).
- Auto Slideshow: `Carousel.astro` inside `<Container width="max" tone="gray">`,
  children `<div class="slider-item">` (an `<img>` or `.thumb`, then `p.caption`).
  ONE per page.
- Comparison Display: `Compare.astro` (`before after beforeLabel afterLabel alt`),
  usually two of them in `columns-2` inside `extra-large gray`. Only for two
  images of the same frame and axes.
- Selection Display: `Selector.astro` (`label`, `lead`, `trail`, `options`, `alt`),
  usually inside `main gray` or in `columns-2`.
- Comment layout: `NoteRow.astro` → `container blog main comment` with a
  right-hand `content-comment` column (shown at ≥ 1200 px only, as in Clarity).
- Live simulations (import from `../../components/`): `TrapFigure`,
  `DiffusionSampler n=`, `HeroSim priority={false}`, `DiffusivityFigure n=`,
  `RareEventFigure n=`. Each at most once per page, inside a gray container.

## Diagrams

Inline SVG with `class="diagram"`, a `viewBox`, `role="img"`, `aria-label`.
Classes: `box`, `box soft`, `box dark`, `line`, `dash`, `muted-t`. Colors only
through tokens (`var(--ink)`, `var(--ink-2)`, `var(--panel)`, `var(--ground)`,
`var(--rule-strong)`, cividis `var(--seq-lo|mid|hi)`) so dark mode works.
Page-unique `<marker>` ids. Labels ≥ 12px at 1280px wide. Put diagrams in a
gray container with a `p.caption`.

## Widgets

New widgets: `src/components/widgets/<Prefix><Name>.astro`, TypeScript inline
`<script>`, no dependencies, explicit seeded PRNG, exact reference value shown
next to the output. Markup: `.widget` > `.widget-head` (h3 + `.ref`) +
`.widget-body` (`.widget-plot` + `.controls` > `.control` (label with
`<output>` + range input) + `.readings`). Canvas widgets read colors with
`getComputedStyle(document.documentElement)` and redraw on
`matchMedia('(prefers-color-scheme: dark)')` change.

## SEO (every page)

- `description` ≤ 160 characters, plain words a searcher would type (method,
  problem). The site title already carries "Akshat Valse".
- Every image has a descriptive `alt`. Headings say what the section is.
- Paper pages pass `citation={{ title, authors: ['Valse, Akshat', …], date: 'YYYY/MM/DD', arxivId, pdfUrl, abstractUrl }}`
  to `ProjectLayout` for Google Scholar.
- Link to related project pages where the text genuinely refers to them.
