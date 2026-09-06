import { test as viTest } from "vitest";
import { DbManage, type DbQueryPool, PgDbQueryPool } from "@asla/pg";
import type { PgConnection } from "@asla/pg";
import process from "node:process";
import { DB_CONNECT_INFO, TLS_CA_FILE, TLS_LOGIN_DB } from "@test/utils/db.ts";
import { denoConnect } from "@test/utils/connect.ts";

export interface BaseContext {
  emptyDbPool: DbQueryPool;
  connect: PgConnection;
  tlsConnect: PgConnection;
  databaseName: string;
}
const VITEST_WORKER_ID = +process.env.VITEST_WORKER_ID!;
let databaseSequence = 0;

export const test = viTest.extend<BaseContext>({
  databaseName: [async ({}, use) => {
    const dbName = `test_native_${VITEST_WORKER_ID}`;
    const manage = await getManage();
    try {
      await manage.recreateDb(dbName);
    } finally {
      await manage.close();
    }
    try {
      await use(dbName);
    } finally {
      await clearDropDb(dbName);
    }
  }, { scope: "worker" }],
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
  async connect({ databaseName }, use) {
    await using connection = await denoConnect({
      hostname: DB_CONNECT_INFO.hostname,
      port: DB_CONNECT_INFO.port,
      user: DB_CONNECT_INFO.user!,
      password: DB_CONNECT_INFO.password,
      database: databaseName,
    });
    await use(connection);
  },
  async tlsConnect({}, use) {
    const options = new URL(TLS_LOGIN_DB);
    const ca = await Deno.readTextFile(TLS_CA_FILE);
    await using connection = await denoConnect({
      hostname: options.hostname,
      port: +(options.port || 5432),
      user: decodeURIComponent(options.username),
      password: decodeURIComponent(options.password),
      database: options.pathname.slice(1),
      caCerts: [ca],
    });
    await use(connection);
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
