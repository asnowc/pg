import postgres from 'postgres'

const sql = postgres({ max: 4 })

export const queries = {
  select: () => sql`select 1 as x`,
  select_arg: () => sql`select ${1} as x`,
  select_args: () => sql`select
    ${1337} as int,
    ${'wat'} as string,
    ${new Date()} as timestamp,
    ${null} as null,
    ${false} as boolean,
    ${Buffer.from('awesome')} as bytea,
    ${sql.json([{ some: 'json' }, { array: 'object' }])} as json
    `,
  select_where: () => sql`select * from pg_catalog.pg_type where typname = ${'bool'}`
}

export const end = () => sql.end({ timeout: 0 })

