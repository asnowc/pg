import { beforeEach, describe, expect, test, vi } from "vitest";
import { DbQuery } from "#abstract";

class MockDbQuery extends DbQuery {
  query = vi.fn();
  execute = vi.fn();
  multipleQuery = vi.fn();
}

describe("DbQuery", () => {
  let dbQuery: MockDbQuery;

  beforeEach(() => {
    dbQuery = new MockDbQuery();
  });

  test("should call query with correct SQL and return rows in queryRows", async () => {
    const mockRows = [{ id: 1, name: "test" }];
    dbQuery.query.mockResolvedValue({ rowCount: 1, rows: mockRows });

    const result = await dbQuery.queryRows("SELECT * FROM users");
    expect(dbQuery.query).toHaveBeenCalledWith("SELECT * FROM users");
    expect(result).toEqual(mockRows);
  });

  test("should call query with correct SQL and return first row in queryFirstRow", async () => {
    const mockRows = [{ id: 1, name: "test" }];
    dbQuery.query.mockResolvedValue({ rowCount: 1, rows: mockRows });

    const result = await dbQuery.queryFirstRow("SELECT * FROM users");
    expect(dbQuery.query).toHaveBeenCalledWith("SELECT * FROM users");
    expect(result).toEqual(mockRows[0]);
  });

  test("should throw an error if queryFirstRow returns no rows", async () => {
    dbQuery.query.mockResolvedValue({ rowCount: 0, rows: [] });

    await expect(dbQuery.queryFirstRow("SELECT * FROM users")).rejects.toThrow("Query did not return any rows");
  });

  test("should call query with correct SQL and return row count in queryCount", async () => {
    dbQuery.query.mockResolvedValue({ rowCount: 5 });

    const result = await dbQuery.queryCount("UPDATE users SET name = 'test'");
    expect(dbQuery.query).toHaveBeenCalledWith("UPDATE users SET name = 'test'");
    expect(result).toBe(5);
  });
});
