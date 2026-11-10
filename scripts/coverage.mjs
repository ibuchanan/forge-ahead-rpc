import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

// Bun supplies line hits but no function locations. Parse locations so Fallow
// can calculate each function's measured line coverage. Branch maps stay empty.
function convertCoverage(input, output) {
  const files = new Map();
  let lines;
  for (const record of readFileSync(input, "utf8").split(/\r?\n/)) {
    if (record.startsWith("SF:")) {
      const path = resolve(record.slice(3));
      lines = files.get(path) ?? new Map();
      files.set(path, lines);
    } else if (record.startsWith("DA:")) {
      const [line, hits] = record.slice(3).split(",").map(Number);
      if (
        !lines ||
        !Number.isSafeInteger(line) ||
        line < 1 ||
        !Number.isSafeInteger(hits) ||
        hits < 0
      )
        throw new Error("Invalid LCOV line coverage");
      lines.set(line, (lines.get(line) ?? 0) + hits);
    } else if (record === "end_of_record") {
      lines = undefined;
    }
  }
  if (!files.size) throw new Error("No LCOV source files found");
  const coverage = Object.fromEntries(
    [...files].map(([path, hits]) => {
      const statementMap = {};
      const s = {};
      [...hits]
        .sort(([a], [b]) => a - b)
        .forEach(([line, count], id) => {
          statementMap[id] = {
            start: { line, column: 0 },
            end: { line, column: 0 },
          };
          s[id] = count;
        });
      const source = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const position = (offset) => {
        const { line, character } =
          source.getLineAndCharacterOfPosition(offset);
        return { line: line + 1, column: character };
      };
      const fnMap = {};
      const f = {};
      function visit(node) {
        if (ts.isFunctionLike(node) && node.body) {
          const id = Object.keys(fnMap).length;
          const start = position(node.getStart(source));
          const loc = { start, end: position(node.body.end) };
          fnMap[id] = {
            name:
              node.name?.getText(source) ??
              (ts.isVariableDeclaration(node.parent)
                ? node.parent.name.getText(source)
                : ts.isArrowFunction(node)
                  ? "<arrow>"
                  : "<anonymous>"),
            decl: { start, end: start },
            loc,
            line: start.line,
          };
          // A line-hit proxy, not a measured invocation count.
          f[id] = Math.max(
            0,
            ...[...hits]
              .filter(
                ([line]) => line >= loc.start.line && line <= loc.end.line,
              )
              .map(([, count]) => count),
          );
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
      return [path, { path, statementMap, s, fnMap, f, branchMap: {}, b: {} }];
    }),
  );
  writeFileSync(output, `${JSON.stringify(coverage)}\n`);
}

const [input = "coverage/lcov.info", output = "coverage/coverage-final.json"] =
  process.argv.slice(2);
convertCoverage(input, output);
