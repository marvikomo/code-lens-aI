import Parser from 'tree-sitter';
import * as JavaScript from 'tree-sitter-javascript';

interface FileInfo {
    path: string,
    language: string,
    content: string
}
/**
 * Node in the code graph
 */
interface CodeNode {
    id: string;
    name: string;
    type: 'function' | 'method' | 'class' | 'module' | 'package';
    language?: string;
    file?: string;
    docstring?: string;
    className?: string | null;
    range?: {
        start: Parser.Point;
        end: Parser.Point;
    };
}

/**
 * Function/method node
 */
interface FunctionNode extends CodeNode {
    type: 'function' | 'method';
    className?: string | null;
    docstring?: string;
}

/**
* Call information
*/
interface CallInfo {
    from: string;
    to: string;
    node: Parser.SyntaxNode;
}

/**
 * Import information
 */
interface ImportInfo {
    source: string;
    specifiers?: string[];
    default?: string;
}

/**
 * Parsed file interface
 */
interface ParsedFile {
    path: string;
    language: string;
    tree: Parser.Tree;
    functions: Map<string, FunctionNode>;
    calls: Array<CallInfo>;
    imports: Array<ImportInfo>;
}

/**
* Edge in the code graph
*/
interface CodeEdge {
    id: string;
    from: string;
    to: string;
    fromName?: string;
    toName?: string;
    type: 'CALLS' | 'CALLS_DYNAMIC' | 'IMPORTS' | 'HAS_METHOD' | 'DEFINED_IN';
    source: 'AST-direct' | 'AI-inferred';
    confidence: number;
    pattern?: string;
    reason?: string;
    file?: string;
    range?: {
        start: Parser.Point;
        end: Parser.Point;
    };
}

/**
* Search result interface
*/
export interface SearchResult {
    id: string;
    name: string;
    type: string;
    language: string;
    file: string;
    summary: string;
    capabilities: string[];
    score: number;
    graphContext?: {
        callers: string[];
        callees: string[];
        related: string[];
    };
}

export class CodeLensAI {

    private nodes: Map<string, CodeNode>;
    private edges: Map<string, CodeEdge>;
    private files: Map<string, FileInfo>;
    private parsedFiles: Map<string, ParsedFile>;

    constructor() {
        this.nodes = new Map<string, CodeNode>();
        this.edges = new Map<string, CodeEdge>();
        this.files = new Map<string, FileInfo>();
        this.parsedFiles = new Map<string, ParsedFile>();
    }

    analyze(directoryPath: string, options: { ignoreDirs?: string[], ignoreFiles?: string[] } = {}): void {
        // TODO: Implement code analysis
        console.log('Analyzing dir:', directoryPath);
    }


    private async collectFiles(directory: string, options: { ignoreDirs?: string[], ignoreFiles?: string[] } = {}) {

        const files = [];

        const ignoreDir = new Set(['node_modules', '.git', '.github', 'dist', 'build',
            'target', 'bin', 'obj', 'out', '.idea', '.vscode',
            ...(options.ignoreDirs || [])]);

        const ignoredFiles = new Set([
            '.DS_Store', 'Thumbs.db', 'package-lock.json', 'yarn.lock',
            ...(options.ignoreFiles || [])
        ]);

    }
}

// Example usage
const codeLens = new CodeLensAI();
codeLens.analyze('console.log("Hello, World!");');