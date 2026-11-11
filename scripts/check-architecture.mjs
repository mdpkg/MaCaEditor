import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const modules = new Map();
const owners = ["", "packages/drawing-core", "packages/drawing-react"].map((dir) => ({
  dir,
  manifest: JSON.parse(fs.readFileSync(path.join(root, dir, "package.json"), "utf8")),
}));
const errors = [];
const normalize = (file) => path.relative(root, file).replaceAll("\\", "/");

function collect(dir, owner) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) collect(file, owner);
    else if (/\.tsx?$/.test(file) && !/\.(test|d)\.tsx?$/.test(file)) {
      modules.set(file, { owner, dependencies: [], desktop: false });
    }
  }
}
for (const owner of owners) collect(owner.dir ? `${owner.dir}/src` : "src", owner);

function resolveLocal(file, specifier) {
  const base = specifier.startsWith(".")
    ? normalize(path.resolve(root, path.dirname(file), specifier))
    : owners.find((owner) => owner.manifest.name === specifier)?.dir + "/src/index";
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((candidate) => modules.has(candidate));
}

for (const [file, module] of modules) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true);
  function dependency(specifier, typeOnly, deferred = false) {
    if (specifier.startsWith("@tauri-apps/")) module.desktop = true;
    const target = resolveLocal(file, specifier);
    if (target) {
      module.dependencies.push({ target, typeOnly, deferred });
      if (module.owner.dir && modules.get(target).owner !== module.owner && specifier.startsWith(".")) {
        errors.push(`${file}: cross-package imports must use the public package entry point (${specifier})`);
      }
      if (file.startsWith("src/lib/") && target.startsWith("src/components/")) errors.push(`${file}: library depends on UI ${target}`);
    }
    if (!specifier.startsWith(".")) {
      const name = specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
      const manifest = module.owner.manifest;
      const declared = { ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.devDependencies };
      const typesName = `@types/${name.replace(/^@/, "").replace("/", "__")}`;
      if (!(name in declared) && !(typeOnly && typesName in declared)) errors.push(`${file}: undeclared dependency ${name}`);
    }
    if (module.owner.dir === "packages/drawing-core" && !specifier.startsWith(".")) errors.push(`${file}: drawing-core must stay framework independent`);
    if (module.owner.dir && /^src\//.test(target ?? "")) errors.push(`${file}: reusable package depends on application`);
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings ?? node.exportClause;
      const onlyNamedTypes = !clause?.name && bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) &&
        bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
      dependency(node.moduleSpecifier.text, Boolean(clause?.isTypeOnly || node.isTypeOnly || onlyNamedTypes));
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      dependency(node.arguments[0].text, false, true);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

const visited = new Set();
function visit(file, stack = []) {
  if (stack.includes(file)) { errors.push(`Runtime dependency cycle: ${[...stack.slice(stack.indexOf(file)), file].join(" -> ")}`); return; }
  if (visited.has(file)) return;
  for (const edge of modules.get(file).dependencies) if (!edge.typeOnly && !edge.deferred) visit(edge.target, [...stack, file]);
  visited.add(file);
}
for (const file of modules.keys()) visit(file);

// Pure document use cases must remain usable without loading the desktop SDK.
function checkDesktopDependency(file, seen = new Set()) {
  if (seen.has(file)) return;
  seen.add(file);
  if (modules.get(file).desktop) {
    errors.push(`Document persistence depends on desktop adapter: ${file}`);
  }
  for (const edge of modules.get(file).dependencies) if (!edge.typeOnly) checkDesktopDependency(edge.target, seen);
}
checkDesktopDependency("src/lib/documentPersistence.ts");
assert.deepEqual(errors, [], errors.join("\n"));
console.log(`Architecture checks passed (${modules.size} production modules).`);
