import { connect as aslaConnect } from "../lib/asla-pg.ts";
import { connect as pgConnect } from "../lib/pg.ts";
import { connect as pgPromiseConnect } from "../lib/pgPromise.ts";
import { connect as postgresConnect } from "../lib/postgres.ts";

export async function connect() {
  const asla = await aslaConnect();
  const pg = await pgConnect();
  const pgPromise = await pgPromiseConnect();
  const postgres = await postgresConnect();

  return { asla, pg, pgPromise, postgres };
}
