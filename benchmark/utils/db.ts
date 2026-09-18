export const CONNECT_URL = new URL(
  process.env.TEST_LOGIN_DB ??
    "postgres://postgres@127.0.0.1:5432/test_public",
);
export const DB_CONNECT_INFO = {
  host: CONNECT_URL.hostname,
  port: Number(CONNECT_URL.port || 5432),
  user: decodeURIComponent(CONNECT_URL.username) || "postgres",
  password: decodeURIComponent(CONNECT_URL.password),
  database: decodeURIComponent(CONNECT_URL.pathname.slice(1)) || "postgres",
};
