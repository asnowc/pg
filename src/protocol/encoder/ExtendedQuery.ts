import { TypedSqlStatement } from "@/interface/Query.ts";
import { BufferWriter } from "@/_utils/StreamWriter.ts";
import { CStringEncoder, DynamicLengthBlockEncoder, UTF16BufferEncoder } from "@/protocol/encoder/_common.ts";
import { FrontendMessageCode } from "@/protocol/const.ts";
import { calcUTF16ByteLength, encodeUTF16StringInto } from "@/_utils/string.ts";
import { StreamEncoder } from "@/interface/js_data_encoder.ts";

const textEncoder = new TextEncoder();

/**
 *  https://postgres.ac.cn/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PARSE
 *  arg count 表示前端希望预先指定的参数数量，可以为0.
 *  | statement name | statement text |arg count | arg OIDs...
 *  |   C string     |   C string     |  int16   |  int32[]
 *  名称能完整写入时直接编码，仅跨缓冲区的名称创建续写对象。
 */
export class ParseMessageEncoder implements DynamicLengthBlockEncoder {
  constructor(private readonly typedStatement: TypedSqlStatement, private readonly statementName: string = "") {
    this.statementNameByteLength = calcUTF16ByteLength(statementName);
    this.bodyLength = 4 + this.statementNameByteLength + this.typedStatement.statementByteLength +
      typedStatement.argsEncoders.length * 4;
  }
  private readonly statementNameByteLength: number;
  private cStringEncoder?: CStringEncoder;
  readonly messageCode = FrontendMessageCode.Parse;
  readonly bodyLength: number;
  private sqlStatement?: string | Uint8Array;
  private sqlByteOffset = 0;
  private oidIndex?: number;
  encodeInto(writer: BufferWriter): boolean {
    if (this.sqlStatement === undefined) {
      if (!this.cStringEncoder && writer.writableLength >= this.statementNameByteLength + 1) {
        if (this.statementName) {
          writer.writeOffset += encodeUTF16StringInto(this.statementName, writer.buffer.subarray(writer.writeOffset));
        }
        writer.buffer[writer.writeOffset++] = 0;
      } else {
        if (!this.cStringEncoder) {
          if (writer.writableLength < UTF16BufferEncoder.UTF16_ENCODE_FREE_BUFFER_SIZE) return true;
          this.cStringEncoder = new CStringEncoder(this.statementName);
        }
        if (this.cStringEncoder.encodeInto(writer)) return true;
        this.cStringEncoder = undefined;
      }

      this.sqlStatement = this.typedStatement.sqlStatement;
    }
    if (this.sqlByteOffset < this.typedStatement.statementByteLength) {
      if (typeof this.sqlStatement === "string") {
        if (writer.writableLength < Math.min(4, this.typedStatement.statementByteLength - this.sqlByteOffset)) {
          return true;
        }
        const output = writer.writeOffset === 0 ? writer.buffer : writer.buffer.subarray(writer.writeOffset);
        const { read, written } = textEncoder.encodeInto(this.sqlStatement, output);
        writer.writeOffset += written;
        this.sqlByteOffset += written;
        if (this.sqlByteOffset < this.typedStatement.statementByteLength) {
          this.sqlStatement = this.sqlStatement.substring(read);
        }
      } else {
        if (writer.writableLength === 0) return true;
        const offsetEnd = Math.min(writer.writableLength + this.sqlByteOffset, this.sqlStatement.byteLength);
        const bytes = this.sqlByteOffset === 0 && offsetEnd === this.sqlStatement.byteLength
          ? this.sqlStatement
          : this.sqlStatement.subarray(this.sqlByteOffset, offsetEnd);
        writer.buffer.set(bytes, writer.writeOffset);
        writer.writeOffset += offsetEnd - this.sqlByteOffset;
        this.sqlByteOffset = offsetEnd;
      }
      if (this.sqlByteOffset < this.typedStatement.statementByteLength) return true;
    }
    const argsEncoders = this.typedStatement.argsEncoders;
    if (this.oidIndex === undefined) {
      if (writer.writableLength < 3) return true;
      writer.buffer[writer.writeOffset++] = 0;
      writer.view.setInt16(writer.writeOffset, argsEncoders.length), writer.writeOffset += 2;
      this.oidIndex = 0;
    }

    if (this.oidIndex === argsEncoders.length) return false;
    const end = Math.min(argsEncoders.length, this.oidIndex + Math.floor(writer.writableLength / 4));
    let writeOffset = writer.writeOffset;
    for (let i = this.oidIndex; i < end; i++) {
      writer.view.setInt32(writeOffset, argsEncoders[i].oid);
      writeOffset += 4;
    }
    writer.writeOffset = writeOffset;
    this.oidIndex = end;
    return end < argsEncoders.length;
  }
}

