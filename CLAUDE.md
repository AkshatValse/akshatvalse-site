# Notes for agents working in this repository

- **Never fetch the production site (akshatvalse.com) to check your work.** Every fetch of a page is a row in the visit log. Check against the local build (`npm run build`, then `npm run preview`) or a preview deployment, which never logs.
- If production must be fetched, add `?nolog=1` to the URL (such a request is never logged), or send the header `X-No-Log: 1`.
- Never write visitor data (the output of `npm run visitors`, rows from the database) into the repo, a commit, a pull request, an issue or a CI log. This repository is public.
- Never add an identifier of a reader to the log: no IP address or hash of one, no cookie, no fingerprint, no user-agent string. If a change seems to need one, stop and ask.
- If you change what is logged, change `analytics/visit.js` (header), the README section "Visitor analytics" and `src/pages/privacy.astro` together; `npm run test:visits` checks that they agree.
- Before pushing anything that changes `functions/` or `analytics/`, run `npm run test:visits`.
