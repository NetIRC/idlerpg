import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { botPresenceFromDb, findByCharacter, getDb, leaderboard, recentRealmEvents } from '../db/index.js';
import { durationIt } from '../game/duration.js';

/** Optional Express API for local dev. Production can use PHP under public/api/. */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(
  cors({
    origin: config.corsOrigin.split(',').map((s: string) => s.trim()),
  }),
);
app.use(express.json());

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, name: 'iodlerpg' });
});

app.get('/api/leaderboard', (_req: Request, res: Response) => {
  const db = getDb(config);
  const { botOnline, botLastSeenMs } = botPresenceFromDb(db);
  const rows = leaderboard(db, 100).map((p) => ({
    name: p.character_name,
    level: p.level,
    class: p.class,
    nextSeconds: p.next_seconds,
    nextHuman: durationIt(p.next_seconds),
    online: !!p.online,
    idledHours: Math.round((p.idled / 3600) * 10) / 10,
  }));
  res.json({
    players: rows,
    generatedAt: new Date().toISOString(),
    botOnline,
    botLastSeenMs,
  });
});

app.get('/api/chronicle', (req: Request, res: Response) => {
  const raw = req.query.limit;
  const n = typeof raw === 'string' ? parseInt(raw, 10) : 15;
  const limit = Number.isFinite(n) ? Math.min(40, Math.max(1, n)) : 15;
  const db = getDb(config);
  const events = recentRealmEvents(db, limit);
  res.json({
    events,
    generatedAt: new Date().toISOString(),
  });
});

app.get('/api/player/:name', (req: Request, res: Response) => {
  const db = getDb(config);
  const r = findByCharacter(db, req.params.name, config.caseSensitiveNames);
  if (!r) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({
    name: r.character_name,
    level: r.level,
    class: r.class,
    nextSeconds: r.next_seconds,
    nextHuman: durationIt(r.next_seconds),
    online: !!r.online,
    alignment: r.alignment,
    trinket: r.trinket?.trim() ? r.trinket.trim() : null,
    idledHours: Math.round((r.idled / 3600) * 10) / 10,
    ircNick: r.online ? r.irc_nick : null,
    stats: {
      penMesg: r.pen_mesg,
      penNick: r.pen_nick,
      penPart: r.pen_part,
      penQuit: r.pen_quit,
      penKick: r.pen_kick,
      penQuest: r.pen_quest,
      penLogout: r.pen_logout,
    },
  });
});

const webDist = path.join(__dirname, '../../web/dist');
const webIndex = path.join(webDist, 'index.html');
if (fs.existsSync(webIndex)) {
  app.use(express.static(webDist));
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(webIndex);
  });
}

app.listen(config.apiPort, config.apiHost, () => {
  console.log(`iodlerpg API http://${config.apiHost}:${config.apiPort}`);
});
