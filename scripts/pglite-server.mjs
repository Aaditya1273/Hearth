// Local PostgreSQL without Docker: PGlite (Postgres compiled to WASM) behind
// the Postgres wire protocol. For development and the integration tests only.
//
//   npm run db:pglite            # listens on 127.0.0.1:55432, data in .devdata/pglite
//   then set POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=55432 POSTGRES_USER=postgres
//            POSTGRES_DB=postgres POSTGRES_POOL_MAX=1 in .env
//
// PGlite is a single session: it ignores the TimeZone the server sends at
// connect time, so the session zone is pinned here to Node's zone instead.
// One pool connection only: its multiplexer can interleave concurrent
// extended-protocol messages.
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

export async function startPglite({ dataDir = 'memory://', port = 55432, timeZone } = {}) {
    if (!dataDir.includes('://')) fs.mkdirSync(dataDir, { recursive: true });
    const db = await PGlite.create(dataDir, { extensions: { uuid_ossp } });
    const tz = timeZone || process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(tz)) throw new Error(`Unsafe time zone: ${tz}`);
    await db.exec(`SET TimeZone TO '${tz}'`);
    const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 4 });
    await server.start();
    return { db, server, port, async stop() { await server.stop(); await db.close(); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const port = Number(process.env.PGLITE_PORT) || 55432;
    const { db } = await startPglite({ dataDir: process.env.PGLITE_DATA || './.devdata/pglite', port });
    const tz = (await db.query('SHOW TimeZone')).rows[0];
    console.log(`PGlite listening on 127.0.0.1:${port} (TimeZone ${tz.TimeZone ?? tz.timezone})`);
}
