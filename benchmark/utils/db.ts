const url = new URL(
  process.env.TEST_LOGIN_DB ??
    "postgres://postgres@127.0.0.1:5432/test_public",
);
export const DB_CONNECT_INFO = {
  host: url.hostname,
  port: Number(url.port || 5432),
  user: decodeURIComponent(url.username) || "postgres",
  password: decodeURIComponent(url.password),
  database: decodeURIComponent(url.pathname.slice(1)) || "postgres",
};
