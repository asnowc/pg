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
    while (this.nextIndex < this.fields.length) {
      if (this.fieldName === undefined) {
        this.fieldName = this.cStringDecoder.next(reader);
        if (this.fieldName === undefined) return undefined;
      }
      if (reader.readableLength < 18) return undefined;
      const item: DecodeRowDescriptionResult = {
        name: this.fieldName,
        index: this.nextIndex,
        tableOID: reader.view.getUint32(reader.readableStart),
        columnAttribute: reader.view.getInt16(reader.readableStart + 4),
        typeOID: reader.view.getUint32(reader.readableStart + 6),
        typeSize: reader.view.getInt16(reader.readableStart + 10),
        typeModifier: reader.view.getInt32(reader.readableStart + 12),
        format: getFormat(reader.view.getInt16(reader.readableStart + 16)),
      };
      reader.readableStart += 18;
      this.fields[this.nextIndex++] = item;
      this.fieldName = undefined;
    }
    return this.fields;
  }
  reset() {
    this.fields = undefined;
    this.nextIndex = 0;
    this.fieldName = undefined;
    this.cStringDecoder.reset();
  }
}
