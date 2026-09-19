const textDecoder = new TextDecoder();

export const json = {
  text: (value: string) => JSON.parse(value),
  binary: (value: Uint8Array) => JSON.parse(textDecoder.decode(value)),
};

export const jsonb = {
  text: (value: string) => JSON.parse(value),
  binary: (value: Uint8Array) => JSON.parse(textDecoder.decode(value.subarray(1))),
};
