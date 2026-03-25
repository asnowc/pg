import { DbCursor } from "#abstract";
import { expect, test, vi } from "vitest";

class MockDbCursor extends DbCursor<any> {
  close = vi.fn();
  read = vi.fn<(maxSize?: number) => Promise<any[]>>();
}
test("read method", async function () {
  const cursor = new MockDbCursor();

  cursor.read.mockImplementationOnce(async (maxSize = 3) => {
    return [1, 2, 3].slice(0, maxSize);
  });

  const result = await cursor.read(2);
  expect(result).toEqual([1, 2]);
  expect(cursor.read).toBeCalledWith(2);
});

test("close method", async function () {
  const cursor = new MockDbCursor();

  await cursor.close();
  expect(cursor.close).toBeCalledTimes(1);

  // Calling close again should not throw or have any effect
  await cursor.close();
  expect(cursor.close).toBeCalledTimes(2);
});

test("asyncIterator with empty data", async function () {
  const cursor = new MockDbCursor();

  cursor.read.mockImplementation(async () => []);
  const result: any[] = [];
  for await (const item of cursor) {
    result.push(item);
  }

  expect(result).toEqual([]);
  expect(cursor.read).toBeCalled();
  expect(cursor.close).toBeCalled();
});

test("asyncIterator with multiple reads", async function () {
  const cursor = new MockDbCursor();

  let callCount = 0;
  cursor.read.mockImplementation(async () => {
    if (callCount++ < 2) {
      return [1, 2];
    }
    return [];
  });

  const result: any[] = [];
  for await (const item of cursor) {
    result.push(item);
  }

  expect(result).toEqual([1, 2, 1, 2]);
  expect(cursor.read).toBeCalledTimes(3);
  expect(cursor.close).toBeCalled();
});

test("Symbol.asyncDispose is called", async function () {
  const cursor = new MockDbCursor();

  await cursor[Symbol.asyncDispose]();
  expect(cursor.close).toBeCalledTimes(1);
});
