import { PreparedStatement, TypedSqlStatement } from "@/class/PreparedStatement.ts";
import { BufferWriter } from "@/_utils/BufferWriter.ts";
import {
  BufferEncoder,
  CStringEncoder,
  encodeFrameHeaderInto,
  StageBufferEncoder,
  StageEncode,
  Uint8ArrayEncoder,
  UTF16BufferEncoder,
} from "./_common.ts";
import { CSTRING_TERMINATOR, DescribeTarget, FRAME_HEADER_LENGTH, FrontendMessageCode } from "../const.ts";
import { calcCStringByteLength } from "@/_utils/string.ts";

/**
 *  https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PARSE
 *  arg count 表示前端希望预先指定的参数数量，可以为0.
 *  | statement name | statement text |arg count | arg OIDs...
 *  |   C string     |   C string     |  int16   |  int32[]
 *  名称能完整写入时直接编码，仅跨缓冲区的名称创建续写对象。
 */
export class ParseMessageEncoder extends StageBufferEncoder implements BufferEncoder {
  constructor(private readonly typedStatement: PreparedStatement, statementName: string = "") {
    super();
    const statementNameByteLength = calcCStringByteLength(statementName);
    this.bodyLength = 4 + statementNameByteLength + this.typedStatement.statementByteLength +
      typedStatement.argsLength * 4;
    this.encoder = new CStringEncoder(statementName);
    this.encodeStage = statementName ? this.encodeHeader : this.encodeEmptyStatement;
  }
  private encoder: BufferEncoder;
  readonly bodyLength: number;
  override encodeStage;

  private encodeEmptyStatement(writer: BufferWriter) {
    if (writer.writableLength < FRAME_HEADER_LENGTH + 1) return true;
    encodeFrameHeaderInto(writer, FrontendMessageCode.Parse, this.bodyLength);
    writer.buffer[writer.writeOffset++] = CSTRING_TERMINATOR;
    return this.setStatementEncoder();
  }
  private encodeHeader(writer: BufferWriter) {
    if (writer.writableLength < FRAME_HEADER_LENGTH) return true;
    encodeFrameHeaderInto(writer, FrontendMessageCode.Parse, this.bodyLength);
    return this.encodeStatementName;
  }
  private encodeStatementName(writer: BufferWriter) {
    if (this.encoder.encodeInto(writer)) return true;
    return this.setStatementEncoder();
  }
  private setStatementEncoder() {
    if (typeof this.typedStatement.sqlStatement === "string") {
      this.encoder = new UTF16BufferEncoder(this.typedStatement.sqlStatement);
    } else this.encoder = new Uint8ArrayEncoder(this.typedStatement.sqlStatement);
    return this.encodeStatement;
  }

  private encodeStatement(writer: BufferWriter) {
    if (this.encoder.encodeInto(writer)) return true;
    return this.encodeArgs;
  }

  private oidIndex?: number;
  private encodeArgs(writer: BufferWriter) {
    if (this.oidIndex === undefined) {
      if (writer.writableLength < 3) return true;
      writer.buffer[writer.writeOffset++] = 0; //statement text end
      writer.view.setInt16(writer.writeOffset, this.typedStatement.argsLength), writer.writeOffset += 2;
      this.oidIndex = 0;
    }

    const argsEncoders = this.typedStatement.argsEncoders;
    if (!argsEncoders) return false;

    while (this.oidIndex < argsEncoders.length) {
      if (writer.writableLength < 4) return true;
      writer.view.setInt32(writer.writeOffset, argsEncoders[this.oidIndex].oid), writer.writeOffset += 4;
      this.oidIndex++;
    }
    this.oidIndex = undefined;
    return false;
  }
}

/**
 *  https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-BIND
 *  | portal name | statement name | format code count| format codes... | parameter value count | parameter values... | result column count | result codes...|
 *  | C string    | C string       | int16            | int16[]         | int16                 | value[]             | int16               | int16[]        |
 *
 *  parameter value:
 *  | value byte length | value |
 *  | int32(n)          | n     |
 *  名称直接写入可用缓冲区，跨缓冲区时才分配名称续写对象。
 */
