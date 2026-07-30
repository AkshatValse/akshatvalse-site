---
title: Grading a diffusion model when you know the answer
summary: A Gaussian mixture is closed under the variance-preserving forward kernel, so the score is exact and the sampler can be marked on mode coverage rather than judged on whether its output looks plausible.
date: 2026-07-30
---

Sample quality metrics for generative models are mostly proxies. FID compares
two sets of Inception features; a human rater compares an image to a memory.
Neither can answer the question a probabilist would ask first, *is this the right
distribution?*, because in general the right distribution is unknown.

In general. It does not have to be unknown in the setting where you are debugging
the sampler, and that is the setting this note is about.

## The forward process, and why a mixture is the right toy

Song et al.'s continuous-time formulation replaces DDPM's discrete chain with
the variance-preserving SDE

$$dX_t = -\tfrac12\beta(t)X_t\,dt + \sqrt{\beta(t)}\,dW_t, \qquad t\in[0,1],$$

with $\beta$ increasing, linearly from $0.1$ to $20$ in the standard schedule.
It is a linear SDE, so its transition kernel is Gaussian:

$$X_t \mid X_0 \sim \mathcal N\big(\alpha_t X_0,\; (1-\alpha_t^2)\,I\big), \qquad \alpha_t = \exp\Big(-\tfrac12\int_0^t\beta(s)\,ds\Big).$$

That fact is what makes training tractable, since it lets you sample $X_t$
directly from $X_0$ without simulating the forward process. It has a second
consequence that gets used far less often: a Gaussian mixture is closed under a
Gaussian kernel. If

$$p_0 = \sum_{k=1}^K w_k\,\mathcal N(\mu_k, \sigma^2 I), \qquad \text{then} \qquad p_t = \sum_{k=1}^K w_k\,\mathcal N\big(\alpha_t\mu_k,\; v_t I\big), \quad v_t = \alpha_t^2\sigma^2 + 1 - \alpha_t^2,$$

for *every* $t$, and therefore the score is available in closed form,

$$\nabla\log p_t(x) = \sum_{k=1}^K r_k(x,t)\,\frac{\alpha_t\mu_k - x}{v_t}, \qquad r_k(x,t) = \frac{w_k\,\mathcal N(x;\alpha_t\mu_k, v_t I)}{\sum_j w_j\,\mathcal N(x;\alpha_t\mu_j, v_t I)},$$

a responsibility-weighted average of the directions toward each noised centre.
In practice $r_k$ should be formed through a log-sum-exp: in the far tails every
component underflows, and the normalised form still returns the correct
direction where the raw ratio returns $0/0$.

## An oracle sampler

Anderson's time reversal turns the forward SDE into

$$dX = \Big[-\tfrac12\beta(t)X - \beta(t)\nabla\log p_t(X)\Big]dt + \sqrt{\beta(t)}\,d\bar W,$$

run from $t=1$ down to $t\approx 0$ with $X_1 \sim \mathcal N(0,I)$. Substituting
the exact score rather than a trained network gives a sampler with no
approximation error in the score. This is the *predictor* half of a
predictor–corrector sampler, and DDPM's ancestral update in the continuum limit.
Discretising with Euler–Maruyama backwards by a step $\Delta > 0$:

$$X \leftarrow X + \Delta\Big[\tfrac12\beta(t)X + \beta(t)\,s(X,t)\Big] + \sqrt{\beta(t)\Delta}\;\xi, \qquad \xi\sim\mathcal N(0,I).$$

Every error this sampler makes is now attributable to the time discretisation,
the prior mismatch at $t=1$, or a bug. None of it can be blamed on the network,
because there is no network.

## What to grade it on

Take $K=6$ in two dimensions, $\sigma = 0.26$, and (this is the part that
matters) unequal weights:

$$w = (0.28,\; 0.22,\; 0.17,\; 0.14,\; 0.11,\; 0.08).$$

