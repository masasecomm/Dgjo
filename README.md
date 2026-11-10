# Goodwork jobs website

The site reads its initial job listings from `jobs.json`. A Cloudflare Worker can provide live listings, and the Goodwork Job Manager Chrome extension can add, edit, and remove them.

## Set up the Cloudflare Worker

From the `cloudflare` directory (use `npm.cmd` / `npx.cmd` in Windows PowerShell if script execution blocks the `.ps1` launchers):

1. Install dependencies with `npm.cmd install`.
2. Sign in to Cloudflare with `npx.cmd wrangler login`.
3. Create a KV namespace with `npx.cmd wrangler kv namespace create JOBS`, and add its ID to `cloudflare/wrangler.jsonc`.
4. Create a long, unique admin key and set it as a Worker secret with `npx.cmd wrangler secret put ADMIN_TOKEN`. Enter the same key in the Chrome extension when connecting. Do not put this key in the repository or website code.
5. Deploy with `npm.cmd run deploy`.

The API URL is printed by Wrangler and ends in `/api/jobs`. `GET /api/jobs` returns the published listings. `PUT /api/jobs` replaces them and requires the admin key.

## Connect the website

The website is configured to read live listings from `https://goodwork-jobs-api.dpsajobs.workers.dev/api/jobs`. GitHub Pages serves the live job list from the Worker; when the Worker is unavailable, the page displays the static `jobs.json` listings with a notice.

## Use the custom domain

The repository includes a `CNAME` file for `dpsagovernmentjobs.co.za`. In Cloudflare DNS, point the apex to GitHub Pages using `A` records for `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, and `185.199.111.153`; point `www` to `masasecomm.github.io` with a `CNAME` record. Remove the existing Vercel `CNAME` records for `@` and `www` when making the switch. Keep unrelated TXT records. Use DNS-only proxy status while GitHub provisions HTTPS, then enable Cloudflare proxying only if needed. DNS and certificate changes may take time to propagate.

## Load the Chrome extension

1. Open `chrome://extensions` in Google Chrome and turn on **Developer mode**.
2. Select **Load unpacked** and choose this repository's `extension` folder.
3. Click the Goodwork Job Manager extension icon to open the full-page admin dashboard.
4. Enter the Worker API URL and admin key, then select **Connect and save**. Approve Chrome's prompt to access the Worker.
5. Add, edit, or delete listings. Changes are published immediately and appear on the website.

The extension remembers the Worker URL and admin key in Chrome's local extension storage on this browser profile. These credentials are not synced by the extension or sent to the website, but they are not separately encrypted by the extension; anyone with access to this Chrome profile or device may be able to access them. Use **Forget saved credentials** to remove them from this browser. The extension asks for site access only to the Worker origin you enter.
