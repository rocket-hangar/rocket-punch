import { bundleImportRewrite } from '@ssen/bundle-import-rewrite';
import {
  collectDependencies,
  collectScripts,
  getPackagesOrder,
} from '@ssen/collect-dependencies';
import { createExtendedCompilerHost } from '@ssen/extended-compiler-host';
import { flatPackageName } from '@ssen/flat-package-name';
import { rimraf } from '@ssen/promised';
import { rewriteSrcPath } from '@ssen/rewrite-src-path';
import fs from 'fs-extra';
import path from 'path';
import process from 'process';
import type { PackageJson } from 'type-fest';
import ts from 'typescript';
import { readPackages } from './entry/readPackages';
import { buildMessageHandler } from './message-handlers/build';
import { computePackageJson } from './package-json/computePackageJson';
import { getExports } from './package-json/getExports';
import { getRootDependencies } from './package-json/getRootDependencies';
import { getSharedPackageJson } from './package-json/getSharedPackageJson';
import { BuildParams } from './params';
import { fsCopyFilter } from './rule/fsCopyFilter';
import { getCompilerOptions } from './rule/getCompilerOptions';
import { readDirectoryPatterns } from './rule/readDirectoryPatterns';
import { PackageInfo } from './types';

export async function build({
  cwd = process.cwd(),
  sourceRoot = 'src',
  strict = false,
  showPackagesOrder = false,
  dist = path.resolve(cwd, 'out/packages'),
  tsconfig = 'tsconfig.json',
  entry,
  svg = 'create-react-app',
  transformPackageJson,
  transformCompilerHost,
  transformCompilerOptions,
  emitCustomTransformers,
  onMessage = buildMessageHandler,
}: BuildParams) {
  // ---------------------------------------------
  // set env
  // ---------------------------------------------
  if (svg === 'default') {
    process.env.TS_SVG_EXPORT = 'default';
  }

  // ---------------------------------------------
  // rule
  // collect information based on directory rules
  // ---------------------------------------------
  const internalPackages: Map<string, PackageInfo> = await readPackages({
    cwd,
    sourceRoot,
    entry,
  });
  const externalPackages: PackageJson.Dependency = await getRootDependencies({
    cwd,
  });
  const sharedConfig: PackageJson = await getSharedPackageJson({ cwd });

  // ---------------------------------------------
  // entry
  // create build options based on rule output
  // ---------------------------------------------
  const dependenciesMap: Map<string, PackageJson.Dependency> = new Map<
    string,
    PackageJson.Dependency
  >();

  // collect dependencies each package
  for (const packageName of internalPackages.keys()) {
    const imports: PackageJson.Dependency = await collectDependencies({
      // collect dependencies from sources on {cwd}/src/{package}
      rootDir: path.resolve(cwd, sourceRoot, packageName),
      internalPackages: internalPackages,
      externalPackages,
      selfNames: new Set<string>([packageName]),
      checkUndefinedPackage: 'error',
      fixImportPath: ({ importPath, filePath }) =>
        rewriteSrcPath({
          rootDir: path.resolve(cwd, sourceRoot),
          importPath,
          filePath,
        }),
      ...collectScripts,
    });

    dependenciesMap.set(packageName, imports);
  }

  const packageJsonMap: Map<string, PackageJson> = new Map<
    string,
    PackageJson
  >();

  // compute package.json contents each package
  for (const [packageName, packageInfo] of internalPackages) {
    const dependencies: PackageJson.Dependency | undefined =
      dependenciesMap.get(packageName);

    if (!dependencies) {
      throw new Error(`undefiend dependencies of ${packageName}`);
    }

    //const packageDir: string = path.resolve(cwd, sourceRoot, packageName);

    // compute package.json
    const computedPackageJson: PackageJson = await computePackageJson({
      packageInfo,
      sharedConfig,
      dependencies,
    });

    // transform package.json contents if user did set the transformPackageJson() function
    const packageJson: PackageJson =
      typeof transformPackageJson === 'function'
        ? transformPackageJson(packageName)(computedPackageJson)
        : computedPackageJson;

    packageJsonMap.set(packageName, packageJson);
  }

  // get package build order
  // it will sort depends on packages dependency relationship
  const packagesOrder = await getPackagesOrder({
    packageJsonContents: Array.from(packageJsonMap.values()),
  });

  const order: string[] = packagesOrder.map(({ name }) => name);

  if (showPackagesOrder) {
    console.log('packages order:', order.join(', '));
    await fs.writeFile(
      path.join(dist, 'packageJsonMap.json'),
      JSON.stringify(Array.from(packageJsonMap.values()), null, 2),
    );
    console.log(
      `packageJson files saved in "${path.join(dist, 'packageJsonMap.json')}"`,
    );
  }

  // ---------------------------------------------
  // run
  // build packages
  // ---------------------------------------------
  const symlinkDirs: string[] = [];

  // ================================================================
  // build each packages
  // ================================================================
  for (const packageName of order) {
    const packageInfo: PackageInfo | undefined =
      internalPackages.get(packageName);

    if (!packageInfo) {
      throw new Error(`Undefined packageInfo of ${packageName}`);
    }

    const sourceDir: string = path.resolve(cwd, sourceRoot, packageName);
    const outDir: string = path.resolve(dist, flatPackageName(packageName));
    const packageJson: PackageJson | undefined =
      packageJsonMap.get(packageName);

    if (!packageJson) {
      throw new Error(`undefined packagejson content!`);
    }

    await onMessage({
      type: 'begin',
      packageName,
      sourceDir,
      outDir,
    });

    // ---------------------------------------------
    // clean
    // ---------------------------------------------
    await rimraf(outDir);

    await fs.mkdirp(outDir);

    // ---------------------------------------------
    // symlink
    // this symlink will be reference to next build packages
    // ---------------------------------------------
    const symlink: string = path.resolve(cwd, 'node_modules', packageName);

    if (fs.existsSync(symlink) && fs.lstatSync(symlink).isSymbolicLink()) {
      fs.unlinkSync(symlink);
    }

    await fs.mkdirp(path.dirname(symlink));

    await fs.symlink(outDir, symlink);

    symlinkDirs.push(symlink);

    // ---------------------------------------------
    // tsc
    // ---------------------------------------------
    const buildTypes: ('module' | 'commonjs')[] = [];

    if (packageInfo.exports.module) buildTypes.push('module');
    if (packageInfo.exports.commonjs) buildTypes.push('commonjs');

    for (const buildType of buildTypes) {
      const isMainBuild = buildType === packageInfo.exports.main;

      // read compilerOptions from {cwd}/tsconfig.json
      const userCompilerOptions: ts.CompilerOptions = getCompilerOptions({
        searchPath: cwd,
        configName: tsconfig,
        packageInfo,
        buildType,
        declaration: isMainBuild,
      });

      // compute package.json with add some build information
      const computedCompilerOptions: ts.CompilerOptions = {
        ...userCompilerOptions,

        baseUrl: sourceDir,
        paths: {
          ...userCompilerOptions.paths,
          [packageName]: ['.'],
          [packageName + '/*']: ['./*'],
        },

        rootDir: sourceDir,
        outDir: isMainBuild ? outDir : path.join(outDir, `_${buildType}`),
        incremental: true,
        tsBuildInfoFile: path.join(
          dist,
          flatPackageName(packageName) + '.tsbuildinfo',
        ),
      };

      // transform compilerOptions if user set the transformCompilerOptions() function
      const compilerOptions: ts.CompilerOptions =
        typeof transformCompilerOptions === 'function'
          ? transformCompilerOptions(packageName)(computedCompilerOptions)
          : computedCompilerOptions;

      // create compilerHost
      const extendedHost: ts.CompilerHost =
        createExtendedCompilerHost(compilerOptions);

      // transform compilerHost if user set the transformCompilerHost() function
      const host: ts.CompilerHost =
        typeof transformCompilerHost === 'function'
          ? transformCompilerHost(packageName)(compilerOptions, extendedHost)
          : extendedHost;

      const files: string[] = host.readDirectory!(
        sourceDir,
        ...readDirectoryPatterns,
      );

      const program: ts.Program = ts.createProgram(
        files,
        compilerOptions,
        host,
      );

      const customTransformers =
        typeof emitCustomTransformers === 'function'
          ? emitCustomTransformers(packageName)() ?? {}
          : {};

      customTransformers.after = [
        ...(customTransformers.after ?? []),
        bundleImportRewrite({}),
      ];

      // 🔥 compile!!!!!!!!!
      const emitResult: ts.EmitResult = program.emit(
        undefined,
        undefined,
        undefined,
        undefined,
        customTransformers,
      );

      const diagnostics: ts.Diagnostic[] = ts
        .getPreEmitDiagnostics(program)
        .concat(emitResult.diagnostics);

      await onMessage({
        type: 'tsc',
        packageName,
        compilerOptions,
        diagnostics,
      });

      if ((strict && diagnostics.length > 0) || emitResult.emitSkipped) {
        throw new Error(`Build "${packageName}" is failed`);
      }
    }

    // ---------------------------------------------
    // copy static files
    // ---------------------------------------------
    await fs.copy(path.resolve(cwd, sourceRoot, packageName), outDir, {
      filter: fsCopyFilter,
    });

    packageJson.exports = await getExports(packageInfo.exports, outDir);

    // ---------------------------------------------
    // create package.json
    // ---------------------------------------------
    await fs.writeJson(path.resolve(outDir, 'package.json'), packageJson, {
      encoding: 'utf8',
      spaces: 2,
    });

    await onMessage({
      type: 'package-json',
      packageName,
      packageJson,
    });

    await onMessage({
      type: 'success',
      packageJson,
      packageName,
      sourceDir,
      outDir,
    });
  }

  // clean symlinks on node_modules
  for (const symlink of symlinkDirs) {
    fs.unlinkSync(symlink);
  }
}
