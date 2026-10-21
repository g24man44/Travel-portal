// Every flight for a route and date, from Duffel. Needs DUFFEL_TOKEN in Cloudflare: Settings → Variables and Secrets.
export async function onRequest({ request: req, env }) {
  const u = new URL(req.url);
  const q = (k) => (u.searchParams.get(k) || "").trim();
  const from = q("from").toUpperCase(), to = q("to").toUpperCase(), date = q("date"), ret = q("ret");
  const adults = Math.min(9, Math.max(1, parseInt(q("adults") || "1", 10)));
  const cabin = ["economy", "premium_economy", "business", "first"].includes(q("cabin")) ? q("cabin") : "economy";
  const token = env.DUFFEL_TOKEN;
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "cache-control": "public, max-age=600" },
    });
  if (!token) return json({ error: "missing_key" });
  const iata = /^[A-Z]{3}$/, day = /^\d{4}-\d{2}-\d{2}$/;
  if (!iata.test(from) || !iata.test(to) || !day.test(date)) return json({ error: "bad_request" }, 400);

  const slices = [{ origin: from, destination: to, departure_date: date }];
  if (day.test(ret)) slices.push({ origin: to, destination: from, departure_date: ret });

  try {
    const res = await fetch("https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=8000", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Duffel-Version": "v2",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        data: {
          slices,
          passengers: Array.from({ length: adults }, () => ({ type: "adult" })),
          cabin_class: cabin,
          max_connections: 1,
        },
      }),
    });
    if (!res.ok) return json({ error: "search_failed", status: res.status });
    const d = (await res.json()).data || {};
    const offers = (d.offers || []).map((o) => ({
      id: o.id,
      price: parseFloat(o.total_amount),
      currency: o.total_currency,
      airline: o.owner?.name || "",
      code: o.owner?.iata_code || "",
      slices: (o.slices || []).map((s) => {
        const segs = s.segments || [];
        const first = segs[0] || {}, last = segs[segs.length - 1] || {};
        return {
          dur: s.duration || "",
          from: first.origin?.iata_code || s.origin?.iata_code || "",
          to: last.destination?.iata_code || s.destination?.iata_code || "",
          dep: first.departing_at || "",
          arr: last.arriving_at || "",
          stops: Math.max(0, segs.length - 1),
          via: segs.slice(0, -1).map((g) => g.destination?.iata_code).filter(Boolean),
          segs: segs.map((g) => ({
            carrier: g.marketing_carrier?.name || "",
            code: g.marketing_carrier?.iata_code || "",
            num: g.marketing_carrier_flight_number || "",
            op: g.operating_carrier?.name || g.marketing_carrier?.name || "",
          })),
        };
      }),
    }));
    return json({ test: d.live_mode === false, offers });
  } catch (e) {
    return json({ error: "search_failed" });
  }
}
