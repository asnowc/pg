import { Bench, BenchOptions } from "tinybench";
import { createPoolBench } from "./lib/common.ts";
import { aslaSql, poolInfo as addAslaPg } from "./lib/asla-pg.ts";
import { poolInfo as addPg } from "./lib/pg.ts";
import { poolInfo as addPgPromise } from "./lib/pgPromise.ts";
import { poolInfo as addPostgres } from "./lib/postgres.ts";
import { poolInfo as addSlonik, slonkSql } from "./lib/slonik.ts";
import { getSortedResult } from "./utils/bench.ts";

const poolSize = 4; // Example pool size, adjust as needed
const concurrency = 10000;
const options: BenchOptions = { time: 0, iterations: 10, warmupTime: 0, warmupIterations: 0 ,warmup:false};
function select(options: BenchOptions) {
  const bench = new Bench({ ...options, name: "select" });
  const addBench = createPoolBench(bench, { concurrency, poolSize });
  addBench(addAslaPg, async (conn) => {
    await conn.query("select 1 as x").getRows();
  });
  addBench(addPg, async (conn) => {
    await conn.query("select 1 as x");
  });

  addBench(addPgPromise, async (pgPromise) => {
    await pgPromise.any("select 1 as x");
  });

  addBench(addPostgres, async (sql) => {
    await sql`select 1 as x`;
  });

  return bench;
}
function select_arg(options: BenchOptions) {
  const bench = new Bench({ ...options, name: "select_arg" });
  const addBench = createPoolBench(bench, { concurrency, poolSize });
  addBench(addAslaPg, async (client) => {
    await client.query(aslaSql`select ${1} as x`).getRows();
  });
  addBench(addPg, async (client) => {
    await client.query("select $1 as x", [1]);
  });
  addBench(addPgPromise, async (client) => {
    await client.any("select $1 as x", [1]);
  });
  addBench(addPostgres, async (client) => {
    await client`select ${1} as x`;
  });
  return bench;
}
function select_args(options: BenchOptions) {
  const bench = new Bench({ ...options, name: "select_args" });

  const addBench = createPoolBench(bench, { concurrency, poolSize });
  addBench(addAslaPg, async (conn) => {
    await conn.query(aslaSql`select
        ${1337}::int as int,
        ${"wat"} as string,
        ${new Date()}::timestamp with time zone as timestamp,
        ${null} as null,
        ${false}::bool as boolean,
        ${Buffer.from("awesome")}::bytea as bytea,
        ${JSON.stringify([{ some: "json" }, { array: "object" }])}::jsonb as json
            `).getRows();
  });
  addBench(addPg, async (client) => {
    const sql = `select
        $1::int as int,
        $2 as string,
        $3::timestamp with time zone as timestamp,
        $4 as null,
        $5::bool as boolean,
        $6::bytea as bytea,
        $7::jsonb as json
            `;
    const args = [
      1337,
      "wat",
      new Date().toISOString(),
      null,
      false,
      Buffer.from("awesome"),
      JSON.stringify([{ some: "json" }, { array: "object" }]),
    ];
    await client.query(sql, args);
  });
  addBench(addPgPromise, async (client) => {
    const sql = `select
        $1::int as int,
        $2 as string,
        $3::timestamp with time zone as timestamp,
        $4 as null,
        $5::bool as boolean,
        $6::bytea as bytea,
        $7::jsonb as json
            `;
    const args = [
      1337,
      "wat",
      new Date().toISOString(),
      null,
      false,
      Buffer.from("awesome"),
      JSON.stringify([{ some: "json" }, { array: "object" }]),
    ];
    await client.any(sql, args);
  });
  addBench(addPostgres, async (sql) => {
    await sql`select
        ${1337} as int,
        ${"wat"} as string,
        ${new Date()} as timestamp,
        ${null} as null,
        ${false} as boolean,
        ${Buffer.from("awesome")} as bytea,
        ${sql.json([{ some: "json" }, { array: "object" }])} as json
      `;
  });
  addBench(addSlonik, async (client) => {
    const sql = slonkSql.unsafe`select
        ${1337}::int as int,
        ${"wat"} as string,
        ${slonkSql.date(new Date())}::timestamp with time zone as timestamp,
        ${null} as null,
        ${false}::bool as boolean,
        ${slonkSql.binary(Buffer.from("awesome"))}::bytea as bytea,
        ${slonkSql.json([{ some: "json" }, { array: "object" }])}::jsonb as json
      `;
    await client.query(sql);
  });
  return bench;
}
function select_where(options: BenchOptions) {
  const bench = new Bench({ ...options, name: "select_where" });

  const addBench = createPoolBench(bench, { concurrency, poolSize });
  addBench(addAslaPg, async (client) => {
    await client.query(aslaSql`select * from pg_catalog.pg_type where typname = ${"bool"}`).getRows();
  });
  addBench(addPg, async (client) => {
    await client.query(`select * from pg_catalog.pg_type where typname = $1`, ["bool"]);
  });
  addBench(addPgPromise, async (client) => {
    await client.query(`select * from pg_catalog.pg_type where typname = $1`, ["bool"]);
  });
  addBench(addPostgres, async (sql) => {
    await sql`select * from pg_catalog.pg_type where typname = ${"bool"}`;
  });
  return bench;
}

async function run(bench: Bench) {
  await bench.run();
  console.log(bench.name);
  console.table(getSortedResult(bench));
}
await run(select(options));
await run(select_arg(options));
await run(select_args(options));
await run(select_where(options));
