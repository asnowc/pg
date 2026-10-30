import { PgFieldDescription } from "../messages.ts";
import { getFormat, type MessageParser } from "./_common.ts";
import { CStringDecoder } from "./CStringDecoder.ts";
import type { StreamReader } from "@/_utils/StreamReader.ts";

export type DecodeRowDescriptionResult = PgFieldDescription & { index: number };

export class RowDescriptionDecoder implements MessageParser<DecodeRowDescriptionResult[]> {
  private fields: DecodeRowDescriptionResult[] | undefined;
  private nextIndex: number = 0;
  private fieldName: string | undefined;
  private cStringDecoder = new CStringDecoder();

  next(reader: StreamReader) {
    if (!this.fields) {
      if (reader.readableLength < 2) return undefined;
      this.fields = new Array(reader.readUInt16BE());
    }
    if (!this.fieldName) {
      this.fieldName = this.cStringDecoder.next(reader);
      if (!this.fieldName) return undefined;
    }
    if (reader.readableLength < 18) return undefined;
    const item: Partial<DecodeRowDescriptionResult> = {
      name: this.fieldName,
      index: this.nextIndex,
    };
    item.tableOID = reader.readUInt32BE();
    item.columnAttribute = reader.readInt16BE();
    item.typeOID = reader.readUInt32BE();
    item.typeSize = reader.readInt16BE();
    item.typeModifier = reader.readInt32BE();
    item.format = getFormat(reader.readInt16BE());
    this.fields[this.nextIndex++] = item as DecodeRowDescriptionResult;
    this.fieldName = undefined;
    if (this.nextIndex === this.fields.length) return this.fields;
  }
  reset() {
    this.fields = undefined;
    this.nextIndex = 0;
    this.fieldName = undefined;
    this.cStringDecoder.reset();
  }
}
