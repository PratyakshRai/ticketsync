# TicketSync: Vercel par deployment

Ye Vercel adaptation preview/portfolio demo hai. Vercel par WebSockets aur Socket.io support available hai, lekin is project's WebSocket routing, Redis cross-instance events aur concurrent booking ka live integration test abhi nahi hua. Free plans ke limits aur possible cold starts apply hote hain.

## 1. GitHub

ZIP extract karo. ticketsync-vercel folder ke ANDAR ka content ek new GitHub repository ke root par upload karo. package.json, vercel.json, api, server aur client root mein dikhne chahiye. .env aur node_modules upload mat karo.

## 2. Neon PostgreSQL

neon.com par free project aur database create karo. Connect se PostgreSQL connection string copy karo. Secure/TLS connection (sslmode=require) use karo. Username/password secret hai. Dedicated empty database best hai. App first startup par tables aur 60 demo seats create karega. Free plan usage limits aur compute suspend policy provider par check karo.

## 3. Upstash Redis

console.upstash.com par Redis database create karo. TCP/TLS connection URL copy karo jo rediss:// se start hota hai. Read-write token chahiye. Redis ke command, connection aur Pub/Sub quotas apply ho sakte hain. SwiftLink ka existing Redis reuse kar sakte ho, lekin alag database se project isolation easy hoti hai.

## 4. Vercel

Add New > Project se GitHub repository import karo. Root repository root; framework Other; vercel.json build aur output configure karta hai. Environment Variables mein Production ke liye:
- DATABASE_URL: Neon ki full PostgreSQL connection URI (provider TLS options ke saath)
- REDIS_URL: Upstash TCP/TLS URL, rediss:// se start
- PUBLIC_ORIGIN: actual production URL, e.g. https://your-project.vercel.app, bina slash
- NODE_ENV: production

Agar URL abhi nahi pata, project create karo, Vercel Settings > Domains se production URL copy karke PUBLIC_ORIGIN set karo, phir latest deployment ko redeploy karo. App browser mein wahi production domain open karo. Preview deployments ke liye alag matching PUBLIC_ORIGIN chahiye; otherwise origin check reject kar sakta hai. API routes aur socket URL vercel.json se map hote hain.

## 5. Verify

1. https://YOUR-DOMAIN/health kholo; {"ok":true} expected hai. Ye Postgres aur Redis connectivity check karta hai, bookings ya sockets ka proof nahi hai.
2. Same event ko do independent browser profiles (normal aur incognito) mein kholo. Kisi ek mein seat A1 hold karo. Doosri profile mein woh seat blocked dikhe.
3. Ek saath same available seat hold karne ka try karo; sirf ek hold successful hona chahiye. Hold holder confirm kare; refresh karne par booked status rahe.
4. Doosri seat hold karo aur 10-minute expiry check karo. Server time authoritative hai; UI refresh signal 15 sec tak delay ho sakta hai.
5. Socket reconnect, confirmation, errors aur mobile layout bhi test karo. Koi error aaye to Vercel Runtime Logs ki redacted screenshot share karo; connection strings aur tokens hide karo.

## Limitations

Demo event hai, payment ya real ticket issue nahi hota. Reservations browser token se tied hain: browser data delete karne se access lose hoga. Redis TTL sirf hold mirror hai; PostgreSQL transaction aur timestamp actual double-booking protection enforce karte hain. No verified performance claims, abuse prevention, accounts, refunds, or production-scale guarantees. WebSocket connections platform timeouts se disconnect ho sakti hain; client reconnect karta hai. Pub/Sub events best effort hain; UI expiry/refresh signal provides eventual refresh. Vercel Hobby usage aur third-party free quotas check karo.
