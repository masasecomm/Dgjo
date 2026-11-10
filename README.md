# Goodwork jobs website

The site reads its initial job listings from `jobs.json`. A Cloudflare Worker can provide live listings, and the Goodwork Job Manager Chrome extension can add, edit, and remove them.

## Set up the Cloudflare Worker

From the `cloudflare` directory:

1. Install Node.js, then run `npm install`.
2. Sign in to Cloudflare with `npx wrangler login`.
3. Create a KV namespace: `npx wrangler kv namespace create JOBS`.
4. Put the namespace ID from the command output in `cloudflare/wrangler.jsonc`, replacing `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.
5. Create a long, unique admin key and set it as a Worker secret: `npx wrangler secret put ADMIN_TOKEN`. Enter the same key in the Chrome extension when connecting. Do not put this key in the repository or website code.
6. Deploy with `npm run deploy`.

The API URL is printed by Wrangler and ends in `/api/jobs`. `GET /api/jobs` returns the published listings. `PUT /api/jobs` replaces them and requires the admin key.

## Connect the website

The website is configured to read live listings from `https://goodwork-jobs-api.dpsajobs.workers.dev/api/jobs`. GitHub Pages serves the live job list from the Worker; when the Worker is unavailable, the page displays the static `jobs.json` listings with a notice.

## Load the Chrome extension

1. Open `chrome://extensions` in Google Chrome and turn on **Developer mode**.
2. Select **Load unpacked** and choose this repository's `extension` folder.
3. Open **Goodwork Job Manager**, enter the Worker API URL and the admin key you set above, then select **Connect to jobs**. Approve Chrome's prompt to access that Worker.
4. Add, edit, or delete listings. Changes are published immediately and appear on the website.

The extension asks for permission only for the Worker origin you enter. It does not save the admin key; closing its popup clears it.