export class BindMessageEncoder extends StageBufferEncoder implements BufferEncoder {
  constructor(
    private readonly typedStatement: PreparedStatement,
    private readonly statementName: string = "",
    private readonly portalName: string = "",
  ) {
    super();
    // | name                  | value       | byte |
    // | --------------------- | ----------- | ---- |
    // | portal name           | ...\0       | n+1  |
    // | statement name        | ...\0       | n+1  |
    // | format code count     | 1           | 2    |
    // | format code           | 1           | 2    |
    // | parameter value count | args.length | 2    |
    // | parameter values      | ...         | n    |
    // | result column count   | 0           | 2    |

    const prefixNameByteLength = calcCStringByteLength(portalName) + calcCStringByteLength(statementName) + 2;
    // 8= 1+1+2+2+2+2 (minimum fixed part of the message)
    this.bodyLength = 8 + prefixNameByteLength + typedStatement.argsTotalByteLength +
      typedStatement.argsLength * 4;
    if (portalName === "" && statementName === "") {
      this.encodeStage = this.encodeEmptyName;
    } else {
      this.encodeStage = this.encodeHeader;
    }
  }
  readonly bodyLength: number;
  private encoder?: BufferEncoder;

  override encodeStage;

  private encodeEmptyName(writer: BufferWriter) {
    if (writer.writableLength < FRAME_HEADER_LENGTH + 8) return true;
    encodeFrameHeaderInto(writer, FrontendMessageCode.Bind, this.bodyLength);
    writer.view.setInt16(writer.writeOffset, 0), writer.writeOffset += 2; // empty portal name and statement name
    return this.encodeFormatsNoCheckLength(writer);
  }

  private encodeHeader(writer: BufferWriter) {
    if (writer.writableLength < FRAME_HEADER_LENGTH) return true;
    encodeFrameHeaderInto(writer, FrontendMessageCode.Bind, this.bodyLength);
    this.encoder = new CStringEncoder(this.portalName);
    return this.encodePortalName;
  }
  private encodePortalName(writer: BufferWriter) {
    if (this.encoder!.encodeInto(writer)) return true;
    this.encoder = new CStringEncoder(this.statementName);
    return this.encodeStatementName;
  }
  private encodeStatementName(writer: BufferWriter) {
    if (this.encoder!.encodeInto(writer)) return true;
    return this.encodeFormats;
  }
  private encodeFormats(writer: BufferWriter) {
    if (writer.writableLength < 6) return true;
    return this.encodeFormatsNoCheckLength(writer);
  }
  private encodeFormatsNoCheckLength(writer: BufferWriter) {
    writer.view.setInt16(writer.writeOffset, 1), writer.writeOffset += 2; // format code count
    writer.view.setInt16(writer.writeOffset, 1), writer.writeOffset += 2; // format code
    writer.view.setInt16(writer.writeOffset, this.typedStatement.argsLength), writer.writeOffset += 2;
    return this.encodeParameters;
  }
  private streamEncoder?: BufferEncoder;
  private parameterIndex = 0;
  private parameterLength = 0;
  private encodeParameters(writer: BufferWriter) {
    const writerOffset = writer.writeOffset;
    let parameterIndex = this.parameterIndex;
    if (this.streamEncoder) {
      if (this.streamEncoder.encodeInto(writer)) {
        this.parameterLength += writer.writeOffset - writerOffset;
        return true;
      }
      this.streamEncoder = undefined;
      parameterIndex++;
    }

    const argsEncoders = this.typedStatement.argsEncoders ?? [];
    const args = this.typedStatement.args ?? [];
    for (; parameterIndex < argsEncoders.length; parameterIndex++) {
      const enc = argsEncoders[parameterIndex];
      if ("byteLength" in enc) {
        if (writer.writableLength < enc.byteLength + 4) break;
        writer.view.setInt32(writer.writeOffset, enc.byteLength), writer.writeOffset += 4; // parameter value length
        enc.encodeInto(writer, args[parameterIndex]);
      } else {
        if (writer.writableLength < 4) break;
        const streamEncoder = enc.startEncode(args[parameterIndex]);
        writer.view.setInt32(writer.writeOffset, streamEncoder.byteLength), writer.writeOffset += 4; // parameter value length
        if (streamEncoder.encodeInto(writer)) {
          this.streamEncoder = streamEncoder;
          break;
        }
      }
    }
    this.parameterIndex = parameterIndex;
    this.parameterLength += writer.writeOffset - writerOffset;
    if (parameterIndex < argsEncoders.length) return true;
    if (this.parameterLength - (argsEncoders.length * 4) !== this.typedStatement.argsTotalByteLength) {
      throw new Error("Parameter length mismatch");
    }
    return this.encodeResultFormat;
  }
  private encodeResultFormat(writer: BufferWriter) {
    if (writer.writableLength < 2) return true;
    writer.view.setInt16(writer.writeOffset, 0), writer.writeOffset += 2; // result column count
    return false;
  }
}
/**
 * | portal name | max rows |
 * | c string    | int32    |
 */
