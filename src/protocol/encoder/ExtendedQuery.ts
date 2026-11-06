import { PreparedStatement } from "@/class/PreparedStatement.ts";
import { BufferWriter } from "@/_utils/StreamWriter.ts";
import { DynamicLengthBlockEncoder, StageBufferEncoder, UTF16BufferEncoder } from "@/protocol/encoder/_common.ts";
import { FrontendMessageCode } from "@/protocol/const.ts";
import { calcCStringByteLength } from "@/_utils/string.ts";
import { StreamEncoder } from "@/interface/js_data_encoder.ts";

/**
 *  https://postgres.ac.cn/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PARSE
 *  arg count 表示前端希望预先指定的参数数量，可以为0.
 *  | statement name | statement text |arg count | arg OIDs...
 *  |   C string     |   C string     |  int16   |  int32[]
 *  名称能完整写入时直接编码，仅跨缓冲区的名称创建续写对象。
 */
export class ParseMessageEncoder extends StageBufferEncoder implements DynamicLengthBlockEncoder {
  constructor(private readonly typedStatement: PreparedStatement, statementName: string = "") {
    super();
    const statementNameByteLength = calcCStringByteLength(statementName);
    this.bodyLength = 4 + statementNameByteLength + this.typedStatement.statementByteLength +
      typedStatement.argsLength * 4;
    this.cStringEncoder = new UTF16BufferEncoder(statementName);
  }
  readonly messageCode = FrontendMessageCode.Parse;
  readonly bodyLength: number;
  private readonly cStringEncoder: UTF16BufferEncoder;
  override encodeStage = this.encodeStatementName;
  private encodeStatementName(writer: BufferWriter) {
    if (this.cStringEncoder.encodeInto(writer)) return true;
    if (typeof this.typedStatement.sqlStatement === "string") {
      this.cStringEncoder.reset(this.typedStatement.sqlStatement);
      return this.encodeTextStatement;
    } else {
      return this.encodeBinaryStatement;
    }
  }
  private encodeTextStatement(writer: BufferWriter) {
    if (this.cStringEncoder.encodeInto(writer)) return true;
    return this.encodeArgs;
  }
  private sqlStatement?: Uint8Array;
  private encodeBinaryStatement(writer: BufferWriter) {
    const writableLength = writer.writableLength;
    if (writableLength === 0) return true;
    const sqlStatement = this.sqlStatement!;
    if (writableLength < sqlStatement.byteLength) {
      const chunk = sqlStatement.subarray(0, writableLength);
      writer.buffer.set(chunk, writer.writeOffset);
      writer.writeOffset += chunk.byteLength;
      this.sqlStatement = sqlStatement.subarray(chunk.byteLength);
      return true;
    }
    writer.buffer.set(sqlStatement, writer.writeOffset), writer.writeOffset += sqlStatement.byteLength;
    this.sqlStatement = undefined;
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
 *  https://postgres.ac.cn/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-BIND
 *  | portal name | statement name | format code count| format codes... | parameter value count | parameter values... | result column count | result codes...|
 *  | C string    | C string       | int16            | int16[]         | int16                 | value[]             | int16               | int16[]        |
 *
 *  parameter value:
 *  | value byte length | value |
 *  | int32(n)          | n     |
 *  名称直接写入可用缓冲区，跨缓冲区时才分配名称续写对象。
 */
export class BindMessageEncoder extends StageBufferEncoder implements DynamicLengthBlockEncoder {
  constructor(private readonly typedStatement: PreparedStatement, statementName: string = "", portalName: string = "") {
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
    this.prefixEncoder = new UTF16BufferEncoder(portalName + "\0" + statementName + "\0");
  }
  readonly messageCode = FrontendMessageCode.Bind;
  readonly bodyLength: number;

  private prefixEncoder: UTF16BufferEncoder;
  override encodeStage = this.encodePrefixName;
  private encodePrefixName(writer: BufferWriter) {
    if (this.prefixEncoder.encodeInto(writer)) return true;
    return this.encodeFormats;
  }
  private encodeFormats(writer: BufferWriter) {
    if (writer.writableLength < 6) return true;
    writer.view.setInt16(writer.writeOffset, 1), writer.writeOffset += 2; // format code count
    writer.view.setInt16(writer.writeOffset, 1), writer.writeOffset += 2; // format code
    writer.view.setInt16(writer.writeOffset, this.typedStatement.argsLength), writer.writeOffset += 2;
    return this.encodeParameters;
  }
  private streamEncoder?: StreamEncoder;
  private parameterIndex = 0;
  private encodeParameters(writer: BufferWriter) {
    let parameterIndex = this.parameterIndex;
    if (this.streamEncoder) {
      if (this.streamEncoder.encodeInto(writer)) return true;
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
    if (parameterIndex < argsEncoders.length) return true;
    return this.encodeResultFormat;
  }
  private encodeResultFormat(writer: BufferWriter) {
    if (writer.writableLength < 2) return true;
    writer.view.setInt16(writer.writeOffset, 0), writer.writeOffset += 2; // result column count
    return false;
  }
}

export class ExecuteMessageEncoder implements DynamicLengthBlockEncoder {
  constructor(private maxRows: number, private portal: string = "") {
    this.bodyLength = 4 + calcCStringByteLength(this.portal) + 1; // 1 for message code, 4 for length, portal length + null terminator
  }
  readonly bodyLength: number;
  readonly messageCode = FrontendMessageCode.Execute;
  private offset: number = 0;
  encodeInto(writer: BufferWriter): boolean {
    // Implementation for encoding the Execute message goes here.
    return true;
  }
}
