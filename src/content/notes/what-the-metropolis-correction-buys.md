---
title: What the Metropolis correction buys, and what it does not
summary: The unadjusted Langevin algorithm is SGLD without the minibatch noise. On a Gaussian target its stationary law is exact, so the bias can be measured against a formula, and a metastable target then shows that removing the bias does nothing for the harder problem.
date: 2026-07-30
---

The unadjusted Langevin algorithm is the Euler–Maruyama discretisation of a
diffusion that leaves the target invariant. It is ergodic, it is cheap, and it
is wrong: its invariant law is not the target. Metropolising the same proposal
restores exactness at the cost of an accept/reject step.

ULA deserves naming, because it is not a niche MCMC method.
Stochastic gradient Langevin dynamics is ULA with the gradient replaced by a
minibatch estimate; the inner loop of annealed Langevin sampling is ULA at a
fixed noise level; the corrector step of a predictor–corrector diffusion sampler
is ULA against the current marginal's score. In every one of those the
Metropolis correction is dropped, usually without comment, and the discretisation
bias is inherited. What that costs is therefore a practical question, and it is
almost never measured, because measuring it seems to require knowing the target.

The usual workaround is to run both samplers for a long time and treat the
longer run as truth, which is circular. On a Gaussian target it is unnecessary,
because the unadjusted chain's stationary law is available in closed form.

## The unadjusted chain on a Gaussian is an AR(1)

Take $\pi = \mathcal N(0, \operatorname{diag}(s_1^2,\dots,s_d^2))$, so
$\nabla \log \pi(x) = -x/s^2$ coordinatewise. The ULA update

$$X_{k+1} = X_k + h\,\nabla\log\pi(X_k) + \sqrt{2h}\,\xi_k, \qquad \xi_k \sim \mathcal N(0, I),$$

is then a decoupled first-order autoregression in each coordinate,

$$X_{k+1} = a X_k + \sqrt{2h}\,\xi_k, \qquad a = 1 - \frac{h}{s^2}.$$

It is geometrically ergodic exactly when $|a| < 1$, that is when
$0 < h < 2s^2$; past that the chain diverges, and the ceiling is set by the
*narrowest* direction, $h < 2\min_i s_i^2$. Its stationary variance solves
$v = a^2 v + 2h$, so

$$v(h) = \frac{2h}{1-a^2} = \frac{s^2}{1 - h/2s^2}, \qquad v(h) - s^2 = \frac{h/2}{1 - h/2s^2} = \frac{h}{2} + O(h^2).$$

Three things fall out. The chain over-disperses at every admissible step size,
since $v(h) > s^2$ always. The leading-order variance inflation is $h/2$
*independently of the scale* $s$, so the absolute bias is the same in every
coordinate while the relative bias is worst where the target is narrowest. And
since $\pi_h$ is Gaussian with known variances, the induced Wasserstein error is
explicit: $W_2^2 = \sum_i (\sqrt{v_i} - s_i)^2$ with
$\sqrt{v_i} - s_i = h/(4 s_i) + O(h^2)$, giving

$$W_2(\pi_h, \pi) = \frac{h}{4}\Big(\sum_i s_i^{-2}\Big)^{1/2} + O(h^2),$$

first order in $h$, as the general theory (Dalalyan; Durmus–Moulines) predicts.

The point of having $v(h)$ is that a simulation can be *required* to reproduce
it. A measured variance that disagrees indicts the sampler, not the theory.

## Measurements

On $s = (0.5, 1, 2)$, with conditioning $4{:}1$ and stability limit
$h^\ast = 0.5$, across ten step sizes and three coordinates the measured ULA variance agrees
with $v(h)$ in all $30$ cases to within three Monte Carlo standard errors, at a
Monte Carlo error of $0.14$–$0.29\%$. At $h = 0.4$, four fifths of the way to
the stability limit:

