/**
 *
 * 判断导入路径中是否有多余的 . 片段或目录名后紧跟 ..，例如：
 *
 * ././_helper.ts：不允许，重复的 . 可以省略。
 * ./a/../b.ts：不允许，a/.. 可以抵消。
 * ../b.ts、../../b.ts：允许。
 *
 * @param {string} specifier
 */
function hasNonCanonicalSegments(specifier) {
  return /\/\.(?:\/|$)/.test(specifier) || /(?:^|\/)(?!\.{1,2}\/)[^/]+\/\.\.(?:\/|$)/.test(specifier);
}
/** @param {string} specifier */
function hasImportPrivate(specifier) {
  /**
   * 排除导入私有模块或引用私有目录
   */
  let excludePrefix;
  if (specifier.startsWith("./")) {
    let n = specifier.indexOf("/", 2);
    if (n >= 0) excludePrefix = specifier.slice(n);
    else excludePrefix = "";
  } else {
    excludePrefix = specifier;
  }
  let result = excludePrefix.match(/\/_[^\/]*/);

  if (result) {
    const target = result[0];
    if (result.index + target.length === excludePrefix.length) {
      return {
        type: "privateModule",
        target: specifier,
      };
    } else {
      return {
        type: "privateDirectory",
        target: target.slice(1),
      };
    }
  }
  return null;
}

/** @param {import("@oxlint/plugins").Options[0] | undefined} options */
function compileIgnorePatterns(options) {
  if (options !== undefined && (options === null || typeof options !== "object" || Array.isArray(options))) {
    throw new TypeError("Import boundary options must be an object.");
  }
  const ignorePatterns = options?.ignorePatterns;
  if (ignorePatterns !== undefined && !Array.isArray(ignorePatterns)) {
    throw new TypeError("ignorePatterns must be an array of regular expression strings.");
  }
  return (ignorePatterns ?? []).map((pattern) => {
    if (typeof pattern !== "string") {
      throw new TypeError("ignorePatterns must contain only regular expression strings.");
    }
    return new RegExp(pattern);
  });
}

/** @type {import("@oxlint/plugins").Rule} */
const rule = {
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: {
          ignorePatterns: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      nonCanonical: "Import '{{specifier}}' contains a redundant '.' or a directory followed by '..'.",
      privateModule: "Private module '{{target}}' may only be imported by files in the same directory.",
      privateDirectory: "Private directory '{{target}}' may only be referenced by files in its parent directory.",
    },
  },
  create(context) {
    const ignoredImports = compileIgnorePatterns(context.options[0]);

    /** @param {import("@oxlint/plugins").ESTree.StringLiteral} source */
    function check(source) {
      const specifier = source.value;
      if (hasNonCanonicalSegments(specifier)) {
        context.report({ node: source, messageId: "nonCanonical", data: { specifier } });
        return;
      }
      const hasPrivate = hasImportPrivate(specifier);
      if (hasPrivate) {
        context.report({
          node: source,
          messageId: hasPrivate.type,
          data: { target: hasPrivate.target },
        });
        return;
      }
    }

    return {
      ImportDeclaration(node) {
        const source = node.source;
        if (/(^\w+$)|(^\w+:)/.test(source.value)) return;
        if (ignoredImports.some((pattern) => pattern.test(source.value))) return;
        check(source);
      },
    };
  },
};

export default {
  meta: { name: "import-boundary" },
  rules: { boundaries: rule },
};
