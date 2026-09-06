import type { ByteStream } from "@/protocol/ByteStream.ts";

type Bytes = Uint8Array<ArrayBufferLike>;

const encoder = new TextEncoder();

export function concat(...parts: Bytes[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

export function int16(value: number): Uint8Array {
  const output = new Uint8Array(2);
  new DataView(output.buffer).setInt16(0, value);
  return output;
}

export function int32(value: number): Uint8Array {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setInt32(0, value);
  return output;
}

export function uint32(value: number): Uint8Array {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value);
  return output;
}

export function cstring(value: string): Uint8Array {
  return concat(encoder.encode(value), Uint8Array.of(0));
}

export function frame(code: number, body: Bytes = new Uint8Array()): Uint8Array {
  return concat(Uint8Array.of(code), int32(body.byteLength + 4), body);
}

export function readMethods(
  readInto: (buffer: Uint8Array) => Promise<void>,
): Pick<ByteStream, "read" | "readInto"> {
  return {
    async read(byteLength) {
      const buffer = new Uint8Array(byteLength);
      await readInto(buffer);
      return buffer;
    },
    readInto,
  };
}

export const eofReads = readMethods(() => Promise.reject(new Error("Unexpected EOF")));

export function readable(input: Bytes): ByteStream {
  let offset = 0;
  return {
    ...readMethods((buffer) => {
      if (buffer.byteLength > input.byteLength - offset) return Promise.reject(new Error("Unexpected EOF"));
      buffer.set(input.subarray(offset, offset + buffer.byteLength));
      offset += buffer.byteLength;
      return Promise.resolve();
    }),
    write(buffer) {
      return Promise.resolve(buffer.byteLength);
    },
    closeWrite() {
      return Promise.resolve();
    },
    close() {},
  };
}
