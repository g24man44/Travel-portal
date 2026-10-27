// 10 service worker: makes the game installable, shows push notifications.
// Pages always come from the network so everyone gets the newest version; a simple page shows if there is no connection.
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
  if(e.request.mode!=='navigate')return;
  e.respondWith(fetch(e.request).catch(()=>new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0e1621;color:#f3ecdc;font:17px system-ui;text-align:center;padding:24px"><div><h1 style="color:#e6bd63;font-family:Georgia,serif">10</h1><p>You are offline. Connect to the internet to play.</p><button onclick="location.reload()" style="font:inherit;padding:12px 20px;border:0;border-radius:12px;background:#e6bd63;color:#20160a;font-weight:700">Try again</button></div></body>',{headers:{'content-type':'text/html'}})));
});
self.addEventListener('push',e=>{
  let d={};try{d=e.data?e.data.json():{}}catch(x){d={body:e.data&&e.data.text()}}
  e.waitUntil((async()=>{
    // if the game is already open on screen, skip the notification (the game shows it itself)
    const cs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    if(cs.some(c=>c.visibilityState==='visible')&&d.tag!=='test')return;
    // iPhones only show the icon, title and text, so give the title a splash of color there
    const ios=/iPhone|iPad|iPod/.test(self.navigator.userAgent||'');let title=d.title||'10';if(ios&&d.emoji&&!title.startsWith(d.emoji))title=d.emoji+' '+title;
    await self.registration.showNotification(title,{body:d.body||'',icon:d.icon||'/icon-192.png',badge:'/badge-96.png',tag:d.tag||'ten',renotify:true,actions:(d.actions||[]).slice(0,2),...(d.image?{image:d.image}:{}),data:{url:d.url||'/'}});
    try{const n=(await self.registration.getNotifications()).length;if(self.navigator.setAppBadge)await self.navigator.setAppBadge(n)}catch(x){}
  })());
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();e.waitUntil((async()=>{try{const n=(await self.registration.getNotifications()).length;if(self.navigator.setAppBadge)n?await self.navigator.setAppBadge(n):await self.navigator.clearAppBadge()}catch(x){}})());if(e.action==='no')return;const url=(e.notification.data&&e.notification.data.url)||'/';
  e.waitUntil((async()=>{const cs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const c of cs){if('focus' in c){await c.focus();try{c.postMessage({t:'open',url})}catch(x){}return}}
    await self.clients.openWindow(url)})());
});
