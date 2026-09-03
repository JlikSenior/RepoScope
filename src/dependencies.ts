import { dirname, resolve } from "node:path";
import {
  access,
  readFile,
} from "node:fs/promises";

export async function resolveImportPath(
  sourceFile: string,
  importPath: string,
): Promise<string | null> {
  if (!importPath.startsWith(".")) {
    return null;
  }

  const basePath = resolve(
    dirname(sourceFile),
    importPath,
  );

  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    resolve(basePath, "index.ts"),
    resolve(basePath, "index.tsx"),
    resolve(basePath, "index.js"),
    resolve(basePath, "index.jsx"),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // 这个候选不存在，继续试下一个
    }
  }

  return null;
}

export function extractImports(
  content: string,
): string[] {
  const imports: string[] = [];

  const importPattern =
    /import\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g;

  for (const match of content.matchAll(importPattern)) {
    const importPath = match[1];

    if (importPath) {
      imports.push(importPath);
    }
  }

  return imports;
}

export async function getDirectDependencies(
  sourceFile: string,
): Promise<string[]> {
  const content = await readFile(sourceFile, "utf8");

  const imports = extractImports(content);

  const dependencies: string[] = [];

  for (const importPath of imports) {
    const resolvedPath = await resolveImportPath(
      sourceFile,
      importPath,
    );

    if (resolvedPath) {
      dependencies.push(resolvedPath);
    }
  }

  return dependencies;
}