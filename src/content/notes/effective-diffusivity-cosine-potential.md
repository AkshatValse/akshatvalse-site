---
title: Effective diffusivity in a periodic potential
summary: How fast does a Langevin sampler actually explore a rough landscape? In one periodic dimension the answer is exact, 1/I₀(β)², which makes it a benchmark a sampler either reproduces or fails.
date: 2026-07-30
---

Effective diffusivity is the rate at which a diffusion actually covers ground in
a landscape with barriers, as opposed to the rate it would cover ground with the
barriers removed. It is the quantity that governs how quickly stochastic gradient
Langevin dynamics explores a loss surface, how quickly an annealed sampler
traverses a multimodal target at a given noise level, and how much of a sampler's
nominal step size survives the roughness of what it is stepping through. In
general it is not computable.

In one periodic dimension it is, and the exception earns a page, because it is
one of the few places where a sampler can be audited against an identity instead
of against a longer run of itself.

## Setting and assumptions

Let $V \in C^2(\mathbb R)$ be $L$-periodic and let $\beta > 0$. Consider the
overdamped Langevin diffusion

$$dX_t = -V'(X_t)\,dt + \sqrt{2\beta^{-1}}\,dW_t, \qquad D_0 := \beta^{-1},$$

with $X_0$ deterministic or with any law having finite second moment. Write
$\mathbb T = \mathbb R / L\mathbb Z$ and let $Y_t = X_t \bmod L$ be the projected
process, a diffusion on the torus with generator

$$\mathcal L = -V'(y)\,\partial_y + D_0\,\partial_y^2 .$$

Because $\mathbb T$ is compact and $\mathcal L$ is uniformly elliptic with smooth
coefficients, $Y$ has a unique invariant probability measure, and it is the
Gibbs measure

$$\pi(dy) = \frac{1}{Z}e^{-\beta V(y)}\,dy, \qquad Z = \int_0^L e^{-\beta V}\,dy .$$

The quantity of interest is the effective diffusivity

$$D_{\mathrm{eff}} := \lim_{t\to\infty} \frac{\mathbb E\big[(X_t - X_0)^2\big]}{2t}.$$

Note that $X$ itself is *not* projected: displacement accumulates, and that is
what diffuses.

## The corrector

The drift $b := -V'$ has mean zero under $\pi$:

$$\int_0^L V'(y)e^{-\beta V(y)}\,dy = -\frac{1}{\beta}\int_0^L \frac{d}{dy}e^{-\beta V(y)}\,dy = 0$$

by periodicity. This is exactly the solvability condition for the cell problem, so
by the Fredholm alternative for $\mathcal L$ on $\mathbb T$ there is a
$\chi \in C^2(\mathbb T)$, unique up to an additive constant, with

$$\mathcal L\chi = V' .$$

Apply Itô's formula to $\chi(Y_t)$ and use $\mathcal L \chi = V' = -b$:

$$\chi(Y_t) - \chi(Y_0) = -\int_0^t b(Y_s)\,ds + \sqrt{2D_0}\int_0^t \chi'(Y_s)\,dW_s .$$

Substituting $\int_0^t b(Y_s)\,ds$ back into $X_t - X_0 = \int_0^t b(Y_s)\,ds + \sqrt{2D_0}\,W_t$
gives the martingale decomposition

