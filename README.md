# TicketSync — event seat reservation demo

React + Express + Socket.io + PostgreSQL + Redis. Demo event seating with real-time availability, ten-minute holds, confirmations and release. This demo collects no payment and issues no actual ticket.

## Correctness model

Each hold or confirmation locks its PostgreSQL seat row in a transaction (`SELECT ... FOR UPDATE`). PostgreSQL stores the owner and expiry and is the authority for holds and reservations. Redis mirrors holds using a TTL; Redis is not the final authority, which avoids incorrect reservations if it is delayed or unavailable. A competing request cannot reserve a booked or unexpired held seat. A random browser token identifies the holder; browser storage loss means the user loses access to their holds and confirmation codes. This is a demo, not a complete authenticated ticketing system.

Socket.io broadcasts changes. A refresh signal runs every 15 seconds to reveal expired holds. PostgreSQL checks expiry on each operation, so timer delays never extend booking rights. Browser clocks affect the countdown display, not the server decision. For production scale use a Socket.io Redis adapter or shared pub/sub and secure authentication; this build assumes a single server instance. Persistent data and unique seat identity are enforced in PostgreSQL. Redis holds are mirrored after commits and do not guarantee lock correctness.

## Run locally

Requires Node.js 20+ and PostgreSQL/Redis. Optionally `docker compose up -d` starts local database services. Copy `.env.example` to `.env`; for the Node commands below set those values as environment variables (Node 20+: `node --env-file=.env server/index.js`). Run `npm install`, then `npm run build`, then `node --env-file=.env server/index.js`. Open http://localhost:3000. For Vite dev, start backend as above and then `npm run dev`; open http://localhost:5173.

First startup automatically creates demo tables and seeds a demo event and seats without overwriting existing data. Use an empty dedicated database. Keep `.env` private. PostgreSQL and Redis must support the URLs you provide; managed services may require TLS (provider connection URI). The app fails startup if either service is unavailable.

## Deploy

Socket.io needs a persistent WebSocket-capable server. Deploy the Express app on Render/Railway/Fly or a Node VPS with PostgreSQL and Redis; this build is configured for a persistent Node server, not Vercel Functions. Vercel now supports WebSockets, but serverless deployment needs changes for lifecycle and cross-instance broadcasting. Connect GitHub, use Node 20+, build command `npm install && npm run build`, start command `npm start`. Configure DATABASE_URL, REDIS_URL, PUBLIC_ORIGIN as exact HTTPS origin, NODE_ENV=production. Host listens on PORT. Use a single instance and a dedicated database. After assigning a domain set PUBLIC_ORIGIN to it and redeploy. Check /health and test concurrent holds using two independent browser sessions. Set PUBLIC_ORIGIN before visitors arrive.

## Important limits

This is a portfolio demo: no payment, real ticket issuance, accounts, hold quotas, abuse controls, refunds, email, durable recovery for users who lose browser data, or production-grade observability. Confirmation is bound to the local browser token. The event and 60 seats are demo data. Holds may be re-created by a user after expiry. Redis TTL mirror is not used to enforce consistency; do not claim Redis is the authoritative lock. No performance or throughput benchmark has been run.

## Vercel adaptation

This variant exports the Node HTTP server as a Vercel Function. WebSocket-only Socket.IO avoids HTTP polling sticky-session requirements. A Redis adapter attempts to broadcast events across instances, while PostgreSQL remains authoritative for booking. Function and WebSocket lifetime limits require clients to reconnect. The original single-server Render instructions above are for the previous version; see DEPLOY-VERCEL-HINDI.md for this variant. Hosted Socket.IO routing, Upstash Pub/Sub behavior, and concurrency have not been verified on Vercel and need deployment tests.
