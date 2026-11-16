# DPSA Government Jobs website

The public site is an independent guide to South African public service vacancy circulars and applications. It links to the official DPSA circular page and Z83 form. Any job summaries added through the manager must be checked against the linked department advert.

## Set up the Cloudflare Worker

From the `cloudflare` directory (use `npm.cmd` / `npx.cmd` in Windows PowerShell if script execution blocks the `.ps1` launchers):

1. Install dependencies with `npm.cmd install`.
2. Sign in to Cloudflare with `npx.cmd wrangler login`.
3. Create a KV namespace with `npx.cmd wrangler kv namespace create JOBS`, and add its ID to `cloudflare/wrangler.jsonc`.
4. Create a long, unique admin key and set it as a Worker secret with `npx.cmd wrangler secret put ADMIN_TOKEN`. Enter the same key in the Chrome extension when connecting. Do not put this key in the repository or website code.
5. Deploy with `npm.cmd run deploy`.

The API URL is printed by Wrangler and ends in `/api/jobs`. `GET /api/jobs` returns the published listings. `PUT /api/jobs` replaces them and requires the admin key. The Worker accepts up to 2,000 listings, subject to the 20 MB storage limit. Redeploy the Worker after updating this repository so it accepts imported vacancy details and preserved circular PDF links.

The Worker config binds the branded `jobs.dpsagovernmentjobs.co.za` custom domain and keeps the existing `workers.dev` endpoint enabled for the website and extension API. Cloudflare must host the `dpsagovernmentjobs.co.za` zone for the custom domain to deploy. Vacancy pages and their sitemap use the branded subdomain.

## Public website

GitHub Pages serves the static guide pages in this repository. The Cloudflare Worker serves crawlable vacancy detail pages at `https://jobs.dpsagovernmentjobs.co.za/jobs/<job-id>/`, a linked vacancy index at `/jobs/`, and a live `/sitemap.xml` and `/robots.txt` for those pages. The homepage links to the Worker vacancy index and to each vacancy page. The static root sitemap covers the GitHub Pages guide pages; the Worker sitemap covers its own host. Submit both sitemap URLs in Google Search Console after deployment.

The Worker removes vacancies with an explicit past closing date from public API results and the live sitemap. A closed detail URL returns HTTP 410 with `noindex`. When a department is unavailable, the site labels it as unverified rather than claiming the South African Public Service is the employer. The importer uses the same neutral placeholder so missing department data is easy to review in the extension.

Vacancy detail pages include unique titles, descriptions, canonical URLs, full advert details, and links to the official source. `JobPosting` JSON-LD is emitted when a real hiring organization, publication date, complete description, physical job location, and official source are available. An expiry date is included when the advert provides one; if it is missing, it is omitted rather than invented. Verified corrections cover legacy Circular 41 records, while future imports use department and centre headings in the source circular. The public homepage points vacancy links at the branded Worker custom domain; the `workers.dev` hostname remains available for the API.

The static fallback `jobs.json` starts empty.

The DPSA circular and application pages summarize public instructions in original wording and link readers to the official DPSA source. The public site applies the shared formatter to requirements, duties, and notes on every displayed listing; the Chrome extension also formats those fields for every circular-imported post before review and publishing. Vacancy cards display all-caps titles in normal capitalization and introduce the department, closing date, centre/location, appointment type, and circular page when those details are available. Imported circular page numbers are retained with each post. Visual line wraps are joined so sentences are not split, category labels stay with their first point, and detected PDF hyperlinks remain clickable. Confirm current publication dates, vacancy requirements and closing dates on the original department advert.

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
5. Add, edit, or delete listings. Jobs from any location can appear on the public homepage.
6. To import DPSA vacancies, first run `npm.cmd install` and `npm.cmd run build` inside `extension`. Reload the unpacked extension, then choose local PDFs or use **Find DPSA circulars** to see the five newest circulars and their full PDFs. Approve access to the official DPSA website when Chrome asks. Requirements, duties, and notes are sentence-bulleted consistently for all imported posts. Review or edit extracted vacancies before publishing selected jobs. Scanned PDFs without selectable text cannot be imported automatically. **Download Excel** exports the current review; **Clear import** only clears the review and does not remove published jobs.

The extension remembers the Worker URL and admin key in Chrome's local extension storage on this browser profile. These credentials are not synced by the extension or sent to the website, but they are not separately encrypted by the extension; anyone with access to this Chrome profile or device may be able to access them. Use **Forget saved credentials** to remove them from this browser. The extension asks for site access only to the Worker origin you enter and the DPSA website when importing circulars.
