# TicketSync deployment — Hindi

Ye project WebSocket (Socket.io) use karta hai. Vercel ab WebSockets support karta hai, lekin ye build ek persistent Node service ke liye configured hai. Vercel Functions ke liye server lifecycle aur cross-instance broadcasts ko adapt aur verify karna hoga. Sabse simple demo: ek hi Node service frontend aur backend serve kare. Render ka paid always-on service + hosted PostgreSQL + Redis use kar sakte ho; free services ki sleep aur provider limits check karo.

1. ZIP extract karo aur ticketsync folder ke contents GitHub repository root par upload karo. .env aur node_modules upload mat karo.
2. Managed PostgreSQL aur Redis banao. Unke private connection strings securely copy karo. Dedicated empty database use karo.
3. Render par GitHub repository se New Web Service banao. Build: `npm install && npm run build`; Start: `npm start`.
4. Environment variables add karo: `DATABASE_URL` = PostgreSQL connection URI, `REDIS_URL` = Redis connection URI, `PUBLIC_ORIGIN` = apna final `https://...` domain, `NODE_ENV` = `production`. `PORT` host automatically deta hai. TLS required ho toh provider ki TLS-enabled URI use karo.
5. Domain na pata ho toh project create karke assigned domain lo, `PUBLIC_ORIGIN` set karo aur redeploy karo.
6. `/health` par `{"ok":true}` check karo. Do different browsers mein same seat select karke hold karo: sirf ek ko success milni chahiye. Confirm aur expiry test karo.
7. MongoDB/Redis/other credentials yahan chat mein ya GitHub par kabhi paste mat karo.

Public app abhi yahan se deploy nahi hui; managed services aur hosting account chahiye. Free plans sleep ho sakte hain aur always-on ki guarantee nahi. Payment ya real ticketing implemented nahi hai.
