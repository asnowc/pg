import { StreamReader } from "@/_utils/StreamReader.ts";
import { MessageParser } from "./_common.ts";
import { PgProtocolError } from "@/_utils/error.ts";
import { PgColumnDecoder } from "@/interface/pg_data_decoder.ts";
import { DecodeRowDescriptionResult } from "./RowDescriptionDecoder.ts";
import { PgFormat } from "../const.ts";

export class DataRowDecoder<T extends {}> implements MessageParser<T> {
  constructor(
    private columnDecoders: PgColumnDecoder<unknown>[],
    private rowDescriptions: DecodeRowDescriptionResult[],
  ) {
    this.columnCount = columnDecoders.length;
  }

  private columnCount: number;
  private currentRow?: Record<string, unknown>;

  private currentValueLength: number = 0;
  private currentColumnResult: any;

  private nextIndex: number = 0;

  next(reader: StreamReader, remainingByteLength: number): T | undefined {
    if (!this.currentRow) {
      if (reader.readableLength < 4) return undefined; // Not enough data to read the row count
      const columnCount = reader.readUInt32BE();
      if (columnCount !== this.columnCount) {
        throw new PgProtocolError(
          `Column count mismatch. RowDescription has ${this.columnCount} columns, but DataRow has ${columnCount} columns.`,
        );
      }
      this.currentRow = {};
    }

    let rowDescription: DecodeRowDescriptionResult, columnDecoder: PgColumnDecoder;

    while (remainingByteLength > 0) {
      if (this.currentValueLength === 0) {
        if (reader.readableLength < 4) return undefined;
        this.currentValueLength = reader.readInt32BE();
        if (this.currentValueLength === -1) {
          rowDescription = this.rowDescriptions[this.nextIndex];
          this.currentRow[rowDescription.name] = null;
          this.nextIndex++;
          continue;
        }
      }
      rowDescription = this.rowDescriptions[this.nextIndex];
      columnDecoder = this.columnDecoders[this.nextIndex];
      this.nextIndex++;

      const start = reader.readableStart;
      if (rowDescription.format === PgFormat.text) {
        this.currentColumnResult = this.nextForText(reader);
        this.currentColumnResult = columnDecoder.decodeText(this.currentColumnResult as string, rowDescription);
      } else {
        this.currentColumnResult = columnDecoder.decodeBinary(
          reader,
          rowDescription,
          this.currentValueLength,
          this.currentColumnResult,
        );
      }

      const readBytes = reader.readableStart - start;
      this.currentValueLength -= readBytes;
      if (this.currentValueLength > 0) {
        return undefined;
      }
      this.currentRow[rowDescription.name] = this.currentColumnResult;
      this.currentColumnResult = undefined;
    }
    return this.currentRow as T;
  }
  private textDecodeBuffer?: Uint8Array;
  private textDecodeOffset: number = 0;
  private nextForText(reader: StreamReader): string | undefined {
    if (!this.textDecodeBuffer) {
      if (reader.readableLength >= this.currentValueLength) {
        const chunk = reader.readBinary(this.currentValueLength);
        return textDecoder.decode(chunk);
      } else {
        this.textDecodeBuffer = new Uint8Array(this.currentValueLength);
      }
    }
    const size = Math.min(this.currentValueLength, reader.readableLength);
    const chunk = reader.readBinary(size);
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
    this.currentValueLength = 0;
    this.currentColumnResult = undefined;
    this.currentRow = undefined;
    this.nextIndex = 0;
  }
  start(columnDecoders: PgColumnDecoder<unknown>[], rowDescriptions: DecodeRowDescriptionResult[]) {
    this.columnDecoders = columnDecoders;
    this.rowDescriptions = rowDescriptions;
    this.columnCount = columnDecoders.length;
  }
}
const textDecoder = new TextDecoder();
