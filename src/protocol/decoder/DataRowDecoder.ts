import { StreamReader } from "@/_utils/StreamReader.ts";
import { MessageParser } from "./_common.ts";
import { PgProtocolError } from "@/_utils/error.ts";
import { PgColumnDataDecoder } from "@/interface/pg_data_decoder.ts";
import { DecodeRowDescriptionResult } from "./RowDescriptionDecoder.ts";
import { PgFormat } from "../const.ts";

export class DataRowDecoder<T extends object> implements MessageParser<T> {
  constructor(
    private columnDecoders: PgColumnDataDecoder<unknown>[],
    private rowDescriptions: DecodeRowDescriptionResult[],
  ) {
    this.columnCount = columnDecoders.length;
  }

  private columnCount: number;
  private currentRow?: Record<string, unknown>;

  private currentValueLength: number | undefined;
  private currentColumnResult: unknown;

  private nextIndex: number = 0;

  next(reader: StreamReader, remainingByteLength: number): T | undefined {
    if (!this.currentRow) {
      if (reader.readableLength < 2) return undefined;
      const columnCount = reader.view.getUint16(reader.readableStart);
      reader.readableStart += 2;
      if (columnCount !== this.columnCount) {
        throw new PgProtocolError(
          `Column count mismatch. RowDescription has ${this.columnCount} columns, but DataRow has ${columnCount} columns.`,
        );
      }
      this.currentRow = {};
    }

    let rowDescription: DecodeRowDescriptionResult, columnDecoder: PgColumnDataDecoder;

    while (this.nextIndex < this.columnCount) {
      if (this.currentValueLength === undefined) {
        if (reader.readableLength < 4) return undefined;
        this.currentValueLength = reader.view.getInt32(reader.readableStart);
        reader.readableStart += 4;
        if (this.currentValueLength === -1) {
          rowDescription = this.rowDescriptions[this.nextIndex];
          this.currentRow[rowDescription.name] = null;
          this.currentValueLength = undefined;
          this.nextIndex++;
          continue;
        }
        if (this.currentValueLength < 0) throw new PgProtocolError("Invalid DataRow field length");
      }
      rowDescription = this.rowDescriptions[this.nextIndex];
      columnDecoder = this.columnDecoders[this.nextIndex];

      const start = reader.readableStart;
      if (rowDescription.format === PgFormat.text) {
        this.currentColumnResult = this.nextForText(reader, this.currentValueLength);
        if (this.currentColumnResult !== undefined) {
          this.currentColumnResult = columnDecoder.decodeText(this.currentColumnResult as string);
        }
      } else {
        this.currentColumnResult = columnDecoder.decodeBinary(reader, this.currentValueLength);
      }

      const readBytes = reader.readableStart - start;
      this.currentValueLength -= readBytes;
      if (this.currentValueLength > 0) {
        return undefined;
      }
      this.currentRow[rowDescription.name] = this.currentColumnResult;
      this.currentColumnResult = undefined;
      this.currentValueLength = undefined;
      this.nextIndex++;
    }
    return this.currentRow as T;
  }
  private textDecodeBuffer?: Uint8Array;
  private textDecodeOffset: number = 0;
  private nextForText(reader: StreamReader, remaining: number): string | undefined {
    if (!this.textDecodeBuffer) {
      if (reader.readableLength >= remaining) {
        const chunk = reader.buffer.subarray(reader.readableStart, reader.readableStart + remaining);
        reader.readableStart += remaining;
        return textDecoder.decode(chunk);
      } else {
        this.textDecodeBuffer = new Uint8Array(remaining);
      }
    }
    const size = Math.min(remaining, reader.readableLength);
    const chunk = reader.buffer.subarray(reader.readableStart, reader.readableStart + size);
    reader.readableStart += size;
    this.textDecodeBuffer.set(chunk, this.textDecodeOffset);
    this.textDecodeOffset += size;
    if (this.textDecodeOffset >= this.textDecodeBuffer.byteLength) {
      const result = textDecoder.decode(this.textDecodeBuffer);
      this.textDecodeBuffer = undefined;
      this.textDecodeOffset = 0;
      return result;
    }
  }
  reset() {
    this.currentValueLength = undefined;
    this.currentColumnResult = undefined;
    this.currentRow = undefined;
    this.nextIndex = 0;
    this.textDecodeBuffer = undefined;
    this.textDecodeOffset = 0;
  }
}
const textDecoder = new TextDecoder();