export class ExecuteMessageEncoder extends StageBufferEncoder implements BufferEncoder {
  constructor(private maxRows: number, private portal: string = "") {
    super();
    this.bodyLength = 4 + calcCStringByteLength(this.portal) + 1;
    if (portal) {
      this.encoder = new UTF16BufferEncoder(this.portal);
      this.encodeStage = this.stageEncodeHeader;
    } else {
      this.encodeStage = this.encodeNoPortal;
    }
  }
  readonly bodyLength: number;
  override encodeStage: StageEncode;

  private encoder?: BufferEncoder;
  stageEncodeHeader(writer: BufferWriter) {
    if (writer.writableLength < FRAME_HEADER_LENGTH) return true;
    encodeFrameHeaderInto(writer, FrontendMessageCode.Execute, this.bodyLength);
    return this.stageEncodePortalName;
  }
  stageEncodePortalName(writer: BufferWriter) {
    if (this.encoder) {
      if (this.encoder.encodeInto(writer)) return true;
      this.encoder = undefined;
    }
    if (writer.writableLength < 5) return true;
    this.encodeLatest(writer);
    return false;
  }
  encodeNoPortal(writer: BufferWriter) {
    if (writer.writableLength < 5) return true;
    encodeFrameHeaderInto(writer, FrontendMessageCode.Execute, this.bodyLength);
    this.encodeLatest(writer);
    return false;
  }
  encodeLatest(writer: BufferWriter) {
    writer.buffer[writer.writeOffset++] = CSTRING_TERMINATOR;
    writer.view.setInt32(writer.writeOffset, this.maxRows), writer.writeOffset += 4;
  }
}

export class QueryMessageEncoder implements BufferEncoder {
  constructor(statement: TypedSqlStatement) {
    this.bodyLength = statement.statementByteLength;
    if (typeof statement.sqlStatement === "string") this.encoder = new UTF16BufferEncoder(statement.sqlStatement);
    else this.encoder = new Uint8ArrayEncoder(statement.sqlStatement);
  }
  private encoder?: BufferEncoder;
  private bodyLength?: number;
  encodeInto(writer: BufferWriter): boolean | void {
    if (this.bodyLength !== undefined) {
      if (writer.writableLength < 5) return true;
      encodeFrameHeaderInto(writer, FrontendMessageCode.Query, this.bodyLength);
      this.bodyLength = undefined;
    }
    if (this.encoder) {
      if (this.encoder.encodeInto(writer)) return true;
      this.encoder = undefined;
    }
    if (writer.writableLength < 1) return true;
    writer.buffer[writer.writeOffset] = 0, writer.writeOffset += 1; // null terminator
  }
}

export class DescribeMessageEncoder implements BufferEncoder {
  constructor(private target: DescribeTarget, name: string) {
    this.bodyLength = calcCStringByteLength(name) + 2;
    this.cStringEncoder = new CStringEncoder(name);
  }
  private cStringEncoder: CStringEncoder;
  private bodyLength?: number;
  encodeInto(writer: BufferWriter) {
    if (this.bodyLength !== undefined) {
      if (writer.writableLength < 6) return true;
      writer.buffer[writer.writeOffset++] = FrontendMessageCode.Describe;
      writer.view.setInt32(writer.writeOffset, 4 + this.bodyLength), writer.writeOffset += 4;
      writer.buffer[writer.writeOffset++] = this.target;
      this.bodyLength = undefined;
    }

    return this.cStringEncoder.encodeInto(writer);
  }
}
