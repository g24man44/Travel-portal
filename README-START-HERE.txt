AWARD TRIP DESK — FULL PROJECT (LIVE HOTEL SEARCH DIAGNOSTICS)

This ZIP contains the complete website and Netlify functions.

What changed:
- The hotel function continues paginating the LiteAPI inventory.
- The API response includes diagnostic counts: inventoryRecords (raw rows returned),
  missingCoordinates (rows excluded from the map), and total (usable map hotels).
- Most importantly, the website no longer silently replaces a failed API search with
  ten fake example hotels. It displays the actual failure instead.
- London is already mapped to country code GB in the frontend.

Why this matters:
The previous website had a demoHotels() fallback that generated exactly ten sample
hotels whenever the live API call failed. That made a backend/API failure look like a
valid ten-hotel search. This version surfaces the failure so the real cause can be fixed.

IMPORTANT:
- The project has not been tested against your live LiteAPI account or deployed to Netlify.
- Keep LITEAPI_KEY configured in Netlify environment variables; never place the key in files.

Deployment:
1. Unzip this archive.
2. Upload/commit the files into your existing GitHub repository, preserving structure:
   index.html, netlify.toml, netlify/functions/hotels.mjs, and netlify/functions/rates.mjs.
3. Let Netlify deploy, then search London again. If the API fails, the website will show
   the failure message instead of ten fake hotels. Share that message and we can fix the
   underlying cause without guessing.
