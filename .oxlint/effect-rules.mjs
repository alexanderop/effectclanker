/**
 * Custom oxlint plugin: Effect-TS discipline rules.
 *
 * Ported from Mike Arnaldi's accountability repo
 * (https://github.com/mikearnaldi/accountability, eslint.config.mjs).
 *
 * oxlint exposes an ESLint-v9-compatible JS plugin API
 * (https://oxc.rs/docs/guide/usage/linter/js-plugins). Each rule is plain
 * ESLint shape: `{ meta, create(context) }`.
 */

const getText = (context, node) => (context.sourceCode ?? context.getSourceCode()).getText(node);

const isMember = (node, object, property) =>
  node?.type === "MemberExpression" &&
  node.object?.type === "Identifier" &&
  node.object.name === object &&
  node.property?.type === "Identifier" &&
  node.property.name === property;

const noDisableValidation = {
  meta: {
    type: "problem",
    docs: { description: "Disallow disableValidation: true in Schema operations" },
    messages: {
      noDisableValidation:
        "Do not use { disableValidation: true }. Schema validation should always be enabled to catch invalid data. If you're seeing validation errors, fix the data or schema instead of disabling validation.",
    },
    schema: [],
  },
  create(context) {
    return {
      Property(node) {
        const keyMatches =
          (node.key?.type === "Identifier" && node.key.name === "disableValidation") ||
          (node.key?.type === "Literal" && node.key.value === "disableValidation");
        if (keyMatches && node.value?.type === "Literal" && node.value.value === true) {
          context.report({ node, messageId: "noDisableValidation" });
        }
      },
    };
  },
};

const preferOptionFromNullable = {
  meta: {
    type: "suggestion",
    docs: { description: "Prefer Option.fromNullable over ternary with Option.some/none" },
    messages: {
      preferFromNullable:
        "Use Option.fromNullable({{name}}) instead of ternary with Option.some/Option.none.",
    },
    schema: [],
  },
  create(context) {
    return {
      ConditionalExpression(node) {
        const { test, consequent, alternate } = node;

        if (test.type !== "BinaryExpression") return;
        if (test.operator !== "!==" && test.operator !== "!=") return;

        let testedName = null;
        if (
          test.left.type === "Identifier" &&
          test.right.type === "Literal" &&
          test.right.value === null
        ) {
          testedName = test.left.name;
        } else if (
          test.right.type === "Identifier" &&
          test.left.type === "Literal" &&
          test.left.value === null
        ) {
          testedName = test.right.name;
        } else if (
          test.left.type === "MemberExpression" &&
          test.right.type === "Literal" &&
          test.right.value === null
        ) {
          testedName = getText(context, test.left);
        } else if (
          test.right.type === "MemberExpression" &&
          test.left.type === "Literal" &&
          test.left.value === null
        ) {
          testedName = getText(context, test.right);
        }
        if (!testedName) return;

        if (consequent.type !== "CallExpression") return;
        if (!isMember(consequent.callee, "Option", "some")) return;

        if (alternate.type !== "CallExpression") return;
        const altCallee = alternate.callee;
        const isOptionNone =
          isMember(altCallee, "Option", "none") ||
          (altCallee.type === "TSInstantiationExpression" &&
            isMember(altCallee.expression, "Option", "none"));
        if (!isOptionNone) return;

        context.report({
          node,
          messageId: "preferFromNullable",
          data: { name: testedName },
        });
      },
    };
  },
};

const pipeMaxArguments = {
  meta: {
    type: "problem",
    docs: { description: "Disallow .pipe() with more than 20 arguments" },
    messages: {
      tooManyArgs:
        ".pipe() has {{count}} arguments. Consider splitting into multiple .pipe() calls for readability (max 20).",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === "MemberExpression" &&
          callee.property?.type === "Identifier" &&
          callee.property.name === "pipe" &&
          node.arguments.length > 20
        ) {
          context.report({
            node,
            messageId: "tooManyArgs",
            data: { count: String(node.arguments.length) },
          });
        }
      },
    };
  },
};

const noEffectAsVoid = {
  meta: {
    type: "problem",
    docs: { description: "Disallow Effect.asVoid - it is usually unnecessary" },
    messages: {
      noEffectAsVoid:
        "Effect.asVoid is usually unnecessary. The `void` return type already allows any value to be returned from an effect. Remove it.",
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (isMember(node, "Effect", "asVoid")) {
          context.report({ node, messageId: "noEffectAsVoid" });
        }
      },
    };
  },
};

const noEffectIgnore = {
  meta: {
    type: "problem",
    docs: { description: "Disallow Effect.ignore - errors should be explicitly handled" },
    messages: {
      noEffectIgnore:
        "Do not use Effect.ignore. It silently discards errors which hides bugs. Handle errors explicitly with Effect.catchTag, Effect.catchAll, or propagate them.",
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (isMember(node, "Effect", "ignore")) {
          context.report({ node, messageId: "noEffectIgnore" });
        }
      },
    };
  },
};

