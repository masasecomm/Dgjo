# DPSA Government Jobs website

The public site is an independent guide to South African public service vacancy circulars and applications. It links to the official DPSA circular page and Z83 form. Any job summaries added through the manager must be checked against the linked department advert.

## Set up the Cloudflare Worker

From the `cloudflare` directory (use `npm.cmd` / `npx.cmd` in Windows PowerShell if script execution blocks the `.ps1` launchers):

1. Install dependencies with `npm.cmd install`.
2. Sign in to Cloudflare with `npx.cmd wrangler login`.
3. Create a KV namespace with `npx.cmd wrangler kv namespace create JOBS`, and add its ID to `cloudflare/wrangler.jsonc`.
4. Create a long, unique admin key and set it as a Worker secret with `npx.cmd wrangler secret put ADMIN_TOKEN`. Enter the same key in the Chrome extension when connecting. Do not put this key in the repository or website code.
5. Deploy with `npm.cmd run deploy`.

The API URL is printed by Wrangler and ends in `/api/jobs`. `GET /api/jobs` returns the published listings. `PUT /api/jobs` replaces them and requires the admin key. Redeploy the Worker after updating this repository so it accepts the official advert URL field.

## Public website

GitHub Pages serves the static guide pages in this repository. `robots.txt` and `sitemap.xml` provide crawler directions and list the public pages. The Worker and Chrome extension provide managed job cards; the public page displays only listings whose location includes “South Africa”. The static fallback `jobs.json` starts empty, so the former US demo jobs are not advertised.

The DPSA circular and application pages summarize public instructions in original wording and link readers to the official DPSA source. Confirm current publication dates, vacancy requirements and closing dates on the original department advert.

## Search visibility and legacy pages

The site publishes `sitemap.xml` and `robots.txt`; after deployment, submit the sitemap in Google Search Console and inspect indexing there. The supplied Search Console export includes high-traffic legacy vacancy and circular URLs that are not present in this repository and currently return 404. Their original contents cannot be recovered from that performance report. Restore those pages from the previous host or provide verified source content before creating replacements or redirects; do not invent vacancy details or `JobPosting` structured data.

## Use the custom domain

The repository includes a `CNAME` file for `dpsagovernmentjobs.co.za`. In Cloudflare DNS, point the apex to GitHub Pages using `A` records for `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, and `185.199.111.153`; point `www` to `masasecomm.github.io` with a `CNAME` record. Remove the existing Vercel `CNAME` records for `@` and `www` when making the switch. Keep unrelated TXT records. Use DNS-only proxy status while GitHub provisions HTTPS, then enable Cloudflare proxying only if needed. DNS and certificate changes may take time to propagate.

## Google Analytics

The site loads the Google tag `GT-NMDDFKGP` and configures the Google Analytics 4 measurement ID `G-69H0HQGRT9` from the page head. Use Google Tag Assistant or the Analytics Realtime report to verify incoming visits.

## Load the Chrome extension

1. Open `chrome://extensions` in Google Chrome and turn on **Developer mode**.
2. Select **Load unpacked** and choose this repository's `extension` folder.
3. Click the DPSA Government Jobs Manager extension icon to open the full-page admin dashboard.
4. Enter the Worker API URL and admin key, then select **Connect and save**. Approve Chrome's prompt to access the Worker.
5. Add, edit, or delete listings. Include an HTTPS advert URL and “South Africa” in the location; only South African listings appear on the public homepage.

The extension remembers the Worker URL and admin key in Chrome's local extension storage on this browser profile. These credentials are not synced by the extension or sent to the website, but they are not separately encrypted by the extension; anyone with access to this Chrome profile or device may be able to access them. Use **Forget saved credentials** to remove them from this browser. The extension asks for site access only to the Worker origin you enter.
