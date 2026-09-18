import { InvalidArgumentError } from "commander";

/** 逗号分隔列表 */
export function list(value: string): string[] {
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

export function integer(minimum: number) {
  return (value: string): number => {
    const number = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < minimum) {
      throw new InvalidArgumentError(`Expected an integer >= ${minimum}.`);
    }
    return number;
  };
}

export function integerList(minimum: number) {
  const parse = integer(minimum);
  return (value: string): number[] => list(value).map(parse);
}

export function jsonObject(value: string): Record<string, unknown> {
  let data: unknown;
  try {
    data = JSON.parse(value);
  } catch {
    throw new InvalidArgumentError("Expected a JSON object.");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new InvalidArgumentError("Expected a JSON object.");
  }
  return data as Record<string, unknown>;
}
