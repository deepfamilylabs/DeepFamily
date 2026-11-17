import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../../src/", import.meta.url));

function location(filename) {
  const relative = path.relative(sourceRoot, filename);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return relative.split(path.sep);
}

export const architecture = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      upward: "{{layer}} must not import from {{target}}; dependencies flow toward shared.",
      internal:
        "Access {{domain}} through its public index.ts entry; move reusable implementation to its owning layer.",
    },
  },
  create(context) {
    const filename = context.filename;
    const source = location(filename);
    if (!source) return {};
    function check(node) {
      if (node?.type === "TSLiteralType") node = node.literal;
      const specifier = node?.value;
      if (typeof specifier !== "string") return;
      const filenameTarget = specifier.startsWith("/src/")
        ? path.join(sourceRoot, specifier.slice(5))
        : specifier.startsWith(".") || path.isAbsolute(specifier)
          ? path.resolve(path.dirname(filename), specifier)
          : null;
      if (!filenameTarget) return;
      const target = location(filenameTarget);
      if (!target) return;
      if (
        (source[0] === "shared" && ["domains", "pages", "app"].includes(target[0])) ||
        (source[0] === "domains" && ["pages", "app"].includes(target[0]))
      ) {
        context.report({
          node,
          messageId: "upward",
          data: { layer: source[0], target: target[0] },
        });
        return;
      }
      if (target[0] !== "domains" || source[0] === "workers") return;
      if (source[0] === "domains" && source[1] === target[1]) return;
      const entry = target.slice(2).join("/");
      if (entry && !/^index(?:\.[cm]?[jt]sx?)?$/.test(entry))
        context.report({ node, messageId: "internal", data: { domain: target[1] } });
    }
    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      TSImportType: (node) => check(node.argument ?? node.parameter),
    };
  },
};

export default { rules: { architecture } };
