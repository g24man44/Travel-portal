// Every hotel in a city from OpenStreetMap. Free: no account, no key.
// 1) Nominatim finds the city's area, 2) Overpass lists every hotel inside it.
const UA = "AwardTripDesk/1.0 (https://awardtrip.netlify.app)";
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export default async (req) => {
  const u = new URL(req.url);
  const city = (u.searchParams.get("city") || "").trim();
  const country = (u.searchParams.get("country") || "").trim().toLowerCase();
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "cache-control": "public, max-age=86400" },
    });
  if (!city) return json({ error: "missing_city" }, 400);

  // 1. Where is the city?
  let place;
  try {
    const q = new URLSearchParams({ q: city, format: "json", limit: "1" });
    if (/^[a-z]{2}$/.test(country)) q.set("countrycodes", country);
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${q}`, { headers: { "User-Agent": UA, "Accept-Language": "en" } });
    place = (await r.json())[0];
  } catch (e) {}
  if (!place) return json({ error: "city_not_found" });

  // Box around the city: at least ~10 km across, at most ~110 km.
  let [s, n, w, e] = place.boundingbox.map(Number);
  const lat = Number(place.lat), lon = Number(place.lon);
  const grow = (lo, hi, mid, min, max) => {
    let span = Math.min(Math.max(hi - lo, min), max);
    return [mid - span / 2, mid + span / 2];
  };
  [s, n] = grow(s, n, lat, 0.1, 1);
  [w, e] = grow(w, e, lon, 0.14, 1.4);

  // 2. Every hotel in that box.
  const query = `[out:json][timeout:25];nwr["tourism"="hotel"](${s},${w},${n},${e});out center tags 5000;`;
  let data = null;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "User-Agent": UA, "content-type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
      });
      if (r.ok) { data = await r.json(); break; }
    } catch (e) {}
  }
  if (!data) return json({ error: "hotel_list_failed" });

  const hotels = [];
  for (const el of data.elements || []) {
    const t = el.tags || {};
    const name = t.name || t["name:en"];
    const la = el.lat ?? el.center?.lat, lo = el.lon ?? el.center?.lon;
    if (!name || la == null || lo == null) continue;
    const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
    const stars = parseFloat(t.stars);
    hotels.push({
      id: `${el.type[0]}${el.id}`,
      name: t["name:en"] && /[^\x00-\x7F]/.test(t.name || "") ? t["name:en"] : name,
      lat: la,
      lng: lo,
      address: [street, t["addr:city"]].filter(Boolean).join(", "),
      stars: stars >= 1 && stars <= 5 ? stars : null,
      chain: [t.brand, t.operator].filter(Boolean).join(" "),
      web: t.website || t["contact:website"] || "",
      photo: "",
    });
  }
  return json({ source: "osm", total: hotels.length, hotels });
};

export const config = { path: "/api/hotels" };
