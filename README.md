# akshatvalse.com

Personal research site. Astro, no UI framework, no client-side dependencies.

Every figure on the site is a simulation running in the reader's browser, and
every one of them is checked against a closed-form answer before it ships. The
checks are the scripts in `scripts/verify-*.mjs`; their output is quoted in the
figure captions, so a caption that disagrees with a fresh run is a bug.

## The three simulations

| | object | reference value | check |
|---|---|---|---|
| Fig. 1 | overdamped Langevin in `V = cos x + cos y` on the torus, `β = 2` | Gibbs measure `∝ exp(−βV)`; `E[cos X] = −I₁(β)/I₀(β)` | `verify-gibbs.mjs` |
| Fig. 2 | reverse-time VP-SDE with the exact score of a 6-component Gaussian mixture | true mixture weights, means, and `σ` | `verify-diffusion.mjs` |
| Fig. 3 | effective diffusivity in `V = cos x`, `β = 1` | Lifson–Jackson, `1/I₀(1)² = 0.6238603604…` | `verify-diffusivity.mjs` |

Current results: total variation `1.0e-3` against the Gibbs marginal over 48
bins; recovered mixture weights within `0.006` of truth at a Monte Carlo floor of
`0.0035`; `D̂(2000) = 0.6218 ± 0.0098` against `0.62386`.

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
  JavaScript is under 7 KB gzipped on the heaviest page.
- **Color encodes a quantity.** cividis appears only inside figures, where it
  maps a potential or a log-density. Nothing else on the site is coloured, and
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
Build command           npm run build
Build output directory  dist
```

Leaving them blank does not fail the build. Pages falls back to uploading the
repository root, which serves the source tree at the project URL and returns 404
for every page of the actual site. Framework preset "Astro" fills in the same
two values if you would rather pick it from the list.

`public/_redirects` keeps `/cv` pointing at the current CV file, so the URL on
applications does not break when the file is renamed.

Set `SITE_URL` if the domain changes; it feeds the sitemap, canonical URLs, and
`robots.txt`.

## Search and social

`public/og.png` is the link-preview card. It is rendered by `node scripts/gen-og.mjs`
using headless Chrome and the site's own woff2 files, then committed, so a Linux build
box never has to reproduce it. Re-run it after changing the name, the tagline or the
hero, then rebuild.

`node scripts/submit-indexnow.mjs` pushes the sitemap's URLs to IndexNow, which covers
Bing, Yandex, Seznam and Naver, and through Bing also DuckDuckGo and Ecosia. Google has
no equivalent and has to be reached through Search Console.

## Checks

`npm run verify` runs all four verification scripts. Each ends in a CONTRACT
block that asserts its tolerance and exits non-zero on a breach, so the numbers
quoted in the figure captions cannot drift without failing the build. Measured
values are recorded next to each tolerance so drift shows up in a diff.

GitHub Actions runs them on every push, on pull requests, and weekly. The
Cloudflare build command is `npm run verify:fast && npm run build`, so a
tolerance breach in the two quick checks also blocks the deploy; the two slow
ones (about 100 s combined) run in Actions rather than on every deploy.
