import { TypedSqlStatement } from "@/interface/Query.ts";
import { BufferWriter } from "@/_utils/StreamWriter.ts";
import { CStringEncoder, DynamicLengthBlockEncoder, UTF16BufferEncoder } from "@/protocol/encoder/_common.ts";
import { FrontendMessageCode } from "@/protocol/const.ts";
import { calcUTF16ByteLength } from "@/_utils/string.ts";
import { StreamEncoder } from "@/interface/js_data_encoder.ts";

const textEncoder = new TextEncoder();

/**
 *  https://postgres.ac.cn/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PARSE
 *  arg count 表示前端希望预先指定的参数数量，可以为0.
 *  | statement name | statement text |arg count | arg OIDs...
 *  |   C string     |   C string     |  int16   |  int32[]
 */
export class ParseMessageEncoder implements DynamicLengthBlockEncoder {
  constructor(private readonly typedStatement: TypedSqlStatement, private readonly preparedStatementName: string = "") {
    this.bodyLength = 4 + this.typedStatement.statementByteLength + (this.typedStatement.args.length) * 4;
  }
  readonly messageCode = FrontendMessageCode.Parse;
  readonly bodyLength: number;
  private sqlStatement?: string | Uint8Array;
  private offset: number = 0;
  encodeInto(writer: BufferWriter): boolean {
    if (this.sqlStatement === undefined) {
      if (writer.writableLength < 1) return true;
      writer.buffer[writer.writeOffset++] = 0; // statement name is empty C string
      this.sqlStatement = this.typedStatement.sqlStatement;
    }
    if (writer.writableLength < UTF16BufferEncoder.UTF16_ENCODE_FREE_BUFFER_SIZE) return true;
    if (typeof this.sqlStatement === "string") {
      const { read, written } = textEncoder.encodeInto(
        this.sqlStatement.substring(this.offset),
        writer.buffer.subarray(writer.writeOffset),
      );
      writer.writeOffset += written;
      this.offset += read;
    } else {
      const offsetEnd = Math.min(writer.writableLength + this.offset, this.sqlStatement.byteLength);

      writer.buffer.set(this.sqlStatement.subarray(this.offset, offsetEnd), writer.writeOffset);
      writer.writeOffset += offsetEnd - this.offset;
      this.offset = offsetEnd;
    }
    const argsEncoders = this.typedStatement.argsEncoders;
    if (writer.writableLength < 5 + argsEncoders.length * 4) return true;
    writer.buffer[writer.writeOffset++] = 0; // statement text is empty C string
    writer.view.setInt16(writer.writeOffset, argsEncoders.length);
    for (let i = 0; i < argsEncoders.length; i++) {
      writer.view.setInt32(writer.writeOffset, argsEncoders[i].oid);
      writer.writeOffset += 4;
    }
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
 */
export class BindMessageEncoder implements DynamicLengthBlockEncoder {
  constructor(
    private readonly typedStatement: TypedSqlStatement,
    private readonly statementName: string = "",
    private readonly portalName: string = "",
  ) {
    const statementLength = statementName ? calcUTF16ByteLength(statementName) : 0;
    const portalLength = this.portalName ? calcUTF16ByteLength(this.portalName) : 0;

    // | name                  | value       | byte |
    // | --------------------- | ----------- | ---- |
    // | portal name           | ...\0       | n+1  |
    // | statement name        | ...\0       | n+1  |
    // | format code count     | 1           | 2    |
    // | format code           | 1           | 2    |
    // | parameter value count | args.length | 2    |
    // | parameter values      | ...         | n    |
    // | result column count   | 0           | 2    |

    // 9= 1+1+2+2+2+2 (minimum fixed part of the message)
    this.bodyLength = 9 + statementLength + portalLength + (this.typedStatement.argsTotalByteLength);
    this.utf16Encoder = new CStringEncoder(this.portalName);
  }
  readonly messageCode = FrontendMessageCode.Bind;
  readonly bodyLength: number;
  encodeInto(writer: BufferWriter): boolean {
    while (this.currentEncode) {
      if (this.currentEncode(writer)) return true;
    }
    return false;
  }
  private currentEncode?: (writer: BufferWriter) => boolean = this.encodePortalName;

  private readonly utf16Encoder: CStringEncoder;

  private encodePortalName(writer: BufferWriter): boolean {
    if (this.utf16Encoder.encodeInto(writer)) return true;
    this.currentEncode = this.encodeStatementName;
    this.utf16Encoder.reset(this.statementName);
    return false;
  }
  private encodeStatementName(writer: BufferWriter): boolean {
    if (this.utf16Encoder.encodeInto(writer)) return true;
    this.currentEncode = this.setFixed1;
    return false;
  }
  private setFixed1(writer: BufferWriter): boolean {
    if (writer.writableLength < 6) return true;
    writer.view.setInt16(writer.writeOffset, 1), writer.writeOffset += 2; // format code count
    writer.view.setInt16(writer.writeOffset, 1), writer.writeOffset += 2; // format code
    const argsEncoders = this.typedStatement.argsEncoders;
    writer.view.setInt16(writer.writeOffset, argsEncoders.length), writer.writeOffset += 2; // parameter value count
    this.currentEncode = argsEncoders.length ? this.encodeParameterValues : this.encodeResultColumnCount;
    return true;
  }
  private parameterIndex: number = 0;
  private streamEncoder?: StreamEncoder;

  private encodeParameterValues(writer: BufferWriter): boolean {
    let streamEncoder = this.streamEncoder;
    if (streamEncoder) {
      if (streamEncoder.encodeInto(writer)) return true;
      this.streamEncoder = undefined;
    }

    let enc = this.typedStatement.argsEncoders[this.parameterIndex];
    while (enc) {
      while ("byteLength" in enc) {
        if (writer.writableLength < enc.byteLength + 4) return true;
        writer.view.setInt32(writer.writeOffset, enc.byteLength), writer.writeOffset += 4; // parameter value length
        enc.encodeInto(writer, this.typedStatement.args[this.parameterIndex]);
        this.parameterIndex++;
        enc = this.typedStatement.argsEncoders[this.parameterIndex];
      }
      if (writer.writableLength < 4) return true;
      streamEncoder = enc.startEncode(this.typedStatement.args[this.parameterIndex]);
      writer.view.setInt32(writer.writeOffset, streamEncoder.byteLength), writer.writeOffset += 4; // parameter value length
      if (streamEncoder.encodeInto(writer)) {
        this.streamEncoder = streamEncoder;
        return true;
      }
      this.parameterIndex++;
    }
    return false;
  }
  private encodeResultColumnCount(writer: BufferWriter): boolean {
    if (writer.writableLength < 2) return true;
    writer.view.setInt16(writer.writeOffset, 0), writer.writeOffset += 2; // result column count
    return false;
  }
}

export class ExecuteMessageEncoder implements DynamicLengthBlockEncoder {
  constructor(private maxRows: number, private portal: string = "") {}

  private offset: number = 0;
  encodeInto(writer: BufferWriter): boolean {
    // Implementation for encoding the Execute message goes here.
    return true;
  }
}
