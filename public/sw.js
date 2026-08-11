const CACHE="alt-radar-shell-v4",SHELL=["/","/manifest.webmanifest","/icon-192.png","/icon-512.png"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{const r=e.request;if(r.method!=="GET"||new URL(r.url).pathname.startsWith("/api/"))return;e.respondWith(fetch(r).then(response=>{const copy=response.clone();caches.open(CACHE).then(c=>c.put(r,copy));return response}).catch(()=>caches.match(r).then(hit=>hit||caches.match("/"))))});
