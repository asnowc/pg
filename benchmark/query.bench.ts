import { Bench, BenchOptions } from "tinybench";
import { addToBench as addAslaPg, aslaSql } from "./lib/asla-pg.ts";
import { addToBench as addPg } from "./lib/pg.ts";
import { addToBench as addPgPromise } from "./lib/pgPromise.ts";
import { addToBench as addPostgres } from "./lib/postgres.ts";

const options: BenchOptions = { time: 500, iterations: 1000, warmupTime: 100, warmupIterations: 10 };
function select(options: BenchOptions) {
  const bench = new Bench({ ...options, name: "select" });

  addAslaPg(bench, "@asla/pg", async (conn) => {
    await conn.query("select 1 as x").getRows();
  });
  addPg(bench, "pg", async (conn) => {
    await conn.query("select 1 as x");
  });

  addPgPromise(bench, "pg-promise", async (pgPromise) => {
    await pgPromise.any("select 1 as x");
  });

  addPostgres(bench, "postgres (reserved connection)", async (sql) => {
    await sql`select 1 as x`;
  });

  return bench;
}
function select_arg(options: BenchOptions) {
  const bench = new Bench({ ...options, name: "select_arg" });
  addAslaPg(bench, "@asla/pg", async (client) => {
    await client.query(aslaSql`select ${1} as x`).getRows();
  });
  addPg(bench, "pg", async (client) => {
    await client.query("select $1 as x", [1]);
  });
  addPgPromise(bench, "pg-promise", async (client) => {
    await client.any("select $1 as x", [1]);
  });
  addPostgres(bench, "postgres (reserved connection)", async (client) => {
    await client`select ${1} as x`;
  });
  return bench;
}
function select_args(options: BenchOptions) {
  const bench = new Bench({ ...options, name: "select_args" });

  addAslaPg(bench, "@asla/pg", async (conn) => {
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
  addPg(bench, "pg", async (client) => {
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
  addPgPromise(bench, "pg-promise", async (client) => {
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
  addPostgres(bench, "postgres (reserved connection)", async (sql) => {
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
  return bench;
}
function select_where(options: BenchOptions) {
  const bench = new Bench({ ...options, name: "select_where" });

  addAslaPg(bench, "@asla/pg", async (client) => {
    await client.query(aslaSql`select * from pg_catalog.pg_type where typname = ${"bool"}`).getRows();
  });
  addPg(bench, "pg", async (client) => {
    await client.query(`select * from pg_catalog.pg_type where typname = $1`, ["bool"]);
  });
  addPgPromise(bench, "pg-promise", async (client) => {
    await client.query(`select * from pg_catalog.pg_type where typname = $1`, ["bool"]);
  });
  addPostgres(bench, "postgres (reserved connection)", async (sql) => {
    await sql`select * from pg_catalog.pg_type where typname = ${"bool"}`;
  });
  return bench;
}

async function run(bench: Bench) {
  await bench.run();
  console.log(bench.name);
  console.table(bench.table());
}
await run(select(options));
await run(select_arg(options));
await run(select_args(options));
await run(select_where(options));
