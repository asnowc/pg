import { createPool, sql } from 'slonik'


const pool = await createPool('postgres://', {
  captureStackTrace: false,
  maximumPoolSize: 4,
  connectionTimeout: 30 * 1000,
  preferNativeBindings: false
})
export const queries = {
  select: () => pool.query(sql.unsafe`select 1  as x`),
  select_arg: () => pool.query(sql.unsafe`select ${1} as x`),
  select_args: () => pool.query(sql.unsafe`select
    ${1337} as int,
    ${'wat'} as string,
    ${new Date().toISOString()}::timestamp with time zone as timestamp,
    ${null} as null,
    ${false}::bool as boolean,
    ${Buffer.from('awesome').toString()}::bytea as bytea,
    ${JSON.stringify([{ some: 'json' }, { array: 'object' }])}::jsonb as json
    `),
  select_where: () => pool.query(sql.unsafe`select * from pg_catalog.pg_type where typname = ${'bool'}`)
}
export const end = () => pool.end()
