import { TypedSqlStatement } from "@/interface/Query.ts";
import { BufferWriter } from "@/_utils/StreamWriter.ts";
import { DynamicLengthBlockEncoder, encodeFrameHeaderInto } from "@/protocol/encoder/_common.ts";
import { FrontendMessageCode } from "@/protocol/const.ts";

const textEncoder = new TextEncoder();

/**
 *  https://postgres.ac.cn/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PARSE
 *  arg count 表示前端希望预先指定的参数数量，可以为0.
 *  | statement name | statement text |arg count | arg OIDs...
 *  |   C string     |   C string     |  int16   |  int32[]
 */
export class ParseMessageEncoder implements DynamicLengthBlockEncoder {
  constructor(private readonly typedStatement: TypedSqlStatement) {
  }

  private sqlStatement?: string | Uint8Array;
  private offset: number = 0;
  encodeInto(writer: BufferWriter): boolean {
    if (this.sqlStatement === undefined) {
      if (writer.writableLength < 6) return false;
      const bodyLength = 1 + this.typedStatement.statementByteLength + 1 + 2 + (this.typedStatement.args.length) * 4;
      encodeFrameHeaderInto(writer, FrontendMessageCode.Parse, bodyLength);
      writer.buffer[writer.writeOffset++] = 0; // statement name is empty C string
      this.sqlStatement = this.typedStatement.sqlStatement;
    }
    if (writer.writableLength < 10) return false;
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
    if (writer.writableLength < 5 + argsEncoders.length * 4) return false;
    writer.buffer[writer.writeOffset++] = 0; // statement text is empty C string
    writer.view.setInt16(writer.writeOffset, argsEncoders.length);
    for (let i = 0; i < argsEncoders.length; i++) {
      writer.view.setInt32(writer.writeOffset, argsEncoders[i].oid);
      writer.writeOffset += 4;
    }
    return true;
  }
}

/**
 *  https://postgres.ac.cn/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-BIND
 *  | portal name | statement name | format code count| format codes... | parameter value count | parameter values... | result column count | result codes...|
 *  | C string    | C string       | int16            | int16[]         | int16                 | value[]             | int16               | int16[]        |
 *
 *  value:
 *  | value length |   value       |
 *  | int32        |  value length |
 */
export class BindMessageEncoder implements DynamicLengthBlockEncoder {
  constructor(private typedStatement: TypedSqlStatement) {}

  private offset: number = 0;
  encodeInto(writer: BufferWriter): boolean {
    // Implementation for encoding the Bind message goes here.
    return true;
  }
}

export class ExecuteMessageEncoder implements DynamicLengthBlockEncoder {
  constructor(private maxRows: number, private portal: string) {}

  private offset: number = 0;
  encodeInto(writer: BufferWriter): boolean {
    // Implementation for encoding the Execute message goes here.
    return true;
  }
}
