const CACHE="alt-radar-shell-v5",SHELL=["/","/manifest.webmanifest","/icon-192.png","/icon-512.png","/og.png"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{const r=e.request;if(r.method!=="GET"||new URL(r.url).pathname.startsWith("/api/"))return;e.respondWith(fetch(r).then(response=>{const copy=response.clone();caches.open(CACHE).then(c=>c.put(r,copy));return response}).catch(()=>caches.match(r).then(hit=>hit||caches.match("/"))))});

/* Push: wakes the worker with the site closed. The payload is intentionally
   empty, so the content is fetched here rather than encrypted in transit —
   see lib/web-push.ts for why that trade-off was chosen. */
self.addEventListener("push",e=>{e.waitUntil((async()=>{
let t="ALT RADAR PRO",b="Hay un aviso nuevo en el radar.",u="/";
try{const r=await fetch("/api/alerts/latest",{cache:"no-store"});
if(r.ok){const d=await r.json();if(d&&d.title){t=d.title;b=d.body||b;u=d.url||u}}}catch{void 0/* Offline or the endpoint failed: show the generic text rather than nothing, since userVisibleOnly requires a notification either way. */}
await self.registration.showNotification(t,{body:b,icon:"/icon-192.png",badge:"/icon-192.png",
tag:"alt-radar-alert",renotify:true,data:{url:u}})})())});

/* Tapping the notification focuses an open tab instead of opening a second
   one, which is what every messaging app does and what people expect. */
self.addEventListener("notificationclick",e=>{e.notification.close();
e.waitUntil((async()=>{const url=(e.notification.data&&e.notification.data.url)||"/";
const all=await self.clients.matchAll({type:"window",includeUncontrolled:true});
for(const c of all){if("focus" in c)return c.focus()}
if(self.clients.openWindow)return self.clients.openWindow(url)})())});