const noEffectCatchAllCause = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow Effect.catchAllCause - it catches defects which should not be caught",
    },
    messages: {
      noEffectCatchAllCause:
        "Do not use Effect.catchAllCause. It catches defects (bugs) which should crash the program. Use Effect.catchAll or Effect.catchTag to handle expected errors only.",
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (isMember(node, "Effect", "catchAllCause")) {
          context.report({ node, messageId: "noEffectCatchAllCause" });
        }
      },
    };
  },
};

const isEffectVoidOrUnit = (node) =>
  node?.type === "MemberExpression" &&
  node.object?.type === "Identifier" &&
  node.object.name === "Effect" &&
  node.property?.type === "Identifier" &&
  (node.property.name === "void" || node.property.name === "unit");

const isVoidReturningHandler = (node) => {
  if (!node) return false;
  if (node.type === "ArrowFunctionExpression") {
    if (isEffectVoidOrUnit(node.body)) return true;
    if (node.body.type === "BlockStatement") {
      const body = node.body.body;
      if (body.length === 1 && body[0].type === "ReturnStatement") {
        return isEffectVoidOrUnit(body[0].argument);
      }
    }
  }
  if (node.type === "FunctionExpression") {
    const body = node.body.body;
    if (body.length === 1 && body[0].type === "ReturnStatement") {
      return isEffectVoidOrUnit(body[0].argument);
    }
  }
  return false;
};

const isEffectCatchCall = (node) => {
  if (node.type !== "CallExpression") return null;
  const callee = node.callee;
  if (callee.type !== "MemberExpression") return null;
  const propName = callee.property?.type === "Identifier" ? callee.property.name : null;
  if (propName !== "catchTag" && propName !== "catchAll" && propName !== "catchTags") {
    return null;
  }
  if (callee.object?.type === "Identifier" && callee.object.name === "Effect") {
    return propName;
  }
  return null;
};

const noSilentErrorSwallow = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow catch handlers that silently swallow errors by returning Effect.void",
    },
    messages: {
      noSilentSwallow:
        "Do not silently swallow errors with '() => Effect.void'. Errors should be represented in the type system, not ignored. Either: (1) let the error propagate to the caller, (2) transform it with mapError to a different error type, or (3) handle it with meaningful recovery logic. Silent error swallowing hides bugs and breaks type safety.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const catchType = isEffectCatchCall(node);
        if (!catchType) return;

        if (catchType === "catchTags" && node.arguments.length >= 1) {
          const obj = node.arguments[0];
          if (obj.type === "ObjectExpression") {
            for (const prop of obj.properties) {
              if (prop.type === "Property" && isVoidReturningHandler(prop.value)) {
                context.report({ node: prop.value, messageId: "noSilentSwallow" });
              }
            }
          }
          return;
        }

        let handlerArg = null;
        if (catchType === "catchTag" && node.arguments.length >= 2) {
          handlerArg = node.arguments[1];
        } else if (catchType === "catchAll" && node.arguments.length >= 1) {
          handlerArg = node.arguments[0];
        }

        if (handlerArg && isVoidReturningHandler(handlerArg)) {
          context.report({ node: handlerArg, messageId: "noSilentSwallow" });
        }
      },
    };
  },
};

const noServiceOption = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow Effect.serviceOption - services should always be present in context",
    },
    messages: {
      noServiceOption:
        "Do not use Effect.serviceOption. Services should always be present in context, even during testing. Yield the service directly (yield* MyService) and ensure it is provided in your layer composition.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (isMember(node.callee, "Effect", "serviceOption")) {
          context.report({ node, messageId: "noServiceOption" });
        }
      },
    };
  },
};

const noNestedLayerProvide = {
  meta: {
    type: "problem",
    docs: { description: "Disallow nested Layer.provide calls" },
    messages: {
      nestedProvide:
        "Nested Layer.provide detected. Extract the inner Layer.provide to a separate variable or use Layer.provideMerge.",
    },
    schema: [],
  },
  create(context) {
    const isLayerProvide = (node) =>
      node?.type === "CallExpression" && isMember(node.callee, "Layer", "provide");

    return {
      CallExpression(node) {
        if (!isLayerProvide(node)) return;
        for (const arg of node.arguments) {
          if (isLayerProvide(arg)) {
            context.report({ node: arg, messageId: "nestedProvide" });
          }
        }
      },
    };
  },
};

const plugin = {
  meta: { name: "effect" },
  rules: {
    "no-disable-validation": noDisableValidation,
    "prefer-option-from-nullable": preferOptionFromNullable,
    "pipe-max-arguments": pipeMaxArguments,
    "no-effect-asvoid": noEffectAsVoid,
    "no-effect-ignore": noEffectIgnore,
    "no-effect-catchallcause": noEffectCatchAllCause,
    "no-silent-error-swallow": noSilentErrorSwallow,
    "no-service-option": noServiceOption,
    "no-nested-layer-provide": noNestedLayerProvide,
  },
};

export default plugin;
