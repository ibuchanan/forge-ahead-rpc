import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

const files = readdirSync("dist", { recursive: true })
  .filter((file) => file.endsWith(".d.ts"))
  .map((file) => resolve("dist", file));

function moduleSpecifier(node) {
  if (ts.isExternalModuleReference(node)) return node.expression;
  if (ts.isImportTypeNode(node)) return node.argument.literal;
  return node.moduleSpecifier;
}

function siblingPath(specifier, file) {
  const target = ts.resolveModuleName(
    specifier,
    file,
    { moduleResolution: ts.ModuleResolutionKind.Bundler },
    ts.sys,
  ).resolvedModule?.resolvedFileName;
  if (!files.includes(target)) return;
  const path = relative(dirname(file), target).replaceAll("\\", "/");
  return path.startsWith(".") ? path : `./${path}`;
}

// Resolve against the original declarations before writing either module format.
const outputs = files.flatMap((file) => {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const imports = [];
  function visit(node) {
    const specifier = moduleSpecifier(node);
    if (specifier?.text.startsWith(".")) {
      const path = siblingPath(specifier.text, file);
      if (path)
        imports.push({
          start: specifier.getStart(source),
          end: specifier.end,
          path,
        });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return [".d.ts", ".d.cts"].map((extension) => {
    let output = text;
    for (const { start, end, path } of imports.toReversed()) {
      const specifier = path.replace(
        /\.d\.ts$/,
        extension === ".d.ts" ? ".js" : ".cjs",
      );
      output =
        output.slice(0, start) + JSON.stringify(specifier) + output.slice(end);
    }
    return [file.replace(/\.d\.ts$/, extension), output];
  });
});
for (const [file, text] of outputs) writeFileSync(file, text);
