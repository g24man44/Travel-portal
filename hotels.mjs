// Award Trip Desk — expanded hotel search for Netlify.
// Keeps the existing /api/hotels response shape and keeps LITEAPI_KEY server-side.
// Configure LITEAPI_KEY in Netlify environment variables.

const BASE = "https://api.liteapi.travel/v3.0";
const PAGE_SIZE = 100;
const MAX_HOTELS = 500; // Protects function runtime and provider quota; increase after testing.
const RATE_BATCH_SIZE = 50; // LiteAPI rates requests are grouped into manageable batches.
const RATE_CONCURRENCY = 2;
const CACHE_SECONDS = 900;

export default async (req) => {
  const u = new URL(req.url);
  const city = (u.searchParams.get("city") || "").trim();
  const country = (u.searchParams.get("country") || "US").trim().toUpperCase();
  const checkin = (u.searchParams.get("checkin") || "").trim();
  const checkout = (u.searchParams.get("checkout") || "").trim();
  const adults = Math.min(10, Math.max(1, Number.parseInt(u.searchParams.get("adults") || "2", 10) || 2));
  const key = process.env.LITEAPI_KEY;

  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${CACHE_SECONDS}`,
    },
  });

  if (!key) return json({ error: "missing_key", message: "Set LITEAPI_KEY in Netlify environment variables." }, 500);
  if (!city) return json({ error: "missing_city" }, 400);
  if ((checkin && !checkout) || (!checkin && checkout)) return json({ error: "both_dates_required" }, 400);
  if (checkin && checkout && checkout <= checkin) return json({ error: "invalid_dates" }, 400);

  const headers = { "X-API-Key": key, accept: "application/json", "content-type": "application/json" };
  const hotels = [];
  let inventoryTruncated = false;

  // Fetch inventory in pages instead of stopping after the first 80 results.
  for (let offset = 0; offset < MAX_HOTELS; offset += PAGE_SIZE) {
    const params = new URLSearchParams({
      countryCode: country,
      cityName: city,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    let res;
    try {
      res = await fetch(`${BASE}/data/hotels?${params}`, { headers });
    } catch {
      return json({ error: "hotel_list_unreachable", message: "Could not reach the hotel data provider." }, 502);
    }
    if (!res.ok) {
      if (offset === 0) return json({ error: "hotel_list_failed", status: res.status }, 502);
      // Return inventory already retrieved, with a warning, if a later page fails.
      inventoryTruncated = true;
      break;
    }
    const payload = await res.json();
    const page = Array.isArray(payload.data) ? payload.data : [];
    for (const h of page) {
      if (h.latitude == null || h.longitude == null) continue;
      hotels.push({
        id: h.id,
        name: h.name || "Unnamed hotel",
        lat: h.latitude,
        lng: h.longitude,
        address: h.address || "",
        stars: h.stars || null,
        photo: h.main_photo || h.thumbnail || "",
        price: null,
        currency: "USD",
        priceStatus: checkin && checkout ? "not_checked" : "dates_required",
      });
    }
    if (page.length < PAGE_SIZE) break;
    if (offset + PAGE_SIZE >= MAX_HOTELS) inventoryTruncated = true;
  }

  // Price all retrieved hotels in small batches. Run only a few batches at once
  // to reduce provider throttling and serverless-function pressure.
  let rateLookupFailed = false;
  if (checkin && checkout && hotels.length) {
    const byId = new Map(hotels.map((h) => [String(h.id), h]));
    const batches = [];
    for (let i = 0; i < hotels.length; i += RATE_BATCH_SIZE) {
      batches.push(hotels.slice(i, i + RATE_BATCH_SIZE));
    }
    let nextBatch = 0;
    const worker = async () => {
      while (nextBatch < batches.length) {
        const batch = batches[nextBatch++];
        try {
          const res = await fetch(`${BASE}/hotels/rates`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              hotelIds: batch.map((h) => h.id),
              occupancies: [{ adults }],
              currency: "USD",
              guestNationality: "US",
              checkin,
              checkout,
            }),
          });
          if (!res.ok) {
            rateLookupFailed = true;
            for (const h of batch) h.priceStatus = "lookup_failed";
            continue;
          }
          const payload = await res.json();
          const rates = Array.isArray(payload.data) ? payload.data : [];
          const seen = new Set();
          for (const r of rates) {
            const h = byId.get(String(r.hotelId));
            if (!h) continue;
            seen.add(String(r.hotelId));
            let min = Infinity;
            for (const room of (r.roomTypes || [])) {
              const candidates = [
                room.offerRetailRate?.amount,
                room.rates?.[0]?.retailRate?.total?.[0]?.amount,
              ];
              for (const value of candidates) {
                const amount = typeof value === "number" ? value : Number(value);
                if (Number.isFinite(amount) && amount > 0 && amount < min) min = amount;
              }
            }
            if (min < Infinity) {
              h.price = min;
              h.priceStatus = "priced";
            } else {
              h.priceStatus = "no_rate_returned";
            }
          }
          for (const h of batch) {
            if (!seen.has(String(h.id))) h.priceStatus = "no_rate_returned";
          }
        } catch {
          rateLookupFailed = true;
          for (const h of batch) h.priceStatus = "lookup_failed";
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(RATE_CONCURRENCY, batches.length) }, worker));
  }

  return json({
    source: "liteapi",
    city,
    country,
    total: hotels.length,
    inventoryLimit: MAX_HOTELS,
    inventoryTruncated,
    rateLookupFailed,
    pricing: checkin && checkout ? "requested" : "dates_required",
    hotels,
  });
};

export const config = { path: "/api/hotels" };
