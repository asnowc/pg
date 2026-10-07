假设： E= 扩展查询 , Start= BEGIN 扩展查询, END= ROLLBACK 或 COMMIT 的扩展查询语句

假设用户遵循 开启事务必定通过专有 TransactionQueryOperation 的 begin 方法开启事务

若满足流水线要求，无需等待 readyForQuery 消息直接继续发送查询消息

- 连接池每个扩展查询都应带上 Sync: `[E, Sync,E, Sync ,E, Sync]`
- 事务查询前后必定有 Sync，中间每个扩展查询无需加 Sync : `[E,E, Sync, Start, E,E, END, Sync]`
- 若简单查询前有扩展查询，则必定在发送简单查询查询前发 Sync，且简单查询后面必须等待 readyForQuery 消息,\
  `[E,E,E Sync, Simple]`, 等待 readyForQuery 后可以继续发送消息
- 简单查询后面必须不能处于事务中（本库的设计要求）
