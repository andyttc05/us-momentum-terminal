# Privacy

US Momentum Terminal is a static research application hosted on GitHub Pages.
Market publications are public JSON files and the application does not require
an account.

When automatic refresh is configured, the browser requests a short-lived
Cloudflare Turnstile assertion before contacting the Cloudflare Worker. The
Worker sends that assertion to Cloudflare for server-side verification and
forwards only a refresh request to GitHub Actions. GitHub credentials and the
Turnstile secret remain in Cloudflare and are never sent to the browser.

A custom-date backtest follows the same path: the chosen date range, portfolio
and sizing settings are stored in the Worker's Durable Object storage for at
most 24 hours, and a GitHub Actions runner reads them to perform the
calculation. The result is returned to the browser that submitted it, which
holds the only access token for that job. To enforce rate limits the Worker
stores a truncated irreversible hash of the requesting address for 15 minutes;
the address itself is not retained.

Turnstile processing is governed by Cloudflare's
[Turnstile Privacy Addendum](https://www.cloudflare.com/turnstile-privacy-policy/).
The application does not use the refresh or backtest flow to create user
profiles or sell personal data.
