# Privacy

US Momentum Terminal is a static research application hosted on GitHub Pages.
Market publications are public JSON files and the application does not require
an account.

When automatic refresh is configured, the browser requests a short-lived
Cloudflare Turnstile assertion before contacting the Cloudflare Worker. The
Worker sends that assertion to Cloudflare for server-side verification and
forwards only a refresh request to GitHub Actions. GitHub credentials and the
Turnstile secret remain in Cloudflare and are never sent to the browser.

Turnstile processing is governed by Cloudflare's
[Turnstile Privacy Addendum](https://www.cloudflare.com/turnstile-privacy-policy/).
The application does not use the refresh flow to create user profiles or sell
personal data.
