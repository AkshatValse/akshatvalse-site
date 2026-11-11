# akshatvalse.com

Personal research site. Astro, no UI framework, no client-side dependencies.

The site is built around the preprint *Inside the Trap: A Renewal Law for
Prefix-Cache Collapse in LLM Agent Serving* (Valse and Jannesari,
arXiv:2611.08902). Every figure on the site is a simulation running in the
reader's browser, and every one of them is checked against an exact reference
before it ships: a closed form, or for Fig. 1 the paper's model F and the
paper's own simulator. The checks are the scripts in `scripts/verify-*.mjs`.

## The five simulations

| | page | object | reference value | check |
|---|---|---|---|---|
| Fig. 1 | `/`, `/research/inside-the-trap` | the paper's prefix-cached serving engine (SGLang, A100, 300k-token KV pool) under agent traffic at 1.35 `λ_ref`, a 200-session burst, and the R1 rescue cap | model F: mean served prompt `P_z = 9324.1` in the trap, frozen in the paper's `configs/icml_trap_predict.yaml`; the paper's Python engine, count for count | `verify-trap.mjs` |
| Fig. 2 | `/` | reverse-time VP-SDE with the exact score of a 6-component Gaussian mixture | true mixture weights, means, and `σ` | `verify-diffusion.mjs` |
| Fig. 3 | `/research` | overdamped Langevin in `V = cos x + cos y` on the torus, `β = 2` | Gibbs measure `∝ exp(−βV)`; `E[cos X] = −I₁(β)/I₀(β)` | `verify-gibbs.mjs` |
| Fig. 4 | `/research` | effective diffusivity in `V = cos x`, `β = 1` | Lifson–Jackson, `1/I₀(1)² = 0.6238603604…` | `verify-diffusivity.mjs` |
| Fig. 5 | `/research` | Gaussian-tail estimation by crude Monte Carlo and importance sampling | `P(Z > a) = Φ(−a)` for `Z ~ N(0,1)` | `verify-raretail.mjs` |

Current results, Fig. 1: on the display plan the JavaScript engine reproduces
the paper's Python engine run iteration by iteration
(`engine.batch_decode_iterations=false`) exactly: turns, hits, iterations,
evictions, release time and every completion time, in the three arms of the
paired test E2 and the R1 rescue run (`scripts/trap-golden/` regenerates the
reference; with the paper's default the counts are the same and completion
times agree to about 2e-10 s). The display run was selected from 40 seeds: of
the 9 whose burst sessions all finish before the end, the 5 whose rescue cap
comes off inside the paper's engine range (3,980-4,550 s), and of those the one
whose completion rate is closest to model F's. Its trapped engine's mean served
prompt is `0.9925 P_z`. Over 40 further seeds that played no part in the
choice, every burst run without a cap is stuck at zero hits, the mean served
prompt pools to `1.028 P_z`, and completions average `1.117 lambda_miss`
(0.95 to 1.31).

Figs. 2-5: recovered mixture weights within `0.006` of truth at a Monte Carlo
floor of `0.0035` (Fig. 2); total variation `1.0e-3` against the Gibbs marginal
over 48 bins (Fig. 3); `D̂(2000) = 0.6218 ± 0.0098` against `0.62386` (Fig. 4).

Fig. 1 is deterministic to the last bit in every browser (`src/sim/trap.js`
avoids `Math.log`, whose last bit each JavaScript engine chooses), so the run a
reader sees is the run the check grades, and every number quoted next to it is
computed at build time from that run (`src/sim/trap-facts.js`) rather than copied
by hand.

## Layout

```
src/sim/         simulation cores. Plain ES modules with no DOM access, so the
                 same code runs in the browser, in the verification scripts,
                 and in the build-time poster generator.
src/scripts/     browser entry points: canvas rendering, lazy start, pause
src/components/  Astro components, one per figure
scripts/         verify-*.mjs, gen-posters.mjs, shots.mjs, lighthouse.mjs
```

## Running it

```bash
npm install
npm run dev
```

`npm run build` regenerates the poster frames and then builds. `npm run verify`
runs the correctness checks (about two minutes; they are deliberately not part
of the build).

`node scripts/shots.mjs <outdir>` renders the site across breakpoints, color
schemes, reduced motion, and with JavaScript disabled, against a running
`astro preview`. `node scripts/lighthouse.mjs` scores it under mobile
throttling.

## Constraints the code holds to

- **No plotting or physics libraries.** The integrators are Euler–Maruyama by
  hand, the colormap is a 33-entry cividis table, and the contours come from a
  first-order distance-to-level-set estimate rasterized directly. Total
  JavaScript is 10.4 KB gzipped on the heaviest page (the home page, with
  Figs. 1 and 2), against a budget of 15 KB.
