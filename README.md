# Award Trip Desk: your own website

This folder is the full Award Trip Desk site with a live hotel map. It runs on Netlify for free at low traffic.

## What you need
1. **A LiteAPI key** for hotel data (names, map locations, photos, nightly prices). Sign up at liteapi.travel and copy your API key from the dashboard. A sandbox key (starts with `sand_`) returns test data and is fine for trying it out.
2. **A Netlify account** (free) at netlify.com.
3. **Optional:** a free MapTiler key for map tiles once you have real traffic. See `config.js`.

## Put it online
1. Make a free GitHub account, create a new repository, and upload everything in this folder.
2. In Netlify, choose **Add new site → Import an existing project** and pick that repository. Leave the build settings as they are.
3. In Netlify, open **Site configuration → Environment variables** and add `LITEAPI_KEY` with your key.
4. Click **Deploy**. Your site gets a free `something.netlify.app` address. You can connect your own domain under **Domain management**.

Until the key is added, the hotel map shows example pins so you can see how it works.

## Good to know
- The hotel map shows **cash** prices from LiteAPI. The site then works out the cheapest way to pay with each card's points.
- Flight points prices are typical saver prices, not live award seats.
- The request inbox and owner dashboard from the Claude version need Claude's storage, so they don't run here. The "Request help" form still lets people copy their trip details and send them to you.
- To change the photos, replace the files in `img/` and keep the same names.

## Every flight (Duffel)

1. Make a free account at duffel.com. In the dashboard, open Developers → Access tokens and create a token.
2. In Netlify: Project configuration → Environment variables → Add a variable. Key: `DUFFEL_TOKEN`, value: your token. Save.
3. Deploys → Trigger deploy → Deploy site.

A test token only returns Duffel's practice airline ("Duffel Airways"). For real airlines, finish Duffel's live activation in their dashboard and swap in the live token.
