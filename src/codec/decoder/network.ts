import type { PgColumnDataDecoder } from "@/interface/pg_data_decoder.ts";

export const inet: PgColumnDataDecoder<string> = {
  decodeText: (value) => value,
  decodeBinary(reader, remainingByteLength) {
    if (reader.readableLength < remainingByteLength) return undefined;
    const family = reader.view.getUint8(reader.readableStart);
    const mask = reader.view.getUint8(reader.readableStart + 1);
    const isCidr = reader.view.getUint8(reader.readableStart + 2) !== 0;
    const addressLength = reader.view.getUint8(reader.readableStart + 3);

    reader.readableStart += 4;
    const groups: string[] = [];
    switch (family) {
      case 2: {
        for (let index = 0; index < addressLength; index += 1) {
          groups.push(String(reader.view.getUint8(reader.readableStart)));
          reader.readableStart += 1;
        }
        return isCidr || mask !== 32 ? `${groups.join(".")}/${mask}` : groups.join(".");
      }
      case 3: {
        for (let index = 0; index < addressLength; index += 2) {
          groups.push(reader.view.getUint16(reader.readableStart).toString(16));
          reader.readableStart += 2;
        }
        return isCidr || mask !== 128 ? `${compressIpv6(groups)}/${mask}` : compressIpv6(groups);
      }
      default:
        throw new RangeError(`Unsupported inet family: ${family}`);
    }
  },
};

export const macaddr: PgColumnDataDecoder<string> = {
  decodeText: (value: string) => value,
  decodeBinary(reader, remainingByteLength) {
    if (reader.readableLength < remainingByteLength) return undefined;

    const groups: string[] = [];
    for (let i = 0; i < remainingByteLength; i++) {
      groups.push(reader.view.getUint8(reader.readableStart).toString(16).padStart(2, "0"));
      reader.readableStart++;
    }
    return groups.join(":");
  },
};

function compressIpv6(groups: string[]): string {
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < groups.length;) {
    if (groups[index] !== "0") {
      index++;
      continue;
    }
    let end = index;
    while (end < groups.length && groups[end] === "0") end++;
    if (end - index > bestLength) [bestStart, bestLength] = [index, end - index];
    index = end;
  }
  if (bestLength < 2) return groups.join(":");
  const before = groups.slice(0, bestStart).join(":");
  const after = groups.slice(bestStart + bestLength).join(":");
  return `${before}::${after}`;
}