enum BindEncodeStage {
  PortalName,
  StatementName,
  Formats,
  Parameters,
  ResultFormat,
  Done,
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
export class BindMessageEncoder implements DynamicLengthBlockEncoder {
  constructor(
    private readonly typedStatement: TypedSqlStatement,
    private readonly statementName: string = "",
    private readonly portalName: string = "",
  ) {
    // | name                  | value       | byte |
    // | --------------------- | ----------- | ---- |
    // | portal name           | ...\0       | n+1  |
    // | statement name        | ...\0       | n+1  |
    // | format code count     | 1           | 2    |
    // | format code           | 1           | 2    |
    // | parameter value count | args.length | 2    |
    // | parameter values      | ...         | n    |
    // | result column count   | 0           | 2    |

    // 10= 1+1+2+2+2+2 (minimum fixed part of the message)
    this.statementNameByteLength = calcUTF16ByteLength(statementName);
    this.portalNameByteLength = calcUTF16ByteLength(portalName);
    // Two C-string terminators and four int16 fields.
    this.bodyLength = 10 + this.statementNameByteLength + this.portalNameByteLength +
      (typedStatement.argsTotalByteLength + typedStatement.argsEncoders.length * 4);
  }
  private readonly statementNameByteLength: number;
  private readonly portalNameByteLength: number;
  private stage = BindEncodeStage.PortalName;
  private cStringEncoder?: CStringEncoder;
  private parameterIndex = 0;
  private streamEncoder?: StreamEncoder;
  readonly messageCode = FrontendMessageCode.Bind;
  readonly bodyLength: number;
  encodeInto(writer: BufferWriter): boolean {
    if (this.stage === BindEncodeStage.PortalName) {
      if (this.encodeName(writer, this.portalName, this.portalNameByteLength)) return true;
      this.stage = BindEncodeStage.StatementName;
    }
    if (this.stage === BindEncodeStage.StatementName) {
      if (this.encodeName(writer, this.statementName, this.statementNameByteLength)) return true;
      this.stage = BindEncodeStage.Formats;
    }
    if (this.stage === BindEncodeStage.Formats) {
      if (writer.writableLength < 6) return true;
      writer.view.setInt16(writer.writeOffset, 1), writer.writeOffset += 2; // format code count
      writer.view.setInt16(writer.writeOffset, 1), writer.writeOffset += 2; // format code
      writer.view.setInt16(writer.writeOffset, this.typedStatement.argsEncoders.length), writer.writeOffset += 2;
      this.stage = BindEncodeStage.Parameters;
    }
    if (this.stage === BindEncodeStage.Parameters) {
      if (this.encodeParameterValues(writer)) return true;
      this.stage = BindEncodeStage.ResultFormat;
    }
    if (this.stage === BindEncodeStage.ResultFormat) {
      if (writer.writableLength < 2) return true;
      writer.view.setInt16(writer.writeOffset, 0), writer.writeOffset += 2; // result column count
      this.stage = BindEncodeStage.Done;
    }
    return false;
  }

  private encodeName(writer: BufferWriter, value: string, byteLength: number): boolean {
    if (!this.cStringEncoder) {
      if (writer.writableLength >= byteLength + 1) {
        if (value) writer.writeOffset += encodeUTF16StringInto(value, writer.buffer.subarray(writer.writeOffset));
        writer.buffer[writer.writeOffset++] = 0;
        return false;
      }
      if (writer.writableLength < UTF16BufferEncoder.UTF16_ENCODE_FREE_BUFFER_SIZE) return true;
      this.cStringEncoder = new CStringEncoder(value);
    }
    if (this.cStringEncoder.encodeInto(writer)) return true;
    this.cStringEncoder = undefined;
    return false;
  }
  private encodeParameterValues(writer: BufferWriter): boolean {
    let parameterIndex = this.parameterIndex;
    if (this.streamEncoder) {
      if (this.streamEncoder.encodeInto(writer)) return true;
      this.streamEncoder = undefined;
      parameterIndex++;
    }

    const argsEncoders = this.typedStatement.argsEncoders;
    const args = this.typedStatement.args;
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
    return parameterIndex < argsEncoders.length;
  }
}

export class ExecuteMessageEncoder implements DynamicLengthBlockEncoder {
  constructor(private maxRows: number, private portal: string = "") {
    this.bodyLength = 4 + calcUTF16ByteLength(this.portal) + 1; // 1 for message code, 4 for length, portal length + null terminator
  }
  readonly bodyLength: number;
  readonly messageCode = FrontendMessageCode.Execute;
  private offset: number = 0;
  encodeInto(writer: BufferWriter): boolean {
    // Implementation for encoding the Execute message goes here.
    return true;
  }
}
