假设： E= 扩展查询 , Start= BEGIN 扩展查询, END= ROLLBACK 或 COMMIT 的扩展查询语句

假设用户遵循 开启事务必定通过专有 TransactionQueryOperation 的 begin 方法开启事务

若满足流水线要求，无需等待 readyForQuery 消息直接继续发送查询消息

- 连接池每个扩展查询都应带上 Sync: `[E, Sync,E, Sync ,E, Sync]`
- 事务前的扩展查询必须有 Sync，事务结束后必定有 Sync，中间每个扩展查询无需加 Sync：
  `[E,E, Sync, Start, E,E, END, Sync]`。连接成功后的首个事务不发送前置 Sync：`[Start, E,E, END, Sync]`。
- 若简单查询前有扩展查询，则必定在发送简单查询查询前发 Sync，且简单查询后面必须等待 readyForQuery 消息,\
  `[E,E,E Sync, Simple]`, 等待 readyForQuery 后可以继续发送消息
- 简单查询后面必须不能处于事务中（本库的设计要求）

## 队列同步与失败约束

- 事务外每条扩展查询独立发送 Sync；事务前及简单查询前复用已有 Sync，不重复发送。无前序查询时不额外发送 Sync。
- begin 调用时检查同步边界，不满足则立即拒绝，不自动补发 Sync：
  - 写队列为空、读队列也为空时，事务必须未开启。
  - 写队列为空、读队列非空时，读队列队尾必须为 Sync，不需要等待其 ReadyForQuery 才能排入 BEGIN。
  - 写队列非空时，队尾任务必须携带结束 Sync；当前事务外扩展查询及 COMMIT/ROLLBACK 任务满足此条件，简单查询不满足。
- Flush 只要求服务端刷新响应，不替代 Sync。事务内扩展查询保留 Flush，但不插入 Sync。
- 事务外扩展查询在对应 Sync 的 ReadyForQuery 后返回结果；事务内查询在命令完成时返回结果。
- BEGIN 使用扩展查询发送；指定隔离级别时使用 `BEGIN ISOLATION LEVEL ...`。BEGIN、COMMIT、ROLLBACK
  的响应由独立接收器消费，不占用用户查询的结果接收器。
- 简单查询发送后阻止所有后续消息，直到收到该简单查询自身的 ReadyForQuery。前序 Sync 的 ReadyForQuery、 CommandComplete
  或 ErrorResponse 都不能解除此屏障。
- 在 begin 已排入且事务结束尚未排入时，简单查询立即拒绝且不发送 Query。事务结束已经排入后的简单查询按顺序发送。
- 简单查询结束时必须为 Idle；若 ReadyForQuery 为事务中或失败事务中，则拒绝当前和待处理查询并停止队列，不自动回滚。
- 扩展查询 ErrorResponse 拒绝同一 Sync 前被跳过的查询，不影响后续独立同步段。错误到达时尚未排入 Sync
  的事务任务也按相同规则处理。
- 事务段中的错误可能使已发送的 COMMIT/ROLLBACK 被服务端跳过。队列消费对应 ReadyForQuery 并保留其事务状态，
  不自动补发事务结束语句。
- 连接或写入失败拒绝已登记的结果、同步等待者及尚未发送的查询；失败后不再接受新任务。
- 读队列直接向 MessageParsers 注册监听器，不重复捕获监听器异常；异常处理交由消息解析层负责，连接失败时通过 `fail`
  通知队列。
