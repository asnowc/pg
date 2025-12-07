// @ts-self-types="./mod.d.ts"
import pg from "pg";
import Cursor from "pg-cursor";
const { Client, DatabaseError, Pool } = pg;

export { Client, DatabaseError, Pool };
export { Cursor };

const pgTypes = pg.types;

pgTypes.setTypeParser(pgTypes.builtins.INT8, BigInt);
