import { PgColumnDataDecoder } from "@/interface/pg_data_decoder.ts";
import { FieldInfo, SqlStatements } from "@/interface/Query.ts";
import { BufferEncoder, Uint8ArrayEncoder, UTF16BufferEncoder } from "./encoder/_common.ts";
import { calcCStringByteLength } from "@/_utils/string.ts";
import { NullByteError } from "@/_utils/error.ts";
import { PreparedStatement } from "@/class/PreparedStatement.ts";
import { QueryResultParser } from "./parsers/QueryResultParser.ts";
import { QueryParserResult, ReceiverType } from "./parsers/QueryTask.ts";

export interface QueryPortalOptions {
  onNotice?: (info: { notice: string }) => void;
  getResultDecoder?: (field: FieldInfo) => PgColumnDataDecoder;
  resolve?: (data: QueryParserResult<any>) => void;
  reject?: (error: unknown) => void;
}

export interface QueryPortal {
  onNotice?: (info: { notice: string }) => void;
  getResultDecoder?: (field: FieldInfo) => PgColumnDataDecoder;
  readonly portalName?: string;
}

export class StatementPortal extends QueryResultParser implements QueryPortal {
  constructor(
    readonly statement: PreparedStatement,
    options: QueryPortalOptions = {},
  ) {
    super(options.resolve, options.reject, options.getResultDecoder, ReceiverType.ExtendedQuery);
    this.onNotice = options.onNotice;
    this.getResultDecoder = options.getResultDecoder;
    super(options?.resolve, options?.reject);
  }
  onNotice?: (info: { notice: string }) => void;
  getResultDecoder?: (field: FieldInfo) => PgColumnDataDecoder;
  readonly portalName?: string | undefined;
}

export class MultipleStatementPortal extends QueryResultParser implements QueryPortal {
  constructor(
    readonly statements: SqlStatements,
    options: QueryPortalOptions = {},
  ) {
    super(options.resolve, options.reject, options.getResultDecoder, ReceiverType.SimpleQuery);
    if (typeof statements === "string") {
      this.encoder = new UTF16BufferEncoder(statements);
      this.statementsLength = calcCStringByteLength(statements);
    } else if (statements instanceof Uint8Array) {
      if (statements.includes(0)) throw new NullByteError();
      this.statementsLength = statements.byteLength;
      this.encoder = new Uint8ArrayEncoder(statements);
    } else {
      throw new Error("Unsupported statement type");
    }
    this.onNotice = options.onNotice;
    this.getResultDecoder = options.getResultDecoder;
  }
  onNotice?: (info: { notice: string }) => void;
  getResultDecoder?: ((field: FieldInfo) => PgColumnDataDecoder) | undefined;
  readonly statementsLength: number;
  readonly encoder: BufferEncoder;
}