Equal weights would hide the interesting failure. A sampler that drops or
under-weights a mode still emits individually plausible points: every sample sits
on the data manifold, and no marginal check will flag it. Only the *proportions*
will, and proportions are exactly what a generative model is usually not held
to.

Assign each sample to its nearest mean and compare the empirical weights to the
truth. With $n$ samples the Monte Carlo standard error on $\hat w_k$ is
$\sqrt{w_k(1-w_k)/n}$, so the noise floor is known in advance and a deviation
can be called significant or not. Running $n = 16{,}384$ samples through $320$
reverse steps:

| $k$ | $\mu_k$ | $w_k$ | $\hat w_k$ | s.e. | $\lVert\hat\mu_k - \mu_k\rVert$ | $\hat\sigma_k$ |
|---:|:---|---:|---:|---:|---:|---:|
| 0 | $(-2.5,\ 0.9)$ | 0.28 | 0.2815 | 0.0035 | 0.0067 | 0.2616 |
| 1 | $(-0.9,-0.9)$ | 0.22 | 0.2219 | 0.0032 | 0.0059 | 0.2621 |
| 2 | $(0.6,\ 1.0)$ | 0.17 | 0.1703 | 0.0029 | 0.0026 | 0.2646 |
| 3 | $(2.4,\ 0.5)$ | 0.14 | 0.1340 | 0.0027 | 0.0076 | 0.2636 |
| 4 | $(1.5,-1.0)$ | 0.11 | 0.1100 | 0.0024 | 0.0045 | 0.2626 |
| 5 | $(-2.2,-0.7)$ | 0.08 | 0.0822 | 0.0021 | 0.0096 | 0.2711 |

The largest weight deviation is $0.0060$, against a standard error of $0.0035$
on the largest component, so under two standard errors, and the sampler is not
detectably mis-weighting anything at this sample size. Means land within $0.010$
and the recovered spread is $0.262$ to $0.271$ against $\sigma = 0.26$.

A step-count sweep at $n = 8192$ is flatter than one might hope:

| steps | $\max_k\lvert\hat w_k - w_k\rvert$ | TV(weights) |
|---:|---:|---:|
| 40 | 0.0112 | 0.0161 |
| 80 | 0.0113 | 0.0145 |
| 160 | 0.0089 | 0.0126 |
| 320 | 0.0046 | 0.0077 |
| 640 | 0.0098 | 0.0113 |

The Monte Carlo floor at $n = 8192$ is $\sqrt{0.28\cdot 0.72/8192} = 0.0050$, so
these rows are within a factor of two of pure noise, and the sweep is
underpowered to resolve the discretisation error in the weights. I would rather
say that plainly than present the table as evidence of convergence. Resolving it
would take either far more samples or a lower-variance functional, which is the
same problem and the same fix as measuring Euler–Maruyama's bias in the
[unadjusted Langevin case](/notes/what-the-metropolis-correction-buys).

## What this does and does not show

None of this is a claim about real diffusion models. A six-component Gaussian
mixture in two dimensions is not CIFAR-10, and a closed-form score is not a
U-Net. The narrower claim, which I think is the more useful one, is that the
parts of a generative pipeline that are not the network can be tested exactly and
mostly are not. The sampler, the schedule, the discretisation, and the choice of
solver order all have measurable error against a target you can write down.
Testing them there is cheap, and it separates "the model is wrong" from "the
sampler is wrong" before the two get confounded on real data.

The [figure on the front page](/) runs this sampler live and reports
$\max_k|\hat w_k - w_k|$ at the end of each pass, at $n = 640$ where the noise
floor is $0.018$.

## References

- Y. Song, J. Sohl-Dickstein, D. P. Kingma, A. Kumar, S. Ermon and B. Poole
  (2021). Score-based generative modeling through stochastic differential
  equations. *ICLR*.
- B. D. O. Anderson (1982). Reverse-time diffusion equation models.
  *Stochastic Processes and their Applications* 12(3), 313–326.
- J. Ho, A. Jain and P. Abbeel (2020). Denoising diffusion probabilistic
  models. *NeurIPS*.
