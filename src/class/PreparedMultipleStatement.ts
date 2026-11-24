import { QueryOptions, SqlStatements } from "@/interface/Query.ts";
import { QueryOptionsWithDecoder } from "@/interface/Query/_internal.ts";

export class PreparedMultipleStatement {
  constructor(
    readonly statements: SqlStatements,
    options?: QueryOptions & QueryOptionsWithDecoder,
  ) {}
}
