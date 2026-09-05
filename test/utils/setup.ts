import { DbManage } from "@asla/pg";
import { DB_CONNECT_INFO, PUBLIC_DB_CONNECT_INFO } from "@test/utils/db.ts";

export async function setup() {
  try {
    await ensureDb();
  } catch (error) {
    console.error("初始化公共数据库失败", error);
  }
}
async function ensureDb() {
  await using manage = await DbManage.connect(DB_CONNECT_INFO);

  const client = manage.dbClient;
  const [info] = await client.queryRows<{ connections: number }>(`
    SELECT count(*)::INT AS connections
    FROM pg_stat_activity WHERE datname = '${PUBLIC_DB_CONNECT_INFO.database}'`);

  if (info.connections) {
    console.log("跳过初始化公共数据库");
    return;
  } else {
    console.log("初始化公共数据库");

    await manage.recreateDb(PUBLIC_DB_CONNECT_INFO.database);
  }
}
