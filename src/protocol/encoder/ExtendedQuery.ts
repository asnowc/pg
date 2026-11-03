import { TypedSqlStatement } from "@/interface/Query.ts";
import { BufferWriter } from "@/_utils/StreamWriter.ts";
import { encodeFrameHeaderInto } from "@/protocol/encoder/_common.ts";
import { FrontendMessageCode } from "@/protocol/const.ts";
import { calcUTF16ByteLength } from "@/_utils/string.ts";

const c = new TextEncoderStream();
const textEncoder = new TextEncoder();
export async function writeParse(writer: BufferWriter, statement: TypedSqlStatement) {
  const { sqlStatement } = statement;
  const statementByteLength = typeof sqlStatement === "string"
    ? calcUTF16ByteLength(sqlStatement)
    : sqlStatement.byteLength;

  encodeFrameHeaderInto(
    writer,
    FrontendMessageCode.Parse,
    1 + statementByteLength + 1 + 2 + (statement.args.length) * 4,
  );

  writer.buffer[writer.writeOffset++] = 0;
  if (typeof sqlStatement === "string") {
    let statement: string = sqlStatement;
    let result: TextEncoderEncodeIntoResult = textEncoder.encodeInto(
      sqlStatement,
      writer.buffer.subarray(writer.writeOffset),
    );
    writer.writeOffset += result.written;
    statement = statement.substring(result.read);
  } else {
    writer.buffer.set(new Uint8Array(sqlStatement), writer.writeOffset);
    writer.writeOffset += sqlStatement.byteLength;
  }
}

export async function writeBind(writer: BufferWriter, statement: TypedSqlStatement) {
}

export async function writeExecute(writer: BufferWriter, statement: TypedSqlStatement) {
}
export async function writeExtended(writer: BufferWriter, statement: TypedSqlStatement) {
}
