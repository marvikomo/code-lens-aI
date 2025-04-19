import Parser from 'tree-sitter';

import {
    FunctionNode,
    ClassNode,
    VariableNode,
    CallInfo,
    ImportInfo,
    ExportInfo,
    FileMetrics
} from './code';

interface FileInfo {
    path: string,
    language: string,
    content: string,
    size: number;
    lastModified: Date;
    hash: string;
}

/**
 * Parsed file interface
 */
interface ParsedFile {
    path: string;
    language: string;
    tree: Parser.Tree;
    functions: Map<string, FunctionNode>;
    classes: Map<string, ClassNode>;
    variables: Map<string, VariableNode>;
    calls: Array<CallInfo>;
    imports: Array<ImportInfo>;
    exports: Array<ExportInfo>;
    metrics: FileMetrics;
    dependsOn: Set<string>; // Files this file depends on
    dependedOnBy: Set<string>; // Files that depend on this file
}

export {
    FileInfo,
    ParsedFile
}



