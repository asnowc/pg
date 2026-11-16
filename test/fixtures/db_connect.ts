import { test as viTest } from "vitest";
import {
  connectFromNet,
  DbManage,
  type DbQueryPool,
  type PgConnection,
  PgDbQueryPool,
  PgPool,
  SingleQueryOperation,
} from "@asla/pg";
import process from "node:process";
import { DB_CONNECT_INFO, PUBLIC_DB_CONNECT_INFO } from "@test/utils/db.ts";
import { PgSession } from "@/protocol.ts";
import { getSessionFromPgConnection } from "@/class/PgConnection.ts";

export interface BaseContext {
  emptyDbPool: DbQueryPool;
  conn: PgConnection;
  pool: PgPool;
  session: PgSession;
}
const VITEST_WORKER_ID = +process.env.VITEST_WORKER_ID!;
let databaseSequence = 0;

export const test = viTest.extend<BaseContext>({
  async emptyDbPool({}, use) {
    const databaseName = `test_empty_${VITEST_WORKER_ID}_${databaseSequence++}`;
    const manage = await getManage();
    try {
      await manage.recreateDb(databaseName);
    } finally {
      await manage.close();
    }
    const dbPool = new PgDbQueryPool({ ...DB_CONNECT_INFO, database: databaseName });

    dbPool.open();
    try {
      await use(dbPool);
    } finally {
      const useCount = dbPool.totalCount - dbPool.idleCount;
      await dbPool.close(true);
      await clearDropDb(databaseName);
      if (useCount !== 0) throw new Error("存在未释放的连接");
    }
  },
  async session({ conn }, use) {
    const session = getSessionFromPgConnection(conn);
    await use(session);
  },
  async conn({}, use) {
    await using connection = await connectFromNet(PUBLIC_DB_CONNECT_INFO);
    connection.finished.catch((err) => {
      console.error(err);
    });
    await use(connection);
  },
  async pool({}, use) {
    await using dbPool = new PgPool({
      create: () => connectFromNet(PUBLIC_DB_CONNECT_INFO),
    });
    await use(dbPool);
  },
});

async function clearDropDb(dbName: string) {
  const manage = await getManage();
  try {
    await manage.dropDb(dbName);
  } finally {
    await manage.close();
  }
}

function getManage() {
  return DbManage.connect(DB_CONNECT_INFO);
}
export function createPool() {
  const dbPool = new PgPool({
    create: () => connectFromNet(PUBLIC_DB_CONNECT_INFO),
  });
  return dbPool;
}
export function createConn() {
  return connectFromNet(PUBLIC_DB_CONNECT_INFO);
}

export const PUBLIC_TABLE = {
  name: "test_public",
  columns: {
    id: "id",
    c: "c",
  },
};
export function getPublicTestTableById(conn: SingleQueryOperation, id: string) {
  return conn.query<{ id: number; c: string }>(
    `SELECT * FROM ${PUBLIC_TABLE.name} WHERE ${PUBLIC_TABLE.columns.id} = '${id}'`,
  ).firstRow();
}
export function createPublicTestTable(conn: SingleQueryOperation) {
  return conn.query(
    `CREATE TABLE IF NOT EXISTS ${PUBLIC_TABLE.name} (${PUBLIC_TABLE.columns.id} SERIAL PRIMARY KEY, ${PUBLIC_TABLE.columns.c} VARCHAR)`,
  );
}
export function insetPublicTable(data: string[]) {
  const values = data.map((d) => `('${d}')`).join(",");
  return `INSERT INTO ${PUBLIC_TABLE.name} (${PUBLIC_TABLE.columns.c}) VALUES ${values} RETURNING *`;
}
