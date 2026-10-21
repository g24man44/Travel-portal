// Award Trip Desk settings. Edit this file, then redeploy.
window.ATD_CONFIG = {
  // Where the hotel search lives. Leave as is on Netlify.
  hotelsApi: "/api/hotels",
  ratesApi: "/api/rates",

  // Map tiles. OpenStreetMap's free tiles are fine for testing and light use.
  // For a busy site, make a free MapTiler account and swap in the commented lines.
  tiles: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
    // url: "https://api.maptiler.com/maps/streets-v4/256/{z}/{x}/{y}.png?key=YOUR_MAPTILER_KEY",
    // attribution: '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }
};
