// Hotel search for the map. Runs on Netlify so your LiteAPI key stays private.
// Set LITEAPI_KEY in Netlify: Site configuration → Environment variables.
export default async (req) => {
  const u = new URL(req.url);
  const city = (u.searchParams.get("city") || "").trim();
  const country = (u.searchParams.get("country") || "US").toUpperCase();
  const checkin = u.searchParams.get("checkin");
  const checkout = u.searchParams.get("checkout");
  const adults = Math.max(1, parseInt(u.searchParams.get("adults") || "2", 10));
  const key = process.env.LITEAPI_KEY;
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "cache-control": "public, max-age=900" },
    });

  if (!key) return json({ error: "missing_key" });
  if (!city) return json({ error: "missing_city" }, 400);

  const base = "https://api.liteapi.travel/v3.0";
  const headers = { "X-API-Key": key, accept: "application/json", "content-type": "application/json" };

  // 1. Hotels in the city, with map coordinates
  const q = new URLSearchParams({ countryCode: country, cityName: city, limit: "80" });
  const listRes = await fetch(`${base}/data/hotels?${q}`, { headers });
  if (!listRes.ok) return json({ error: "hotel_list_failed", status: listRes.status }, 502);
  const list = (await listRes.json()).data || [];
  const hotels = list
    .map((h) => ({
      id: h.id,
      name: h.name,
      lat: h.latitude,
      lng: h.longitude,
      address: h.address || "",
      stars: h.stars || null,
      photo: h.main_photo || h.thumbnail || "",
      price: null,
      currency: "USD",
    }))
    .filter((h) => h.lat && h.lng);

  // 2. Lowest price for the stay (total, in USD)
  if (checkin && checkout && hotels.length) {
    try {
      const rateRes = await fetch(`${base}/hotels/rates`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          hotelIds: hotels.slice(0, 50).map((h) => h.id),
          occupancies: [{ adults }],
          currency: "USD",
          guestNationality: "US",
          checkin,
          checkout,
        }),
      });
      if (rateRes.ok) {
        const rates = (await rateRes.json()).data || [];
        const byId = Object.fromEntries(hotels.map((h) => [h.id, h]));
        for (const r of rates) {
          const h = byId[r.hotelId];
          if (!h) continue;
          let min = Infinity;
          for (const rt of r.roomTypes || []) {
            const a = rt.offerRetailRate?.amount ?? rt.rates?.[0]?.retailRate?.total?.[0]?.amount;
            if (typeof a === "number" && a < min) min = a;
          }
          if (min < Infinity) h.price = min;
        }
      }
    } catch (e) {
      // Prices are optional; the map still shows hotels without them.
    }
  }

  return json({ source: "liteapi", hotels });
};

export const config = { path: "/api/hotels" };
