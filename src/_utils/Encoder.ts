export interface FixedEncodable {
  byteLength: number;
  encodeInto(buffer: Uint8Array, offset: number): number;
}

export interface BufferEncodable {
  byteLength?: number;
  startEncode(): BufferEncoder;
}

export interface BufferEncoder {
  done: boolean;
  encodeInto(buffer: Uint8Array, offset: number): number;
}
