import { ResourceManager, ResourcePool } from "@/_utils/ResourcePool.ts";
import { test as viTest, vi } from "vitest";
export class MockConn {
  constructor(readonly id: number) {}
  idle = false;
  connected = true;
}
export class MockResourceManage implements ResourceManager<MockConn> {
  private static nextId = 1;
  create = vi.fn<() => Promise<MockConn>>(async function () {
    return new MockConn(MockResourceManage.nextId++);
  });
  dispose = vi.fn<(conn: MockConn) => void>(function (conn) {
    if (conn.connected === false) throw new Error("connected 已经是 false");
    conn.connected = false;
  });

  getAllCreatedConn(): Promise<MockConn[]> {
    return Promise.all(this.create.mock.results.map((item) => item.value));
  }
}
export interface Context {
  resourceManage: MockResourceManage;
  pool: ResourcePool<MockConn>;
}
export const test = viTest.extend<Context>({
  async resourceManage({}, use) {
    await use(new MockResourceManage());
  },
  async pool({ resourceManage }, use) {
    use(new ResourcePool(resourceManage));
  },
});