- **Color encodes a quantity.** cividis appears only inside figures, where it
  maps a potential, a log-density or a cache hit fraction. Nothing else on the site is colored, and
  there is no accent color.
- **Correct before any JavaScript runs.** Each figure ships a build-time poster
  of the same simulation, so first paint, `prefers-reduced-motion: reduce`, and
  a browser with scripting off all show a true picture with no layout shift.
- **Nothing runs off-screen.** Islands build lazily on intersection and stop on
  `visibilitychange`.

## Deploying

Static output in `dist/`. On Cloudflare Pages both of these must be set
explicitly under Settings → Build → Build configuration:

```
Build command           npm run verify:fast && npm run build
Build output directory  dist
```

Leaving them blank does not fail the build. Pages falls back to uploading the
repository root, which serves the source tree at the project URL and returns 404
for every page of the actual site. Framework preset "Astro" fills in
`npm run build` and `dist`; prepend `npm run verify:fast && ` to the build command
afterwards (see Checks).

The CV PDF carries a dated filename (`public/akshat-valse-cv-YYYY-MM.pdf`) so no
cache can serve a stale copy after an update; `public/_redirects` keeps `/cv.pdf`
pointing at the current file, so the URL on applications does not break. Bump the
name in `src/pages/cv.astro` and the redirect together.

Set `SITE_URL` if the domain changes; it feeds the sitemap, the canonical and Open
Graph URLs, and the structured data. The domain is also written out by hand in
`public/robots.txt` (the Sitemap line), in the header of `cv/cv.tex` (rebuild the PDF
afterwards) and in the card text of `scripts/gen-og.mjs` (re-run it), and
`scripts/submit-indexnow.mjs` defaults `SITE_HOST` to it.

## Visitor analytics

Two layers, neither using cookies on readers:

- **Cloudflare Web Analytics** (enabled in the Pages project; Cloudflare injects
  its beacon at deploy time, which the CSP in `public/_headers` allows): page
  views, referrers, countries, devices. Dashboard: Workers & Pages →
  akshatvalse-site → Metrics.
- **Network log** (`functions/_middleware.js`, `functions/api/read.js`,
  `analytics/visit.js`, `analytics/read.js`): rows in the D1 database
  `akshatvalse-visits`, with no identifier of a reader. A page view (table
  `visits`) holds the hour, the page, the country, the network's organisation
  name and number (a university, company or ISP), a referrer label (`google`,
  `linkedin`, `stanford.edu`, `internal`, `other`, ...) and, for an internal
  referrer, the path of the page the reader came from (`from_path`), phone or
  desktop, and whether the client was a person, a prefetch, or automated (`bot`),
  with the kind of automated fetch in `bot_kind` (`assistant`, `preview`,
  `search`, `ai-crawler`, `monitor`, `headless`, `script`) derived from the user
  agent and stored instead of it. A CV download is logged as a view of the PDF's
  path. A read (table `reads`) is one beacon sent by `src/scripts/read-beacon.js`
  when a page is hidden or left: the same network fields plus the visible time
  and the deepest scroll, in buckets (`<10s`, `10-30s`, `30s-2m`, `2-5m`, `5-15m`,
  `>15m`; quarters 1 to 4), never raw values. No IP addresses, user agents, full
  referrers, query strings, cookies' contents or identifiers of a reader are
  stored. Rows are deleted after 400 days (checked on about one write in fifty).
  `analytics/visit.js` documents every field; the privacy note at `/privacy`
  (`src/pages/privacy.astro`, linked from the About page's footer) says the same
  in plain words. If you change what is stored, change those three together;
  `npm run test:visits` checks that they still agree with the schema.

What is not logged: a request carrying `Sec-GPC: 1` (Global Privacy Control) or
`DNT: 1`, a request with the header `X-No-Log: 1` (for scripts that cannot change
the URL), the owner's opt-out cookie, and any `?nolog=1` request, which returns
before the database is touched. Turn on Global Privacy Control in your own
browsers (Firefox, Brave and DuckDuckGo send it; Chrome needs an extension) and
you are opted out in private windows too, where the cookie is absent. The CV
PDF is not excluded in `public/_routes.json` on purpose; it is matched in
`analytics/visit.js` by the pattern `/akshat-valse-cv-YYYY-MM.pdf`, and a test
fails if `PROFILE.cvPdf` stops matching it. A PDF viewer fetches in ranges: a
download counts only when the request has no `Range` header or its range starts
at byte 0.

Automated clients are recorded, not blocked. A request with no `Accept-Language`
is automated; so is one whose user agent claims Chrome or Edge 100 or later but
that lacks `Sec-Fetch-Mode` or `Sec-CH-UA` (`headless`; Safari and Firefox are
not held to this, and neither are iOS browsers or Android web views). The
beacon script sends nothing when `navigator.webdriver` is true.

`npm run visitors` (or `npm run visitors -- 7` for a week) prints who has been
reading what: reads (a page visible for 10 s or more), page loads with no
beacon as a weaker line, relay and cloud networks apart, new networks since the
last run, CV downloads, read-time buckets per page, how readers move between
pages, and automated fetches by kind. `-- --edu` keeps university and research
networks; `-- --org "iowa state"` prints one network's page views in order, with
read time and the page the reader came from. It needs `npx wrangler@4.159.0 login`
once. It prints to the terminal only; never commit its output, never run it in
CI (Actions logs on a public repo are public), and keep its two local files out
of the repository: `.visitors-state.json` is git-ignored, and the optional watch
list of networks to highlight lives in `~/.config/akshatvalse/watchlist.txt`
(or the file named by `$VISITORS_WATCHLIST`); the script refuses a watch list
inside the repo. Open `https://akshatvalse.com/?nolog=1` once in each browser
you use so your own visits are not counted (`?nolog=0` undoes it).

Setup: the tables come from `migrations/0001_visits.sql` and
`migrations/0002_reads_and_kinds.sql` (`npx wrangler@4.159.0 d1 execute
akshatvalse-visits --remote --file migrations/000N_....sql`); apply a migration
to the remote database before deploying the code that uses it. The database was
created with `wrangler d1 create akshatvalse-visits` on 2026-11-11. The Pages
project binds it as `VISITS` for the **Production** environment only (Settings →
Bindings), so preview deployments never log, and Settings → Runtime → **Fail
open** is set, so pages keep loading if the free daily Functions quota ever runs
out. The functions only log requests for akshatvalse.com and swallow every
failure (they appear in the Functions log), so a missing binding or a D1 outage
never affects a page. `public/_routes.json` keeps the static folders away from
the middleware. `npm run test:visits` (also in CI) covers the logging rules,
the beacon endpoint, the report's rules and the failure paths.

Cloudflare's free-plan limits matter here (checked 2026-11-11 against the
Pages Functions and D1 pricing pages): Functions requests share the Workers Free
quota of 100,000 per day (static assets are free and unlimited), and D1 allows
100,000 rows written and 5 million rows read per day, 500 MB per database. Each
page view costs one Functions request and a few rows written (an insert also
writes its index row), and a beacon costs another request. When a limit is hit,
logging stops and pages keep loading.

