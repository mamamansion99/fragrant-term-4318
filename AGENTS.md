# Worker Shipping Rule

When the user says "ship it" in this Cloudflare Worker repo:

1. Run `npm test`.
2. Stage the relevant changes with `git add`.
3. Commit with a concise message describing the worker change.
4. Push the current branch to GitHub.
5. Deploy with `npm run deploy` or `wrangler deploy`.
6. Report the test result, commit hash, deployed Worker URL, and Cloudflare version ID.

Prefer the existing `scripts/ship.ps1` flow when it fits the request, because it already handles commit, push, and deploy.
