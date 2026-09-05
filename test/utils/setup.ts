import { DbManage } from "@asla/pg";
import { DB_CONNECT_INFO, PUBLIC_DB_CONNECT_INFO } from "@test/utils/db.ts";

export async function setup() {
  await using manage = await DbManage.connect(DB_CONNECT_INFO);
  await manage.recreateDb(PUBLIC_DB_CONNECT_INFO.database);
  await manage.close();
}
