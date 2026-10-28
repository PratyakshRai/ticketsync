import express from 'express';
import helmet from 'helmet';
import http from 'node:http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import pg from 'pg';
import { createClient } from 'redis';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { DATABASE_URL, REDIS_URL, PUBLIC_ORIGIN, PORT='3000', NODE_ENV='development' } = process.env;
if (!DATABASE_URL || !REDIS_URL || !PUBLIC_ORIGIN) throw new Error('DATABASE_URL, REDIS_URL and PUBLIC_ORIGIN are required');
const pgPool = new pg.Pool({connectionString:DATABASE_URL, max:10});
pgPool.on('error', error=>console.error('Postgres pool error',error.message));
const redis = createClient({url:REDIS_URL});
redis.on('error',error=>console.error('Redis error',error.message));
await pgPool.query('SELECT 1');
await redis.connect();
// Safe, idempotent bootstrapping for a small demonstration installation.
const bootstrap = await pgPool.connect();
try {
  await bootstrap.query('BEGIN');
  await bootstrap.query('SELECT pg_advisory_xact_lock(78731249)');
await bootstrap.query(`CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, title TEXT NOT NULL, venue TEXT NOT NULL, starts_at TIMESTAMPTZ NOT NULL, description TEXT NOT NULL)`);
await bootstrap.query(`CREATE TABLE IF NOT EXISTS seats (event_id TEXT NOT NULL REFERENCES events(id), seat_id TEXT NOT NULL, row_label TEXT NOT NULL, seat_number INT NOT NULL, price INTEGER NOT NULL, hold_owner TEXT, hold_until TIMESTAMPTZ, booking_owner TEXT, booked_at TIMESTAMPTZ, booking_code TEXT, PRIMARY KEY(event_id, seat_id))`);
await bootstrap.query(`CREATE UNIQUE INDEX IF NOT EXISTS seats_booking_code_idx ON seats(booking_code) WHERE booking_code IS NOT NULL`);
await bootstrap.query(`INSERT INTO events(id,title,venue,starts_at,description) VALUES ('afterglow','Afterglow Sessions','The Glasshouse, Bengaluru','2027-12-12 13:30:00+00','An evening of live music, good company, and unforgettable moments.') ON CONFLICT(id) DO NOTHING`);
await bootstrap.query(`INSERT INTO seats(event_id,seat_id,row_label,seat_number,price) SELECT 'afterglow', row_label || seat_number, row_label, seat_number, CASE WHEN row_label IN ('A','B') THEN 1800 ELSE 1200 END FROM unnest(ARRAY['A','B','C','D','E','F']) AS row_label CROSS JOIN generate_series(1,10) AS seat_number ON CONFLICT DO NOTHING`);
  await bootstrap.query('COMMIT');
} catch (error) {
  await bootstrap.query('ROLLBACK').catch(()=>{});
  throw error;
} finally { bootstrap.release(); }
const app=express(); const server=http.createServer(app);
// Vercel forwards rewritten paths through __route; restore the original route
// before Express or Socket.IO receives HTTP requests and WebSocket upgrades.
const emit = server.emit;
server.emit = function(event, ...args) {
  if ((event === 'request' || event === 'upgrade') && args[0]?.url) {
    const request = args[0]; const url = new URL(request.url, 'https://internal.invalid');
    const route = url.searchParams.get('__route');
    if (route && (route === '/health' || route.startsWith('/api/') || route.startsWith('/socket.io'))) {
      url.searchParams.delete('__route'); request.url = route + (url.searchParams.size ? '?' + url.searchParams.toString() : '');
    }
  }
  return emit.call(this, event, ...args);
};
const io=new Server(server,{path:'/api/ws',addTrailingSlash:false,transports:['websocket'],cors:{origin:PUBLIC_ORIGIN,credentials:false}});
// A shared adapter forwards availability events to sockets on other instances.
const socketPub = redis.duplicate(), socketSub = redis.duplicate();
for (const client of [socketPub,socketSub]) client.on('error', error=>console.error('Socket Redis error:',error.message));
await Promise.all([socketPub.connect(),socketSub.connect()]);
io.adapter(createAdapter(socketPub,socketSub));
app.disable('x-powered-by');app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'","data:"],connectSrc:["'self'"]}}}));
app.use(express.json({limit:'8kb'}));
// Browser token is a 256-bit bearer credential; store only its SHA-256 hash.
function owner(req,res,next){const token=req.get('x-booking-token')||'';if(!/^[a-f0-9]{64}$/.test(token))return res.status(400).json({error:'Invalid browser session. Reload and try again.'});req.owner=crypto.createHash('sha256').update(token).digest('hex');next()}
function validOrigin(req,res,next){const origin=req.get('origin');if(origin && origin!==new URL(PUBLIC_ORIGIN).origin && !(NODE_ENV==='development' && origin==='http://localhost:5173'))return res.status(403).json({error:'Invalid origin'});next()}
app.use('/api',validOrigin);
async function transaction(action){const c=await pgPool.connect();try{await c.query('BEGIN');const result=await action(c);await c.query('COMMIT');return result}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}}
function invalid(res){return res.status(400).json({error:'Invalid event or seat.'})}
function checkParams(req){return /^[a-z0-9-]{1,40}$/.test(req.params.eventId||'')&&/^[A-F](?:[1-9]|10)$/.test(req.params.seatId||'')}
function changed(eventId){io.to('event:'+eventId).emit('availability-changed')}
// Redis mirrors active holds with TTL. PostgreSQL row locks and timestamps are the
// source of truth, so delayed Redis writes or expirations cannot cause double booking.
async function mirrorHold(event,seat,owner,until){try{let ttl=Math.max(1,Math.ceil((new Date(until).getTime()-Date.now())/1000));await redis.set(`hold:${event}:${seat}`,owner,{EX:ttl})}catch(error){console.error('Redis hold mirror failed:',error.message)}}
app.get('/api/events',async(req,res,next)=>{try{const result=await pgPool.query('SELECT id,title,venue,starts_at,description FROM events ORDER BY starts_at');res.json({events:result.rows})}catch(e){next(e)}});
app.get('/api/events/:eventId',owner,async(req,res,next)=>{try{const event=await pgPool.query('SELECT id,title,venue,starts_at,description FROM events WHERE id=$1',[req.params.eventId]);if(!event.rowCount)return res.status(404).json({error:'Event not found.'});const seats=await pgPool.query(`SELECT seat_id,row_label,seat_number,price,CASE WHEN booking_owner = $2 THEN 'booked-mine' WHEN booking_owner IS NOT NULL THEN 'booked' WHEN hold_until > now() AND hold_owner = $2 THEN 'mine' WHEN hold_until > now() THEN 'held' ELSE 'available' END AS status, CASE WHEN hold_owner=$2 AND hold_until>now() AND booking_owner IS NULL THEN hold_until ELSE NULL END AS hold_until, CASE WHEN booking_owner=$2 THEN booking_code ELSE NULL END AS booking_code FROM seats WHERE event_id=$1 ORDER BY row_label,seat_number`,[req.params.eventId,req.owner]);res.json({event:event.rows[0],seats:seats.rows,serverTime:new Date().toISOString()})}catch(e){next(e)}});
app.post('/api/events/:eventId/seats/:seatId/hold',owner,async(req,res,next)=>{try{if(!checkParams(req))return invalid(res);const result=await transaction(async c=>{const q=await c.query('SELECT booking_owner,hold_owner,hold_until,now() AS now FROM seats WHERE event_id=$1 AND seat_id=$2 FOR UPDATE',[req.params.eventId,req.params.seatId]);if(!q.rowCount)return {status:404,error:'Seat not found.'};const s=q.rows[0];if(s.booking_owner)return {status:409,error:'This seat is already booked.'};if(s.hold_until && s.hold_until>s.now && s.hold_owner!==req.owner)return {status:409,error:'Someone else is holding this seat.'};if(s.hold_until && s.hold_until>s.now && s.hold_owner===req.owner)return {status:200,until:s.hold_until};const updated=await c.query("UPDATE seats SET hold_owner=$3, hold_until=now()+interval '10 minutes' WHERE event_id=$1 AND seat_id=$2 RETURNING hold_until",[req.params.eventId,req.params.seatId,req.owner]);return {status:200,until:updated.rows[0].hold_until}});if(result.error)return res.status(result.status).json({error:result.error});await mirrorHold(req.params.eventId,req.params.seatId,req.owner,result.until);changed(req.params.eventId);res.json({holdUntil:result.until})}catch(e){next(e)}});
app.post('/api/events/:eventId/seats/:seatId/confirm',owner,async(req,res,next)=>{try{if(!checkParams(req))return invalid(res);const result=await transaction(async c=>{const q=await c.query('SELECT booking_owner,booking_code,hold_owner,hold_until,now() AS now FROM seats WHERE event_id=$1 AND seat_id=$2 FOR UPDATE',[req.params.eventId,req.params.seatId]);if(!q.rowCount)return {status:404,error:'Seat not found.'};const s=q.rows[0];if(s.booking_owner===req.owner)return {status:200,code:s.booking_code};if(s.booking_owner)return {status:409,error:'This seat is already booked.'};if(s.hold_owner!==req.owner||!s.hold_until||s.hold_until<=s.now)return {status:409,error:'Your hold has expired. Please select the seat again.'};const code=crypto.randomBytes(9).toString('hex').toUpperCase();await c.query('UPDATE seats SET booking_owner=$3,booked_at=now(),booking_code=$4,hold_owner=NULL,hold_until=NULL WHERE event_id=$1 AND seat_id=$2',[req.params.eventId,req.params.seatId,req.owner,code]);return {status:200,code}});if(result.error)return res.status(result.status).json({error:result.error});changed(req.params.eventId);res.json({bookingCode:result.code})}catch(e){next(e)}});
app.post('/api/events/:eventId/seats/:seatId/release',owner,async(req,res,next)=>{try{if(!checkParams(req))return invalid(res);const result=await pgPool.query('UPDATE seats SET hold_owner=NULL,hold_until=NULL WHERE event_id=$1 AND seat_id=$2 AND hold_owner=$3 AND booking_owner IS NULL RETURNING seat_id',[req.params.eventId,req.params.seatId,req.owner]);if(result.rowCount)changed(req.params.eventId);res.json({released:!!result.rowCount})}catch(e){next(e)}});
app.get('/health',async(req,res)=>{try{await pgPool.query('SELECT 1');await redis.ping();res.json({ok:true})}catch{res.status(503).json({ok:false})}});
io.on('connection',socket=>{socket.on('join-event',id=>{if(typeof id==='string'&&/^[a-z0-9-]{1,40}$/.test(id))socket.join('event:'+id)})});
// A lightweight refresh signal also tells clients when a hold expires; database
// timestamps are authoritative, not the browser clock or socket delivery.
const timer=setInterval(()=>io.local.emit('availability-changed'),15000);timer.unref();
const here=path.dirname(fileURLToPath(import.meta.url));app.use(express.static(path.join(here,'../dist')));app.get('*',(req,res)=>res.sendFile(path.join(here,'../dist/index.html')));
app.use((err,req,res,next)=>{console.error('Request failed:',err.message);if(!res.headersSent)res.status(500).json({error:'Something went wrong. Please try again.'});else next(err)});
if (!process.env.VERCEL) server.listen(Number(PORT),'0.0.0.0',()=>console.log('TicketSync listening on',PORT));
export default server;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(timer);io.close();server.close(async()=>{await Promise.allSettled([pgPool.end(),redis.quit(),socketPub.quit(),socketSub.quit()]);process.exit(0)});setTimeout(()=>process.exit(1),5000).unref()});
