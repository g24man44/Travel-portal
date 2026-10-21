// Every hotel in a city, with map locations. Runs on Netlify so your LiteAPI key stays private.
// Set LITEAPI_KEY in Netlify: Project configuration → Environment variables.
export default async (req) => {
  const u = new URL(req.url);
  const city = (u.searchParams.get("city") || "").trim();
  const country = (u.searchParams.get("country") || "US").toUpperCase();
  const key = process.env.LITEAPI_KEY;
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
    });
  if (!key) return json({ error: "missing_key" });
  if (!city) return json({ error: "missing_city" }, 400);

  const base = "https://api.liteapi.travel/v3.0";
  const headers = { "X-API-Key": key, accept: "application/json" };
  const hotels = [];
  const pageSize = 1000;
  // Up to 5,000 hotels per city, fetched in pages of 1,000
  for (let offset = 0; offset < 5000; offset += pageSize) {
    const q = new URLSearchParams({ countryCode: country, cityName: city, limit: String(pageSize), offset: String(offset) });
    const res = await fetch(`${base}/data/hotels?${q}`, { headers });
    if (!res.ok) {
      if (offset === 0) return json({ error: "hotel_list_failed", status: res.status }, 502);
      break;
    }
    const page = (await res.json()).data || [];
    for (const h of page) {
      if (!h.latitude || !h.longitude) continue;
      hotels.push({
        id: h.id,
        name: h.name,
        lat: h.latitude,
        lng: h.longitude,
        address: h.address || "",
        stars: h.stars || null,
        photo: h.main_photo || h.thumbnail || "",
      });
    }
    if (page.length < pageSize) break;
  }
  return json({ source: "liteapi", total: hotels.length, hotels });
};

export const config = { path: "/api/hotels" };
