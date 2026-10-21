AWARD TRIP DESK — UPDATED PROJECT BUNDLE

This ZIP contains the website and Netlify functions together:
- index.html
- netlify/functions/hotels.mjs (expanded hotel inventory + batched rate lookup)
- netlify/functions/rates.mjs
- netlify.toml

IMPORTANT BEFORE DEPLOYING
1. Keep a backup of your current GitHub repository.
2. This bundle was assembled from the project files available in this chat. The expanded hotels function has not been tested against your live LiteAPI account, so verify it after deploying.
3. Your existing Netlify environment variable LITEAPI_KEY must remain configured. Never put the API key in index.html or commit it to GitHub.
4. Upload/replace these files in the same paths in your repository, or use the included files to create a separate test deployment first.
5. Netlify should publish from the repository root and use netlify/functions, as set in netlify.toml.

The hotel function requests up to 500 inventory entries and looks up rates in batches. Provider pagination, response formats, quotas, and function runtime limits can affect results. Flight award estimates in the website remain estimates; this bundle does not add live airline award availability.
