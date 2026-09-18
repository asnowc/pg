import { Bench } from "tinybench";
import { getSortedResult } from "../utils/bench.ts";
import {
  decodeInt16BE,
  decodeInt32BE,
  decodeInt64BE,
  decodeInt8,
  decodeUInt16BE,
  decodeUInt32BE,
  decodeUInt64BE,
  decodeUInt8,
  encodeInt16BE,
  encodeInt32BE,
  encodeInt64BE,
  encodeInt8,
} from "../../src/_utils/number.ts";

let bytes = new Uint8Array([0x80, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde]);
let dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
let encodeBytes = new Uint8Array(8);
let encodeDataView = new DataView(encodeBytes.buffer, encodeBytes.byteOffset, encodeBytes.byteLength);

let offset = 0;
type Decoder = () => number | bigint;

type Encoder = () => void;

const encodes: { [key: string]: [Encoder, Encoder, Encoder] } = {
  "Int8": [
    () => encodeInt8(encodeBytes, 0, -128),
    () => encodeDataView.setInt8(0, -128),
    () => new DataView(encodeBytes.buffer, encodeBytes.byteOffset, encodeBytes.byteLength).setInt8(0, -128),
  ],
  "Int16": [
    () => encodeInt16BE(encodeBytes, 0, -32768),
    () => encodeDataView.setInt16(0, -32768),
    () => new DataView(encodeBytes.buffer, encodeBytes.byteOffset, encodeBytes.byteLength).setInt16(0, -32768),
  ],
  "Int32": [
    () => encodeInt32BE(encodeBytes, 0, -2147483648),
    () => encodeDataView.setInt32(0, -2147483648),
    () => new DataView(encodeBytes.buffer, encodeBytes.byteOffset, encodeBytes.byteLength).setInt32(0, -2147483648),
  ],
  "Int64": [
    () => encodeInt64BE(encodeBytes, 0, -9223372036854775808n),
    () => encodeDataView.setBigInt64(0, -9223372036854775808n),
    () =>
      new DataView(encodeBytes.buffer, encodeBytes.byteOffset, encodeBytes.byteLength).setBigInt64(
        0,
        -9223372036854775808n,
      ),
  ],
};

const decodes: { [key: string]: [Decoder, Decoder, Decoder] } = {
  "Int8": [
    () => decodeInt8(bytes, offset),
    () => dataView.getInt8(offset),
    () => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt8(offset),
  ],
  "Uint8": [
    () => decodeUInt8(bytes, offset),
    () => dataView.getUint8(offset),
    () => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint8(offset),
  ],
  "Int16": [
    () => decodeInt16BE(bytes, offset),
    () => dataView.getInt16(offset),
    () => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt16(offset),
  ],
  "Uint16": [
    () => decodeUInt16BE(bytes, offset),
    () => dataView.getUint16(offset),
    () => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset),
  ],
  "Int32": [
    () => decodeInt32BE(bytes, offset),
    () => dataView.getInt32(offset),
    () => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset),
  ],
  "Uint32": [
    () => decodeUInt32BE(bytes, offset),
    () => dataView.getUint32(offset),
    () => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset),
  ],
  "Int64": [
    () => decodeInt64BE(bytes, offset),
    () => dataView.getBigInt64(offset),
    () => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigInt64(offset),
  ],
  "Uint64": [
    () => decodeUInt64BE(bytes, offset),
    () => dataView.getBigUint64(offset),
    () => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(offset),
  ],
};

await runEncode();
await runDecode();
async function runDecode() {
  for (const name in decodes) {
    const [bitwise, existingView, newView] = decodes[name];
    const bench = new Bench({ name, time: 100, iterations: 99999, warmupTime: 50 });
    bench.add("bitwise", bitwise);
    bench.add("existing DataView", existingView);
    bench.add("new DataView", newView);
    await bench.run();
    console.log(bench.name);
    console.table(getSortedResult(bench));
  }
}

async function runEncode() {
  for (const name in encodes) {
    const [bitwise, existingView, newView] = encodes[name];
    const bench = new Bench({ name: `Encode ${name}`, time: 100, iterations: 99999, warmupTime: 50 });
    bench.add("bitwise", bitwise);
    bench.add("existing DataView", existingView);
    bench.add("new DataView", newView);
    await bench.run();
    console.log(bench.name);
    console.table(getSortedResult(bench));
  }
}
