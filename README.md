# Theta Chi Projects Checkout

Touch-first checkout software for Theta Chi Projects. It can run with sample data for interface testing or connect to the chapter's Google Sheet through a free Google Apps Script web app.

## Upgrade an existing Projects installation

This package is a direct upgrade of the earlier checkout, not a separate system.

1. Keep the existing Google Sheet, Orders tab, Apps Script project, and `/exec` backend URL.
2. Replace the frontend files in the existing hosted website/repository with the files from this package. This preserves the public website address.
3. Copy the same existing `/exec` URL into the new `config.js`.
4. Update the existing Apps Script project with `google-apps-script/Code.js` and `google-apps-script/Achievements.js`. From the linked `google-apps-script` folder, `npx --yes @google/clasp push` uploads both files.
5. In Apps Script, choose **Deploy → Manage deployments**, edit the existing web-app deployment, select **New version**, and deploy. The `/exec` URL remains unchanged.

Do not paste pieces of the new visual code into the old frontend. Replacing the frontend files as a set avoids mixing incompatible HTML, CSS, and JavaScript versions.

## What is included

- Four-digit roster keypad with automatic brother lookup
- Per-person Skin Shop with four free checkout looks, purchase streaks, and quiet button sounds
- Achievement stars and progress on member confirmation
- Cart achievement progress preloaded during shopping and shown after purchase
- Alphabetized active-pledge picker
- Live products and prices loaded from Google Sheets
- Product navigation: **Recents**, **Food**, **Drinks**, and **Other**
- Flavor submenus that keep multi-flavor brands off the main product grids
- Cart, review, completion, success, and automatic reset screens
- Durable on-device queue for purchases waiting on Wi-Fi
- Automatic retry every 30 seconds and whenever the device reconnects
- Server-side duplicate protection and price-total calculation
- Fire HD 8 landscape layout

## Test the interface locally first

1. Set `useLocalTestData: true` in `config.js` (the Apps Script URL can remain in place).
2. Serve this folder locally, for example with `python3 -m http.server 8000`, then open `http://localhost:8000` in Chrome.
3. Enter sample roster `1001`, or select **Pledges** and choose a name.

Other sample roster numbers are `2047` and `3189`. Local test purchases stay in the browser and are never sent to Apps Script while `useLocalTestData` is true. Set it to `false` to use the configured Apps Script URL and live Sheet data.

In local test mode, the Skin Shop and checkout screens are available, but achievement totals and purchase projections need the live Apps Script. The projection request starts after an item is added to the cart and does not hold up checkout.

## Publish these changes

1. After reviewing locally, upload `google-apps-script/Code.js` and `google-apps-script/Achievements.js` to the existing Apps Script project. If clasp is linked, run `npx --yes @google/clasp push` from `google-apps-script/`. This uploads code but does not deploy a new web-app version.
2. In Apps Script, choose **Deploy → Manage deployments**, edit the current web-app deployment, select **New version**, and deploy. This enables the read-only `achievementPreview` endpoint while preserving the existing `/exec` URL.
3. Confirm `config.js` has `useLocalTestData: false`, then commit and push the frontend changes to the GitHub branch used by the hosted site. If GitHub Pages is serving `main`, review `git status`, then run `git add README.md index.html app.js achievements-client.js achievements-v2.css styles.css ui-polish.css backend.js config.js google-apps-script tests .gitignore`, `git commit -m "Add cart achievement previews and Skin Shop"`, and `git push origin main` from this repository.
4. Open the hosted site and reload once to pick up the versioned frontend assets. Test a member’s Skin Shop, cart preview, and success screen with a real small purchase.

## Prepare the Google Sheet

Keep these tab names and header names exactly as shown. Headers must be in row 1.

### Brothers

| Roster # | Last Name | First Name | Status |
| --- | --- | --- | --- |
| 1814 | Gold | Colin | Active |

Roster values are automatically normalized to four digits. Only `Active` rows appear on the kiosk.

### Pledges

Recommended layout:

| Pledge ID | Last Name | First Name | Status |
| --- | --- | --- | --- |
| P0001 | Smith | John | Active |

The current three-column layout without **Pledge ID** also works: the backend generates a deterministic internal ID from the name. A permanent Pledge ID is still safer for duplicate names and name corrections. Never reuse a Pledge ID for a different person.

### Products

| Item ID | Item Name | Cost Per | Status | Category | Product Group | Flavor | Image |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1001 | Airheads | $2.00 | Active | Food |  |  | images/airheads.png |
| 2001 | Powerade Mountain Berry Blast | $1.50 | Active | Drinks | Powerade | Mountain Berry Blast | images/powerade-blue.png |

The first digit controls the kiosk category:

- `1xxx` → **Food**
- `2xxx` → **Drinks**
- `3xxx` → **Other**

The **Category** column is retained as a fallback for older IDs, but the ID prefix takes priority. Item IDs containing only digits are normalized to four digits, so a sheet value of `1` is treated as `0001`.

