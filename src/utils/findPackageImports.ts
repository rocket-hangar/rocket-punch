import { PackageJson } from 'type-fest';
import ts from 'typescript';
import { TrismPackageInfo } from '../types';

export async function findPackageImports({
  dir,
  internalPackages,
  externalPackages,
}: {
  dir: string;
  internalPackages: TrismPackageInfo[];
  externalPackages: PackageJson.Dependency;
}): Promise<PackageJson.Dependency> {
  const compilerOptions: ts.CompilerOptions = {
    rootDir: dir,
  };

  const host: ts.CompilerHost = ts.createCompilerHost(compilerOptions);

  const files: string[] = host.readDirectory!(
    dir,
    ['.ts'],
    ['**/*.spec.ts', '**/*.test.ts', '**/__tests__', '**/__test__', '**/*.js'],
    ['**/*'],
  );

  const program: ts.Program = ts.createProgram(files, compilerOptions, host);

  const importPaths: Set<string> = new Set<string>();

  for (const file of files) {
    const sourceFile: ts.SourceFile | undefined = program.getSourceFile(file);

    if (!sourceFile) continue;

    function search(node: ts.Node) {
      // import from '?'
      if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier) && node.moduleSpecifier.text) {
        importPaths.add(node.moduleSpecifier.text);
      }
      // import('?')
      else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        importPaths.add((node.arguments[0] as ts.StringLiteralLike).text);
      }
      // require.resolve('?')
      else if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.escapedText === 'require' &&
        node.expression.name.escapedText === 'resolve' &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        importPaths.add((node.arguments[0] as ts.StringLiteralLike).text);
      }
      // require('?')
      else if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.escapedText === 'require' &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        importPaths.add((node.arguments[0] as ts.StringLiteralLike).text);
      }

      ts.forEachChild(node, search);
    }

    search(sourceFile);
  }

  const imports: PackageJson.Dependency = {};

  for (const importPath of importPaths) {
    const packageName: string = /^@/.test(importPath)
      ? importPath.split('/').slice(0, 2).join('/')
      : importPath.split('/')[0];

    if (!imports[packageName]) {
      const internalPackage: TrismPackageInfo | undefined = internalPackages.find(({ name }) => packageName === name);

      if (internalPackage) {
        imports[packageName] = `^${internalPackage.version}`;
      } else if (externalPackages[packageName]) {
        imports[packageName] = externalPackages[packageName];
      }
    }
  }

  return imports;
}
