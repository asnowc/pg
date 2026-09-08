import {
  connectFromStream,
  createPgPool,
  createSqlBuilder,
  DenoConnByteStream,
  JS_DATA_ENCODER_V1,
  PgConnection,
  PgPool,
} from "@asla/pg";
import { DB_CONNECT_INFO } from "../utils/db.ts";
import { Bench } from "tinybench";
import { AddPoolConfig, createPoolBench } from "./common.ts";

export async function connect() {
  const tcp = await Deno.connect({ hostname: DB_CONNECT_INFO.host, port: DB_CONNECT_INFO.port });
  tcp.setNoDelay(true);
  return connectFromStream(new DenoConnByteStream(tcp), DB_CONNECT_INFO);
}

export const aslaSql = createSqlBuilder(JS_DATA_ENCODER_V1);

export function addToBench(bench: Bench, name: string, benchFn: (data: PgConnection) => Promise<void>) {
  let aslaPg: PgConnection;

  bench.add(name, () => benchFn(aslaPg), {
    beforeAll: async () => {
      aslaPg = await connect();
    },
    afterAll: async () => {
      await aslaPg.close();
    },
  });
}
export function addPoolToBench(config: AddPoolConfig<PgPool>) {
  return createPoolBench({
    ...config,
    createPool: () => createPgPool({ ...DB_CONNECT_INFO, maxCount: config.poolSize, create: connect }),
    closePool: (pool) => pool.close(),
  });
}