| | coordinate 1 | coordinate 2 | coordinate 3 |
|---|---:|---:|---:|
| ULA, measured | 1.2479 | 1.2488 | 4.2085 |
| ULA, exact $v(h)$ | 1.25 | 1.25 | 4.2105 |
| MALA, measured | 0.2494 | 1.0003 | 4.0075 |
| target $s^2$ | 0.25 | 1 | 4 |

MALA hits the target, as it must. What it costs is visible in the acceptance
rate, which falls from $0.999$ to $0.595$ across the same sweep. That is the
whole trade in one line: ULA's error is a bias you cannot average away, MALA's
is a cost you pay in rejected proposals.

## Where the correction stops helping

Now replace the Gaussian with a separated two-component mixture and sweep the
*barrier* rather than the step size. For a symmetric mixture with means
$\pm\mu$ and common scale $s$, the relevant barrier in the effective potential
$-\log\pi$ is

$$\Delta(\mu) = \frac{\mu^2}{2s^2} - \log 2,$$

and Kramers' law predicts a crossing rate scaling like $e^{-\Delta}$, so
$\log(\text{rate})$ against $\Delta$ should have slope $-1$. Starting every
chain in the left well and fitting:

| sampler | slope | $R^2$ |
|---|---:|---:|
| ULA | $-0.948$ | 0.998 |
| MALA | $-1.032$ | 0.999 |

Both bracket the prediction. And past $\mu \approx 4$ both stop crossing
entirely: by $\mu = 5$, where $\Delta = 11.8$, ULA records zero crossings with
all 32 chains still in the well they started in, and MALA is equally stuck.

The Metropolis correction buys nothing here, and the reason is worth stating
precisely. MALA is unbiased *in stationarity*. A chain that has not crossed the
barrier is nowhere near stationarity, so the guarantee is vacuous: it certifies a
limit the run never approaches. Correcting the discretisation does not make the
chain mix.

## What to take from it

Bias is polynomial in $h$ and fixable: halve the step, or Metropolise, or use a
higher-order scheme. Mixing is exponential in the barrier, and none of those
touch it. The two failure modes call for different tools, and the ones that work
on mixing are preconditioning, tempering, replica exchange, or a better proposal,
none of which is what the accept/reject step does.

The practical reading is that an acceptance rate is a diagnostic for the first
problem and says nothing about the second. A run can report $0.6$ acceptance,
pass every marginal check, and be reporting the well it was started in.

It is also, in miniature, the argument for noise schedules in generative
modelling. A diffusion model does not sample its target with a single Langevin
chain, and could not: the data distribution is exactly the metastable case, with
modes separated by regions of vanishing density. What the forward process buys is
a family of intermediate targets whose barriers are smoothed away at high noise
and reintroduced gradually, so that mixing never has to cross a barrier of height
$\Delta$ at all. That makes the schedule the answer to a mixing time exponential
in the barrier, rather than a trick for sample quality, and the
[effective-diffusivity note](/notes/effective-diffusivity-cosine-potential) gives
the exponent in the one case where it can be written down.

The measurements come from [langevin-samplers](https://github.com/AkshatValse/langevin-samplers),
which runs the whole sweep from a seed and writes a sidecar with the parameters
and the resolved commit next to every result.

## References

- G. O. Roberts and R. L. Tweedie (1996). Exponential convergence of Langevin
  distributions and their discrete approximations. *Bernoulli* 2(4), 341–363.
- G. O. Roberts and J. S. Rosenthal (1998). Optimal scaling of discrete
  approximations to Langevin diffusions. *JRSS-B* 60(1), 255–268.
- A. S. Dalalyan (2017). Theoretical guarantees for approximate sampling from
  smooth and log-concave densities. *JRSS-B* 79(3), 651–676.
- A. Durmus and É. Moulines (2017). Nonasymptotic convergence analysis for the
  unadjusted Langevin algorithm. *Annals of Applied Probability* 27(3),
  1551–1587.
