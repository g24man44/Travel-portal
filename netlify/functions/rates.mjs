// Lowest price for up to 50 hotels at a time (the ones in view on the map).
export default async (req) => {
  const u = new URL(req.url);
  const ids = (u.searchParams.get("ids") || "").split(",").filter(Boolean).slice(0, 50);
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
  if (!ids.length || !checkin || !checkout) return json({ prices: {} });

  try {
    const res = await fetch("https://api.liteapi.travel/v3.0/hotels/rates", {
      method: "POST",
      headers: { "X-API-Key": key, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ hotelIds: ids, occupancies: [{ adults }], currency: "USD", guestNationality: "US", checkin, checkout }),
    });
    if (!res.ok) return json({ prices: {}, error: "rates_failed", status: res.status });
    const data = (await res.json()).data || [];
    const prices = {};
    for (const r of data) {
      let min = Infinity;
      for (const rt of r.roomTypes || []) {
        const a = rt.offerRetailRate?.amount ?? rt.rates?.[0]?.retailRate?.total?.[0]?.amount;
        if (typeof a === "number" && a < min) min = a;
      }
      if (min < Infinity) prices[r.hotelId] = min;
    }
    return json({ prices });
  } catch (e) {
    return json({ prices: {}, error: "rates_failed" });
  }
};

export const config = { path: "/api/rates" };
