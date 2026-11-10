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
(an SVG diagram's internals, a widget's internals). The site follows how
shikun.io uses the template, but the owner asked for his own personality, not a
1:1 copy: the nav marker is a small plane (he is a private pilot), the home
greeting and words are his, and the footer (a "Blue skies" sign-off plus the
credit to Clarity and Shikun Liu) appears on the About page only. Figures and
the portrait keep rounded corners (radius 10px); project covers are square.

**Light only, like shikun.io.** There is no dark scheme. Do not write
`@media (prefers-color-scheme: dark)` rules (in pages, components, widgets or
static SVGs), `<picture>` dark `<source>`s, dark poster variants, or
`matchMedia('(prefers-color-scheme: dark)')` listeners. Colours come from the
light tokens on `:root` in `src/styles/global.css`.

## Site pages: shikun.io's layouts

shikun.io (Shikun Liu's own site, where Clarity comes from) uses the template
in a few plain layouts. The site's versions live in `src/styles/global.css`,
section 1; use those classes and add no new card, badge or shadow designs.

- **Home** (`/`): one full-height, two-column block and nothing else.
  `.home > .home-intro` (`h1.title` "Hi, I'm Akshat.", a short introduction,
  the italic research focus as `p > em`, a line on flying, and one
  `a.button.icon` "Read more" to `/about`) `+ .home-profile > img` (the
  portrait). Stacks to one column on phones. No footer.
- **Listing pages** (Research, About, CV): a plain white title page with no
  band. `<div class="container page" id="first-content">`, inside it
  `.page-title > h1.title + p…` (an intro paragraph, with links).
- **Section titles**: `.section-title > h2`, uppercase and letter-spaced
  (for example "SELECTED PUBLICATIONS").
- **Project grid** (Research): `.project-grid`, three columns on desktop, two
  on tablets, one on phones. Each cell is
  `<div>` > `a.project-cover[style=<p.frame>] > img` (the 3:4 artwork at
  `/research/<slug>/cover-art.svg`, inset at 80% width in a tall 4:5 frame)
  `+ .project-info > p.badge` (the uppercase stage label) `+ h2 > a` (bold
  short title) `+ p` (the one-line subtitle). `ProjectTile.astro` renders it.
- **Publications**: `.paper-list > hr`, then one `.paper-row` per paper:
  `.venue > p` (bold venue as written, e.g. "arXiv 2026") and
  `.paper > p` (title, superscript links `<sup>[Paper]</sup>`, `<br>`, the
  author list with `<b>Akshat Valse</b>`, and `span.status` for work that is
  not out yet).
- **About and CV grid**: `.about-grid`, small uppercase letter-spaced labels
  on the left (`.about-label > p`, "01 / BACKGROUND", "02 / RESEARCH", …) and
  the text on the right (`.about-body`: `p`, `ul > li`,
  `.entry > .entry-head > b + span.when`, `.meta`).
- **Pills**: a project named in running text is an inline rounded link in
  its theme, `<a class="pill" style={p.pill} href="/research/<slug>">Name</a>`;
  add `white` when the project's `ink` is `'light'`.
- **404**: `.not-found > h1 + p + a.button`.

### Colour themes and artwork

The owner chose three colour schemes, all from shikun.io's own project pages:
the title card of /projects/kaleido, and the colours of
/projects/multi-task-attention-network (MTAN) and
/projects/variational-shape-learner (VSL). No green anywhere. They are defined
once in `src/data/themes.ts`; each project in `src/data/projects.ts` names its
`theme` and inherits `band` (title band style), `frame` (grid frame style),
`pill` (pill style), `button` (button background on the band) and `ink`.

| Project | `theme` | text on band |
| --- | --- | --- |
| inside-the-trap | kaleido | dark |
| langevin | mtan | white |
| large-deviations | vsl | dark |
| neural-pde-stability | mtan | white |
| online-calibration | vsl | dark |
| agent-reliability | kaleido | dark |

Each project has one 3:4 artwork (`art`, a 1200x1600 SVG, with `artAlt`),
used, as on shikun.io, both inset in its grid frame and as the banner of its
project page. The covers follow shikun.io's own covers: abstract emblems, each
one bold idea in a few large shapes or one crisp all-over pattern, smooth
gradients or clean flat fills, full-bleed, no text, no thin busy linework, and
each with its own technique (a log-spiral whirl, contour terraces, an
isometric cube field, a row of gradient columns, a staircase over a line,
concentric arcs). Colours come only from the project's theme (Kaleido pastels;
MTAN navy, indigo, purple and coral to apricot; VSL grays and slate with one
blue accent); no green or teal. Each is written by a deterministic script in
`scripts/cover-art/<slug>.mjs` (`npm run cover-art` regenerates all six byte
for byte in about a second). Unpublished projects' artwork is a metaphor for
the public question only, never a result. Never use paper screenshots or
equations as banners. When the art changes, rewrite its `artAlt`.

