import svgr from '@svgr/core';
import fs from 'fs-extra';
import { safeLoad } from 'js-yaml';
import path from 'path';
import {
  CompilerHost,
  CompilerOptions,
  createCompilerHost,
  createSourceFile,
  ScriptKind,
  ScriptTarget,
  SourceFile,
} from 'typescript';

interface TransformConfig {
  getSourceText: (fileName: string) => string;
}

const plainTextTransformConfig: TransformConfig = {
  getSourceText: (fileName: string) => {
    const file: string = fileName.substr(0, fileName.length - 4);
    const content: string = fs.readFileSync(file, 'utf8');
    return `export default '${content}'`;
  },
};

const imageTransformConfig: TransformConfig = {
  getSourceText: (fileName: string) => {
    const file: string = fileName.substr(0, fileName.length - 4);
    const ext: string = path.extname(file);
    const source: string = fs.readFileSync(file, 'base64').replace(/[\r\n]+/gm, '');
    return `export default 'data:image/${ext};base64,${source}'`;
  },
};

const yamlTransformConfig: TransformConfig = {
  getSourceText: (fileName: string) => {
    const file: string = fileName.substr(0, fileName.length - 4);
    const content: string = fs.readFileSync(file, 'utf8');
    return `export default ${JSON.stringify(safeLoad(content))}`;
  },
};

const transformConfigs: Record<string, TransformConfig> = {
  txt: plainTextTransformConfig,
  md: plainTextTransformConfig,
  yml: yamlTransformConfig,
  yaml: yamlTransformConfig,
  jpg: imageTransformConfig,
  jpeg: imageTransformConfig,
  gif: imageTransformConfig,
  png: imageTransformConfig,
  webp: imageTransformConfig,
  svg: {
    getSourceText: (fileName: string) => {
      const file: string = fileName.substr(0, fileName.length - 4);
      const content: string = fs.readFileSync(file, 'utf8');
      return svgr.sync(content, { typescript: true }, { componentName: 'MyComponent' });
    },
  },
};

const extensions: string[] = Object.keys(transformConfigs);

function findConfig(fileName: string): TransformConfig | undefined {
  for (const ext of extensions) {
    if (new RegExp(`\\.${ext}\\.tsx$`).test(fileName)) {
      return transformConfigs[ext];
    }
  }

  return undefined;
}

export function createExtendedCompilerHost(options: CompilerOptions, setParentNodes?: boolean): CompilerHost {
  const compilerHost: CompilerHost = createCompilerHost(options, setParentNodes);

  function fileExists(fileName: string): boolean {
    const transformConfig: TransformConfig | undefined = findConfig(fileName);
    return !!transformConfig || compilerHost.fileExists(fileName);
  }

  function getSourceFile(
    fileName: string,
    languageVersion: ScriptTarget,
    onError?: (message: string) => void,
    shouldCreateNewSourceFile?: boolean,
  ): SourceFile | undefined {
    const transformConfig: TransformConfig | undefined = findConfig(fileName);

    if (transformConfig) {
      const sourceText: string = transformConfig.getSourceText(fileName);
      return createSourceFile(
        fileName,
        sourceText,
        options.target || ScriptTarget.Latest,
        setParentNodes,
        ScriptKind.TSX,
      );
    }

    return compilerHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  }

  return {
    ...compilerHost,
    fileExists,
    getSourceFile,
  };
}