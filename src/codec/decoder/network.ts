export const inet = {
  text: (value: string) => value,
  binary: decodeInet,
};

export const macaddr = {
  text: (value: string) => value,
  binary: (value: Uint8Array) => Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(":"),
};

function decodeInet(value: Uint8Array): string {
  if (value.byteLength < 4) throw new RangeError("Invalid inet value");
  const family = value[0];
  const mask = value[1];
  const isCidr = value[2] !== 0;
  const length = value[3];
  const address = value.subarray(4);
  if (address.byteLength !== length) throw new RangeError("Invalid inet address length");

  let output: string;
  let fullMask: number;
  if (family === 2 && length === 4) {
    output = address.join(".");
    fullMask = 32;
  } else if (family === 3 && length === 16) {
    const groups = Array.from(
      { length: 8 },
      (_, index) => new DataView(address.buffer, address.byteOffset + index * 2, 2).getUint16(0).toString(16),
    );
    output = compressIpv6(groups);
    fullMask = 128;
  } else {
    throw new RangeError(`Unsupported inet family: ${family}`);
  }
  return isCidr || mask !== fullMask ? `${output}/${mask}` : output;
}

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
