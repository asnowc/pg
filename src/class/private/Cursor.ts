import { Cursor as ICursor, FieldInfo, QueryCompletion } from "@/interface/Query.ts";

export class Cursor<T> implements ICursor<T> {
  constructor() {}
  close(): Promise<void> {
    throw new Error("Not implemented");
  }
  get completion(): Promise<QueryCompletion> {
    throw new Error("Not implemented");
  }
  get fields(): readonly Readonly<FieldInfo>[] {
    throw new Error("Not implemented");
  }
  read(maxRows?: number): Promise<T[]> {
    throw new Error("Not implemented");
  }
  get rowsRead(): number {
    throw new Error("Not implemented");
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    throw new Error("Not implemented");
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
}