## Search and social

The link-preview cards are `public/og/<slug>.png` (one per research project, set
like that project's title page: the title in regular-weight Poppins, the authors
and affiliation in italics and the venue or stage in small capitals on white,
with the cover artwork inset in its themed frame) and `public/og/site.png` (every
other page: name, tagline and portrait). `ProjectLayout` passes the project's card
to `Base`, which defaults to `site.png`. They are rendered by
`node scripts/gen-og.mjs` using headless Chrome and Poppins from Google Fonts
(it needs a network connection and refuses to write a card in a fallback font),
from the same data as the site (`src/data/projects.ts`, `themes.ts`, the
cover-art SVGs, the portrait, and each project page's `authors`, `affiliation`
and `info` props), then committed, so a Linux build box never has to reproduce
them. The site sets its titles in regular weight, so the cards never use bold.
Re-run it after changing a project's title, subtitle, stage,
theme or artwork, the tagline or the portrait, and commit the PNGs. Social sites
cache cards by URL for days: to refresh a card for already-shared links, rename
the file (and the path in the layout), or re-scrape it in LinkedIn's Post
Inspector. X draws the page title over the bottom left of a large-image card, so
the copy stays in the upper part of the left column.

`node scripts/submit-indexnow.mjs` pushes the sitemap's URLs to IndexNow, which covers
Bing, Yandex, Seznam and Naver, and through Bing also DuckDuckGo and Ecosia. Google has
no equivalent and has to be reached through Search Console.

## Checks

`npm run verify` runs all five verification scripts. Each ends in a CONTRACT
block that asserts its tolerance and exits non-zero on a breach. The checks
validate the simulations. For Figs. 2 to 5 the caption values are manually
recorded snapshots and are not compared automatically with each run; refresh
them when a verification result changes. Fig. 1's numbers are computed at build
time from the run itself. Measured values are also recorded next to each
tolerance for review.

GitHub Actions runs them on every push, on pull requests, and weekly. The
Cloudflare build command (set in the Pages dashboard, not in this repo) is
`npm run verify:fast && npm run build`, so a tolerance breach in the three quick
checks also blocks the deploy; the two slow ones (about 100 s combined) run in
Actions rather than on every deploy. If a script referenced by that command is
renamed or removed, update the dashboard command in the same change: a missing
script fails every deploy within seconds while Actions still passes.
