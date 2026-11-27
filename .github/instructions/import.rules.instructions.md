---
name: "模块导入规则"
description: "编写或修改 JavaScript、TypeScript 模块的静态导入时使用。"
applyTo: "**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"
---

# 模块导入规则

本文为文档示例性地说明模块导入的边界与术语，不涉及任何具体项目结构。

## 定义

- **模块**：可通过 JavaScript 或 TypeScript 导入的源文件。
- **私有模块**：名称以 `_` 开头的模块。
- **私有目录**：名称以 `_` 开头的目录或桶目录。
- **桶文件**：与同目录中的目录同名的模块。
- **桶目录**：与桶文件同名的目录，用于存放桶文件聚合的模块。
- **引用目录**：静态导入的模块路径字符串中明确包含该目录名作为路径片段。目录是否被引用取决于导入字符串中的路径片段，而非解析后隐含的父目录，路径别名展开后才出现的目录也不算被引用。

例如，模块 `abc/a.ts` 导入 `./b/c/d.ts` 时，同时引用了目录 `abc/b` 和 `abc/b/c`。
模块 `abc/b/c/a.ts` 导入 `./d.ts` 时，不引用 `abc/b` 或 `abc/b/c`。

## 导入规则

- 私有模块只能由同目录中的模块导入。
- 私有目录只能由同目录中的模块引用。
- 导入路径不得包含多余的 `.` 片段或紧跟 `..` 的目录片段，如 `././a.ts`、`./a/../b.ts`。

## 路径示例

允许：

```ts
import { Helper } from "./_helper.ts";
import { PublicType } from "./public.ts";
export * from "./public/Type.ts";
```

不允许：

```ts
import { internalHelper } from "./abc/_helper.ts";
import { internalHelper } from "../_helper.ts";
import { internalHelper } from "../_private/helper.ts";
import { helper } from "./abc/../helper.ts";
import { Helper } from "././_helper.ts";
```

## 私有模块

私有模块用于实现细节，不保证稳定性。

- 私有模块应保持在明确的父模块或功能范围内。
- 私有模块移动或重命名时，应同步更新直接引用方。

## 私有目录

私有目录用于隔离内部实现。

- 私有目录中的模块可以使用 `./other.ts` 导入同目录模块；若路径中明确写出私有目录名，仍须遵循私有目录规则。

## 桶文件与桶目录

桶文件负责统一导出公开模块，桶目录负责组织桶文件聚合的实现。桶目录也是私有目录，
与其同目录的任何模块都可以引用它，不限于对应的桶文件。

- 桶文件可以继续被上层桶文件聚合。