Describe a project the way shikun.io's project pages do: title "Name:
Descriptive Title"; author line "by A, B, & C" (advisors who are not
co-authors go in the affiliation line, "Advised by …"); a 2–4 sentence
abstract in the first person plural; buttons such as Paper, Code, Live Figure;
the info line is the venue ("arXiv 2026 / cs.DC") or the stage ("Draft in
Advisor Review"); sections Introduction, the design or method, Experiments,
Conclusions, Citation (papers only).

## Page skeleton (project pages)

```astro
---
import ProjectLayout from '../../layouts/ProjectLayout.astro';
import Container from '../../components/clarity/Container.astro';
import Icon from '../../components/clarity/Icon.astro';
---
<ProjectLayout slug="langevin"
  description="≤ 160 chars, name the method and the problem in plain words"
  authors="by Akshat Valse"
  affiliation="Advised by Dr. David Herzog, Department of Mathematics, Iowa State University"
  abstract="2–4 sentences, first person plural"
  buttons={[{ label: 'Code', href: 'https://github.com/…', icon: 'github' }]}
  info="Draft in Advisor Review">
  <Container first> <h1>Introduction</h1> <p class="text">…</p> </Container>
  <Container width="large" tone="gray"> <img class="fig" src=… alt=…> <p class="caption"><b>Figure 1.</b> …</p> </Container>
  …
</ProjectLayout>
```

- Title page: `ProjectLayout` renders Clarity's `#first-content` in the
  project's theme (title, `p.author` lines, `p.abstract`, `.info` buttons,
  venue line) with the project's artwork as the `.blog-cover` banner
  (foreground over its blurred copy, as in the template). Pages pass no cover.
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

- Images: `<img class="fig" …>` for figures (plots on white, as in the papers).
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
`var(--rule-strong)`, cividis `var(--seq-lo|mid|hi)`). `box dark` is a filled
ink box with `var(--ground)` text, not a colour scheme.
Page-unique `<marker>` ids. Labels ≥ 12px at 1280px wide. Put diagrams in a
gray container with a `p.caption`.

## Widgets

New widgets: `src/components/widgets/<Prefix><Name>.astro`, TypeScript inline
`<script>`, no dependencies, explicit seeded PRNG, exact reference value shown
next to the output. Markup: `.widget` > `.widget-head` (h3 + `.ref`) +
`.widget-body` (`.widget-plot` + `.controls` > `.control` (label with
`<output>` + range input) + `.readings`). Canvas widgets read colors from
the light tokens with `getComputedStyle(document.documentElement)`; the
accent is `var(--seq-lo)` (navy).

## SEO (every page)

- `description` ≤ 160 characters, plain words a searcher would type (method,
  problem). The site title already carries "Akshat Valse".
- Every image has a descriptive `alt`. Headings say what the section is.
- Paper pages pass `citation={{ title, authors: ['Valse, Akshat', …], date: 'YYYY/MM/DD', arxivId, pdfUrl, abstractUrl }}`
  to `ProjectLayout` for Google Scholar.
- Link to related project pages where the text genuinely refers to them.