$$X_t - X_0 = \underbrace{-\big[\chi(Y_t) - \chi(Y_0)\big]}_{\text{bounded}} \;+\; \sqrt{2D_0}\int_0^t \big(1 + \chi'(Y_s)\big)\,dW_s .$$

The first term is bounded uniformly in $t$, because $\chi$ is continuous on a
compact space; it contributes nothing at order $\sqrt t$. The second is a
martingale whose quadratic variation is $2D_0\int_0^t (1+\chi')^2(Y_s)\,ds$, and
the ergodic theorem for $Y$ gives $t^{-1}$ times that converging a.s. to
$2D_0\,\mathbb E_\pi[(1+\chi')^2]$. Hence

$$D_{\mathrm{eff}} = D_0 \int_{\mathbb T} \big(1 + \chi'(y)\big)^2 \,\pi(dy).$$

Two things follow before $\chi$ is even solved for. The formula is a variance, so
$D_{\mathrm{eff}} \ge 0$ automatically, and the same decomposition gives a central
limit theorem, $(X_t - X_0)/\sqrt t \Rightarrow \mathcal N(0, 2D_{\mathrm{eff}})$,
which says more than a statement about second moments would.

## Solving the cell problem

In one dimension the cell problem integrates. Write $\mathcal L\chi = V'$ as

$$D_0\chi'' - V'\chi' = V',$$

and multiply through by $\beta e^{-\beta V}$. Using
$\frac{d}{dy}e^{-\beta V} = -\beta V' e^{-\beta V}$, the left-hand side collapses to
$\big(e^{-\beta V}\chi'\big)'$ and the right-hand side to $-\big(e^{-\beta V}\big)'$, so

$$\Big(e^{-\beta V}\big(1 + \chi'\big)\Big)' = 0 \quad\Longrightarrow\quad 1 + \chi'(y) = C\,e^{\beta V(y)}$$

for a constant $C$. The constant is fixed by requiring $\chi$ to be periodic,
i.e. $\int_0^L \chi' = 0$:

$$L = \int_0^L \big(1+\chi'\big) = C\int_0^L e^{\beta V} \quad\Longrightarrow\quad C = \frac{1}{\langle e^{\beta V}\rangle},$$

writing $\langle f \rangle := L^{-1}\int_0^L f$. Substituting into the variance
formula, with $Z = L\langle e^{-\beta V}\rangle$,

$$D_{\mathrm{eff}} = D_0 \cdot \frac{1}{\langle e^{\beta V}\rangle^{2}} \cdot \frac{1}{Z}\int_0^L e^{\beta V} = \boxed{\;\frac{D_0}{\langle e^{\beta V}\rangle\,\langle e^{-\beta V}\rangle}\;}$$

which is the Lifson–Jackson formula. By Jensen's inequality
$\langle e^{\beta V}\rangle\langle e^{-\beta V}\rangle \ge 1$, with equality only
for constant $V$: a periodic potential can only slow diffusion down, never speed
it up. That is not obvious a priori, since the drift does not always oppose the
motion, and it makes a useful sanity check on any implementation.

## The cosine potential

Take $V(x) = \cos x$, so $L = 2\pi$. Then

$$\langle e^{\pm\beta\cos x}\rangle = \frac{1}{2\pi}\int_0^{2\pi} e^{\pm\beta\cos x}\,dx = I_0(\beta),$$

the modified Bessel function of the first kind; the two signs agree because
$x \mapsto x + \pi$ maps one integrand to the other. With $D_0 = \beta^{-1}$,

$$D_{\mathrm{eff}} = \frac{1}{\beta\,I_0(\beta)^2}.$$

At $\beta = 1$, from the series $I_0(z) = \sum_{k\ge 0} (z^2/4)^k/(k!)^2$,

$$I_0(1) = 1.2660658777520082\ldots, \qquad D_{\mathrm{eff}} = \frac{1}{I_0(1)^2} = 0.6238603604320694\ldots$$

so a cosine barrier of height $2$ at unit temperature costs about $38\%$ of the
free diffusivity.

The cold limit is Arrhenius, as it must be. From
$I_0(\beta) \sim e^{\beta}/\sqrt{2\pi\beta}$ as $\beta\to\infty$,

$$D_{\mathrm{eff}} \sim \frac{1}{\beta}\cdot 2\pi\beta\, e^{-2\beta} = 2\pi e^{-\beta\,\Delta V}, \qquad \Delta V = 2,$$

where $\Delta V = 2$ is exactly the barrier height of $\cos x$ between its
minimum and maximum. The formula reproduces Kramers' law without being told
about it.

## Checking a simulation against it

This is the payoff. Discretise with Euler–Maruyama at step $h$, run $R$
independent replicas with $X_0$ drawn from the periodised Gibbs measure, and
form the mean-squared-displacement estimator

$$\hat D(t) = \frac{1}{R}\sum_{r=1}^{R}\frac{\big(X^{(r)}_t - X^{(r)}_0\big)^2}{2t}.$$

Using the displacement rather than $\operatorname{Var}(X_t)$ matters at small
$t$: the variance estimator carries an $O(1)/2t$ offset from the spread of
$X_0$ and diverges as $t \to 0$, while the displacement estimator starts at
$D_0 = 1$, which is the correct short-time answer.

With $R = 4096$, $h = 10^{-2}$, $\beta = 1$, and standard errors from four
disjoint replica groups:

| $t$ | $\hat D(t)$ | $\pm$ s.e. | rel. dev. |
|---:|---:|---:|---:|
| 1 | 0.87262 | 0.02012 | $+39.9\%$ |
| 10 | 0.64524 | 0.02829 | $+3.4\%$ |
| 100 | 0.60747 | 0.01687 | $-2.6\%$ |
| 1000 | 0.61176 | 0.01861 | $-1.9\%$ |
| 2000 | 0.62181 | 0.00984 | $-0.3\%$ |

The convergence is slow, and it is slow for a structural reason rather than a
statistical one: the systematic part of $\hat D(t)$ decays on the
barrier-crossing timescale, not like $1/t$. At $\beta = 1$ that timescale is
short enough to reach in a browser tab. It would not be at $\beta = 4$, and any
plot that looked this clean at $\beta = 4$ would be evidence of a bug.

The [figure on the research page](/research) runs this estimator live against
the dashed reference $1/I_0(1)^2$.

## Why the exact value earns its keep

Two uses, both about sampling rather than about physics.

First, as a *test*. Any implementation of a Langevin sampler, including the
inner loop of an annealed or score-based one, can be pointed at $V = \cos x$ and
required to return $0.6239$. It is a stronger test than checking a marginal,
because it depends on the sampler's behaviour over long trajectories instead of
at stationarity, and it is where an integrator with a subtly wrong noise scaling
shows up. A sampler that gets the invariant measure right and the diffusivity
wrong has a bug in its time discretisation.

Second, as a *scale*. The Arrhenius form $D_{\mathrm{eff}} \sim 2\pi e^{-eta\Delta V}$
says the cost of roughness is exponential in the barrier and only linear in
anything one might tune. That is the same arithmetic that makes tempering,
annealing, and noise schedules necessary rather than optional: no step size
buys back an exponential. The
[companion note on the Metropolis correction](/notes/what-the-metropolis-correction-buys)
makes the same point from the other direction.

The sampler this note tests is in
[langevin-samplers](https://github.com/AkshatValse/langevin-samplers).

## References

- S. Lifson and J. L. Jackson (1962). On the self-diffusion of ions in a
  polyelectrolyte solution. *Journal of Chemical Physics* 36(9), 2410–2414.
- G. A. Pavliotis and A. M. Stuart (2008). *Multiscale Methods: Averaging and
  Homogenization*. Springer. Chapters 12–13 give the corrector argument in
  general dimension.
- R. Zwanzig (1988). Diffusion in a rough potential. *PNAS* 85(7), 2029–2030.
