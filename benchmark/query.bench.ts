import { Bench, BenchOptions } from "tinybench";
import * as aslaPg from "./lib/asla-pg.ts";
import * as pg from "./lib/pg.ts";
import * as pgPromise from "./lib/pgPromise.ts";
import * as postgres from "./lib/postgres.ts";
import * as slonik from "./lib/slonik.ts";
import { getSortedResult } from "./utils/bench.ts";

const slonkSql = slonik.slonkSql;
const aslaSql = aslaPg.aslaSql;

const options: BenchOptions = { time: 500, iterations: 5000, warmupTime: 0, warmupIterations: 10, warmup: false };
function select(options: BenchOptions) {
  const bench = new Bench({ ...options, name: "select" });

  aslaPg.addToBench(bench, async (conn) => {
    await conn.query("select 1 as x").getRows();
  });
  pg.addToBench(bench, async (conn) => {
    await conn.query("select 1 as x");
  });

  pgPromise.addToBench(bench, async (pgPromise) => {
    await pgPromise.any("select 1 as x");
  });

  postgres.addToBench(bench, async (sql) => {
    await sql`select 1 as x`;
  });

  slonik.addToBench(bench, async (client) => {
    await client.query(slonik.slonkSql.unsafe`select 1 as x`);
  });
  return bench;
}
function select_arg(options: BenchOptions) {
  const bench = new Bench({ ...options, name: "select_arg" });
  aslaPg.addToBench(bench, async (client) => {
    await client.query(aslaPg.aslaSql`select ${1} as x`).getRows();
  });
  pg.addToBench(bench, async (client) => {
    await client.query("select $1 as x", [1]);
  });
  pgPromise.addToBench(bench, async (client) => {
    await client.any("select $1 as x", [1]);
  });
  postgres.addToBench(bench, async (client) => {
    await client`select ${1} as x`;
  });
  slonik.addToBench(bench, async (client) => {
    await client.query(slonik.slonkSql.unsafe`select ${1} as x`);
  });
  return bench;
}
function select_args(options: BenchOptions) {
  const bench = new Bench({ ...options, name: "select_args" });

  aslaPg.addToBench(bench, async (conn) => {
    await conn.query(aslaPg.aslaSql`select
        ${1337}::int as int,
        ${"wat"} as string,
        ${new Date()}::timestamp with time zone as timestamp,
        ${null} as null,
        ${false}::bool as boolean,
        ${Buffer.from("awesome")}::bytea as bytea,
        ${JSON.stringify([{ some: "json" }, { array: "object" }])}::jsonb as json
            `).getRows();
  });
  pg.addToBench(bench, async (client) => {
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
  pgPromise.addToBench(bench, async (client) => {
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
  postgres.addToBench(bench, async (sql) => {
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
  slonik.addToBench(bench, async (client) => {
    const sql = slonik.slonkSql.unsafe`select
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

  aslaPg.addToBench(bench, async (client) => {
    await client.query(aslaSql`select * from pg_catalog.pg_type where typname = ${"bool"}`).getRows();
  });
  pg.addToBench(bench, async (client) => {
    await client.query(`select * from pg_catalog.pg_type where typname = $1`, ["bool"]);
  });
  pgPromise.addToBench(bench, async (client) => {
    await client.query(`select * from pg_catalog.pg_type where typname = $1`, ["bool"]);
  });
  postgres.addToBench(bench, async (client) => {
    await client`select * from pg_catalog.pg_type where typname = ${"bool"}`;
  });
  slonik.addToBench(bench, async (client) => {
    const sql = slonkSql.unsafe`select * from pg_catalog.pg_type where typname = ${"bool"}`;
    await client.query(sql);
  });
  return bench;
}

async function run(bench: Bench) {
  await bench.run();
  console.log(bench.name)
  console.table(getSortedResult(bench));
}
await run(select(options));
await run(select_arg(options));
await run(select_args(options));
await run(select_where(options));
