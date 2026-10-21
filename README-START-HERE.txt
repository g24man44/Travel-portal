AWARD TRIP DESK — FULL PROJECT (HOTEL PAGINATION FIX)

This ZIP contains the complete website and Netlify functions.

What's changed:
- The hotel function now continues paginating even if LiteAPI returns fewer
  than the requested number of hotels per response.
- It advances by the actual number of rows returned and stops on an empty page
  or a repeated page, preventing a short first page from ending the search.
- The frontend and rates function are included unchanged.

IMPORTANT:
- This fix is based on the documented LiteAPI offset/limit pagination behavior.
- It has passed a JavaScript syntax check, but has NOT been tested against your
  live LiteAPI account or deployed to Netlify.
- Keep your existing LITEAPI_KEY in Netlify environment variables. Do not put
  the key into these files.

Deployment:
1. Unzip this archive.
2. Upload/commit the files into your existing GitHub repository, keeping the
   same structure: index.html, netlify.toml, netlify/functions/hotels.mjs,
   and netlify/functions/rates.mjs.
3. Allow Netlify to deploy, then run a city hotel search and check the function
   logs if it still returns only ten hotels.