**Product Group** and **Flavor** are optional but recommended for items with multiple flavors. Give every flavor its own Item ID and row, then use the same Product Group value for the family. The main menu shows one family button; tapping it opens the individual flavors. If these columns are absent, the interface also recognizes common families by item name: Alani Nu, Powerade, Premier Protein, Monster, Red Bull, Celsius, Liquid IV, Gatorade, and Sparkling Ice.

### Product images

The recommended approach is to store optimized image files in the website's included `images` folder and put their relative paths in the Products sheet's **Image** column.

- Use lowercase filenames without spaces, such as `images/coke-zero.png`.
- PNG, WebP, JPG, and SVG files work. PNG or WebP with a transparent background usually looks best.
- Crop away excess blank space and keep each file below roughly 200 KB so the kiosk loads quickly.
- Every flavor may use its own image. A grouped family button uses the first available image among its flavor rows.
- Several rows may reuse the same path when the package design is similar.
- GitHub Pages filenames are case-sensitive: `images/Coke.png` and `images/coke.png` are different paths.
- If the Image cell is blank or the file cannot load, the kiosk displays `images/product-placeholder.svg` automatically.

Full `https://...` image URLs also work, but keeping the files in the website repository is more reliable than depending on another retailer's image links.

Do not delete old people or products after purchases exist. Change their status to `Inactive`; this preserves historical references and allows a purchase queued during a Wi-Fi outage to upload later.

## Install the Google Apps Script backend

1. Open the Google Sheet.
2. Choose **Extensions → Apps Script**.
3. Copy `google-apps-script/Code.js` and `google-apps-script/Achievements.js` into the same Apps Script project as files named `Code` and `Achievements`, or use the linked folder's `npx --yes @google/clasp push` command.
4. In the Apps Script editor, select `setupProjectsBackend` from the function menu and press **Run**.
5. Approve Google's authorization prompts. The script creates and formats the **Orders** tab.
6. Choose **Deploy → New deployment**.
7. Select **Web app**.
8. Set **Execute as** to **Me**.
9. Set access to **Anyone** so the dedicated kiosk can submit without exposing your Google account on the tablet.
10. Deploy and copy the URL ending in `/exec`.

If Google asks you to authorize again, use the Google account that owns or can edit the spreadsheet. After changing the Apps Script files later, edit the existing deployment and create a new version so the live URL receives the update.

## Connect the interface

Open `config.js` and paste the `/exec` URL:

```javascript
window.PROJECTS_CONFIG = {
  useLocalTestData: false,
  appsScriptUrl: "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
};
```

Reload `index.html`. A connected kiosk first loads the live Brothers, Pledges, and Products tabs. If that initial load fails, checkout locks instead of silently using sample prices.

## Test the live backend

1. Add a temporary active brother, pledge, and product to the Sheet if needed.
2. Reload the interface and confirm the live names and products appear.
3. Complete a small test purchase.
4. Confirm one or more rows appear in **Orders** with the same Transaction ID.
5. Double-tap is safe: the server ignores a repeated Transaction ID.
6. Temporarily disconnect Wi-Fi after the interface has loaded, complete another test purchase, and reconnect. The purchase should upload automatically within 30 seconds.

Each product in a multi-item purchase gets its own Orders row. The Transaction ID and Order Total repeat so the treasurer can filter, sum, or create a pivot table easily.

## How purchase safety works

1. The browser creates a unique Transaction ID.
2. The complete purchase is written to persistent device storage before the network request begins.
3. The server takes a script lock so two simultaneous requests cannot race.
4. It checks whether the Transaction ID already exists.
5. It writes every item row to Orders in one range operation.
6. Only after the server confirms success does the browser remove the purchase from its pending queue.

If Wi-Fi fails, the confirmation explicitly says the purchase is saved on the device for retry. Do not clear browser/site data on the tablet while purchases are pending.

## Project files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell, header, footer, and asset loading |
| `styles.css` | Touch layout and black, white, `#CE112D` styling |
| `ui-polish.css` | Member theme backgrounds, Skin Shop, and purchase progress layout |
| `products.js` | Sample data used in local test mode |
| `config.js` | Local test switch and deployed Google Apps Script URL |
| `backend.js` | Live data requests, durable queue, and retry logic |
| `app.js` | Screens, member selection, cart, and checkout flow |
| `achievements-client.js` | Achievement caching and read-only cart projections |
| `images/` | Product artwork and the automatic fallback image |
| `google-apps-script/Code.js` | Spreadsheet and order backend |
| `google-apps-script/Achievements.js` | Achievements, leaderboard, purchase streaks, and cart projection |
| `google-apps-script/appsscript.json` | Apps Script manifest |

## Preview the tablet size

In Chrome Developer Tools, enable the device toolbar and set the viewport to **1280 × 800** in landscape orientation.

At this size the page itself never scrolls. The product grid and cart-item list scroll independently, while the running total and **Place order** button remain pinned on screen. The review screen follows the same rule: only its item list scrolls; its total and **Confirm order** button stay visible.
