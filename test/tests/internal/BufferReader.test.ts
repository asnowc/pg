import { expect, test } from "vitest";
import { BufferReader } from "@/\u005futils/StreamReader.ts";

test("gc 保留未读字节并允许继续追加", () => {
  const reader = new BufferReader(new Uint8Array(6));
  expect(reader.pushReaderBufferData(Uint8Array.of(1, 2, 3, 4))).toBe(4);
  expect(reader.readBinary(2)).toEqual(Uint8Array.of(1, 2));

  reader.gc();
  expect(reader.readableLength).toBe(2);
  expect(reader.pushReaderBufferData(Uint8Array.of(5, 6, 7, 8))).toBe(4);
  expect(reader.readBinary(6)).toEqual(Uint8Array.of(3, 4, 5, 6, 7, 8));
});

test("gc 在尚未读取时不丢弃数据", () => {
  const reader = new BufferReader(new Uint8Array(4));
  reader.pushReaderBufferData(Uint8Array.of(1, 2));
  reader.gc();
  expect(reader.readableLength).toBe(2);
  expect(reader.readBinary(2)).toEqual(Uint8Array.of(1, 2));
});

test("从非零 byteOffset 缓冲区读取大小端整数", () => {
  const backing = new Uint8Array(36);
  const reader = new BufferReader(backing.subarray(3, 33));
  const view = new DataView(backing.buffer, 3, 30);
  view.setInt8(0, -1);
  view.setUint8(1, 255);
  view.setInt16(2, -1234);
  view.setUint16(4, 54321);
  view.setInt32(6, -12345678);
  view.setUint32(10, 3456789012);
  view.setBigInt64(14, -123456789n);
  view.setBigUint64(22, 12345678901234567890n);
  reader.readerBufferWriteOffset = 30;

  expect(reader.readInt8()).toBe(-1);
  expect(reader.readUInt8()).toBe(255);
  expect(reader.readInt16BE()).toBe(-1234);
  expect(reader.readUInt16BE()).toBe(54321);
  expect(reader.readInt32BE()).toBe(-12345678);
  expect(reader.readUInt32BE()).toBe(3456789012);
  expect(reader.readInt64BE()).toBe(-123456789n);
  expect(reader.readUInt64BE()).toBe(12345678901234567890n);
  expect(reader.readableLength).toBe(0);
});

test("readBinary 借用缓冲区，copyBinary 保留独立副本", () => {
  const reader = new BufferReader(new Uint8Array(4));
  reader.pushReaderBufferData(Uint8Array.of(1, 2, 3, 4));
  const borrowed = reader.readBinary(2);
  const copied = reader.copyBinary(2);
  reader.buffer[0] = 9;
  reader.buffer[2] = 9;
  expect(borrowed).toEqual(Uint8Array.of(9, 2));
  expect(copied).toEqual(Uint8Array.of(3, 4));
});