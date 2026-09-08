import { afterAll, beforeAll, test } from "vitest";
import { aslaSql } from "./lib/asla-pg.ts";
import { connect } from "./utils/connect.ts";

const options = { time: 500, iterations: 20, warmupTime: 100, warmupIterations: 5 };
let info: Awaited<ReturnType<typeof connect>>;

beforeAll(async () => {
  info = await connect();
});

afterAll(async () => {
  info.postgres.release();
  await info.postgres.end();
  info.pgPromise.done();
  await info.pg.end();
  await info.asla.close();
});

test("select", async ({ bench }) => {
  await bench.compare(
    bench("@asla/pg", async () => {
      const client = info.asla;
      await client.query("select 1 as x").getRows();
    }),
    bench("pg", async () => {
      const client = info.pg;
      await client.query("select 1 as x");
    }),
    bench("pg-promise", async () => {
      const client = info.pgPromise;
      await client.any("select 1 as x");
    }),
    bench("postgres (reserved connection)", async () => {
      const client = info.postgres;
      await client.unsafe("select 1 as x");
    }),
    options,
  );
});

test("select_arg", async ({ bench }) => {
  await bench.compare(
    bench("@asla/pg", async () => {
      const client = info.asla;
      await client.query(aslaSql`select ${1} as x`).getRows();
    }),
    bench("pg", async () => {
      const client = info.pg;
      await client.query("select $1 as x", [1]);
    }),
    bench("pg-promise", async () => {
      const client = info.pgPromise;
      await client.any("select $1 as x", [1]);
    }),
    bench("postgres (reserved connection)", async () => {
      const client = info.postgres;
      await client`select ${1} as x`;
    }),
    options,
  );
});

test("select_args", async ({ bench }) => {
  await bench.compare(
    bench("@asla/pg", async () => {
      const client = info.asla;
      await client.query(aslaSql`select
        ${1337}::int as int,
        ${"wat"} as string,
        ${new Date()}::timestamp with time zone as timestamp,
        ${null} as null,
        ${false}::bool as boolean,
        ${Buffer.from("awesome")}::bytea as bytea,
        ${JSON.stringify([{ some: "json" }, { array: "object" }])}::jsonb as json
            `).getRows();
    }),
    bench("pg", async () => {
      const client = info.pg;
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
    }),
    bench("pg-promise", async () => {
      const client = info.pgPromise;
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
    }),
    bench("postgres (reserved connection)", async () => {
      const client = info.postgres;

      await client`select
      ${1337} as int,
      ${"wat"} as string,
      ${new Date()} as timestamp,
      ${null} as null,
      ${false} as boolean,
      ${Buffer.from("awesome")} as bytea,
      ${client.json([{ some: "json" }, { array: "object" }])} as json
    `;
    }),
    options,
  );
});

test("select_where", async ({ bench }) => {
  await bench.compare(
    bench("@asla/pg", async () => {
      const client = info.asla;
      await client.query(aslaSql`select * from pg_catalog.pg_type where typname = ${"bool"}`).getRows();
    }),
    bench("pg", async () => {
      const client = info.pg;
      await client.query(`select * from pg_catalog.pg_type where typname = $1`, ["bool"]);
    }),
    bench("pg-promise", async () => {
      const client = info.pgPromise;
      await client.query(`select * from pg_catalog.pg_type where typname = $1`, ["bool"]);
    }),
    bench("postgres (reserved connection)", async () => {
      const client = info.postgres;
      await client`select * from pg_catalog.pg_type where typname = ${"bool"}`;
    }),
    options,
  );
});
