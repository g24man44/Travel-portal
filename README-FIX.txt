Award Trip Desk — Netlify deployment fix

This patch separates the static site from the Netlify Functions source.

Apply these files to the ROOT of your existing GitHub repository:
1. Replace the existing netlify.toml with the one in this ZIP.
2. Add build.mjs.
3. Keep your current index.html, config.js, images, rates.mjs, and
   netlify/functions/hotels.mjs in their current locations.
4. Commit both files to main.
5. Trigger a deploy from the connected Git repository, not a manual file upload.

The build script copies the existing root-level static site files into dist.
It excludes netlify/ so function source files are not published as static files.
It does not include or modify your LiteAPI key.
