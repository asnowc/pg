import { Bench, BenchOptions } from "tinybench";
import { addPoolToBench as addAslaPg, aslaSql } from "./lib/asla-pg.ts";
import { addPoolToBench as addPg } from "./lib/pg.ts";
import { addPoolToBench as addPgPromise } from "./lib/pgPromise.ts";
import { addPoolToBench as addPostgres } from "./lib/postgres.ts";

const poolSize = 4; // Example pool size, adjust as needed
const options: BenchOptions = { time: 0, iterations: 5, warmupTime: 0, warmupIterations: 0 };
function select(options: BenchOptions) {
  const bench = new Bench({ ...options, name: "select" });

  addAslaPg({
    name: "@asla/pg",
    benchFn: async (conn) => {
      await conn.query("select 1 as x").getRows();
    },
    bench,
    poolSize,
  });
  addPg({
    bench,
    name: "pg",
    benchFn: async (conn) => {
      await conn.query("select 1 as x");
    },
    poolSize,
  });

  addPgPromise({
    bench,
    name: "pg-promise",
    benchFn: async (pgPromise) => {
      await pgPromise.any("select 1 as x");
    },
    poolSize,
  });

  addPostgres({
    bench,
    name: "postgres (reserved connection)",
    benchFn: async (sql) => {
      await sql`select 1 as x`;
    },
    poolSize,
  });

  return bench;
}
function select_arg(options: BenchOptions) {
  const bench = new Bench({ ...options, name: "select_arg" });
  addAslaPg({
    bench,
    name: "@asla/pg",
    benchFn: async (client) => {
      await client.query(aslaSql`select ${1} as x`).getRows();
    },
    poolSize,
  });
  addPg({
    bench,
    name: "pg",
    benchFn: async (client) => {
      await client.query("select $1 as x", [1]);
    },
    poolSize,
  });
  addPgPromise({
    bench,
    name: "pg-promise",
    benchFn: async (client) => {
      await client.any("select $1 as x", [1]);
    },
    poolSize,
  });
  addPostgres({
    bench,
    name: "postgres (reserved connection)",
    benchFn: async (client) => {
      await client`select ${1} as x`;
    },
    poolSize,
  });
  return bench;
}
function select_args(options: BenchOptions) {
  const bench = new Bench({ ...options, name: "select_args" });

  addAslaPg({
    bench,
    name: "@asla/pg",
    benchFn: async (conn) => {
      await conn.query(aslaSql`select
        ${1337}::int as int,
        ${"wat"} as string,
        ${new Date()}::timestamp with time zone as timestamp,
        ${null} as null,
        ${false}::bool as boolean,
        ${Buffer.from("awesome")}::bytea as bytea,
        ${JSON.stringify([{ some: "json" }, { array: "object" }])}::jsonb as json
            `).getRows();
    },
    poolSize,
  });
  addPg({
    bench,
    name: "pg",
    benchFn: async (client) => {
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
    },
    poolSize,
  });
  addPgPromise({
    bench,
    name: "pg-promise",
    benchFn: async (client) => {
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
    },
    poolSize,
  });
  addPostgres({
    bench,
    name: "postgres (reserved connection)",
    benchFn: async (sql) => {
      await sql`select
        ${1337} as int,
        ${"wat"} as string,
        ${new Date()} as timestamp,
        ${null} as null,
        ${false} as boolean,
        ${Buffer.from("awesome")} as bytea,
        ${sql.json([{ some: "json" }, { array: "object" }])} as json
      `;
    },
    poolSize,
  });
  return bench;
}
function select_where(options: BenchOptions) {
  const bench = new Bench({ ...options, name: "select_where" });

  addAslaPg({
    bench,
    name: "@asla/pg",
    benchFn: async (client) => {
      await client.query(aslaSql`select * from pg_catalog.pg_type where typname = ${"bool"}`).getRows();
    },
    poolSize,
  });
  addPg({
    bench,
    name: "pg",
    benchFn: async (client) => {
      await client.query(`select * from pg_catalog.pg_type where typname = $1`, ["bool"]);
    },
    poolSize,
  });
  addPgPromise({
    bench,
    name: "pg-promise",
    benchFn: async (client) => {
      await client.query(`select * from pg_catalog.pg_type where typname = $1`, ["bool"]);
    },
    poolSize,
  });
  addPostgres({
    bench,
    name: "postgres (reserved connection)",
    benchFn: async (sql) => {
      await sql`select * from pg_catalog.pg_type where typname = ${"bool"}`;
    },
    poolSize,
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
