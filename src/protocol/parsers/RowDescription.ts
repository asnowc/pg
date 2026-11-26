import { DecodeRowDescriptionResult, RowDescriptionDecoder } from "../decode.ts";
import { ReceiverType } from "./QueryTask.ts";
import { ReadableBuffer } from "@/_utils/ReadBuffer.ts";

export class RowDescriptionParser {
  constructor(
    readonly resolve?: (resolver: DecodeRowDescriptionResult[]) => void,
    readonly reject?: (reason: unknown) => void,
  ) {}
  readonly taskType = ReceiverType.RowDescription;
  fields?: DecodeRowDescriptionResult[];

  private readonly rowDescriptionDecoder = new RowDescriptionDecoder();

  rowDescription(reader: ReadableBuffer, remainingByteLength: number): void {
    this.fields = this.rowDescriptionDecoder.next(reader);
    if (!this.fields) return;
    this.rowDescriptionDecoder.reset();
    this.resolve?.(this.fields);
  }
  noData(): void {
    this.fields = [];
    this.resolve?.(this.fields);
  }
}
