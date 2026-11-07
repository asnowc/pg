import { PgFieldDescription } from "../messages.ts";
import { getFormat, type MessageParser } from "./_common.ts";
import { createCStringDecoder } from "./CStringDecoder.ts";
import type { StreamReader } from "@/_utils/StreamReader.ts";

export type DecodeRowDescriptionResult = PgFieldDescription & { index: number };

export class RowDescriptionDecoder implements MessageParser<DecodeRowDescriptionResult[]> {
  private fields: DecodeRowDescriptionResult[] | undefined;
  private nextIndex: number = 0;
  private fieldName: string | undefined;
  private cStringDecoder = createCStringDecoder();

  next(reader: StreamReader) {
    if (!this.fields) {
      if (reader.readableLength < 2) return undefined;
      this.fields = new Array(reader.view.getUint16(reader.readableStart));
      reader.readableStart += 2;
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
    item.tableOID = reader.view.getUint32(reader.readableStart);
    reader.readableStart += 4;
    item.columnAttribute = reader.view.getInt16(reader.readableStart);
    reader.readableStart += 2;
    item.typeOID = reader.view.getUint32(reader.readableStart);
    reader.readableStart += 4;
    item.typeSize = reader.view.getInt16(reader.readableStart);
    reader.readableStart += 2;
    item.typeModifier = reader.view.getInt32(reader.readableStart);
    reader.readableStart += 4;
    const format = reader.view.getInt16(reader.readableStart);
    reader.readableStart += 2;
    item.format = getFormat(format);
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
