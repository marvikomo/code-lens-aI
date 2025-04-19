import Parser from 'tree-sitter';
import * as fs from 'fs';
import * as path from 'path';
// Update the module declaration to match tree-sitter's Language type
// Import the module directly without type declaration
import JavaScript from 'tree-sitter-javascript';

import { logger } from './logger';

// Create a type for the language instance
type TreeSitterLanguage = Parser.Language & {
    nodeTypeInfo: any;
};


interface FileInfo {
    path: string,
    language: string,
    content: string,
    size: number;
    lastModified: Date;
    hash: string; 
}
/**
 * Node in the code graph
 */
interface CodeNode {
    id: string;
    name: string;
    type: 'function' | 'method' | 'class' | 'module' | 'package' | 'variable' | 'export';
    language?: string;
    file?: string;
    docstring?: string;
    className?: string | null;
    range?: {
        start: Parser.Point;
        end: Parser.Point;
    };
    metrics?: CodeMetrics;
    semanticProperties?: SemanticProperties;
}

/**
 * Semantic properties for enhanced analysis
 */
interface SemanticProperties {
    purity: 'pure' | 'impure' | 'unknown'; // Function purity
    sideEffects: boolean;
    mutatesParameters: boolean;
    accessesGlobalState: boolean;
    throwsExceptions: boolean;
    categories: string[]; // Inferred categories like 'data processing', 'UI', etc.
}

/**
 * Code metrics for functions, classes, and files
 */
interface CodeMetrics {
    complexity: number; // Cyclomatic complexity
    linesOfCode: number;
    commentPercentage: number;
    parameterCount?: number;
    nestingDepth: number;
    cognitiveComplexity?: number;
}

/**
 * Function/method node
 */
interface FunctionNode extends CodeNode {
    type: 'function' | 'method';
    className?: string | null;
    docstring?: string;
    parameters?: ParameterInfo[];
    returnType?: string;
    complexity?: number;
    async?: boolean;
    generator?: boolean;
    exported?: boolean;
    visibility?: 'public' | 'private' | 'protected';
}

/**
 * Parameter information
 */
interface ParameterInfo {
    name: string;
    type?: string;
    defaultValue?: string;
    optional: boolean;
    rest: boolean; // whether it's a rest parameter (...args)
}

/**
* Call information
*/
interface CallInfo {
    from: string;
    to: string;
    node: Parser.SyntaxNode;
    argumentCount: number;
    isDynamic: boolean;
    confidence: number;
    isAsync: boolean;
}

/**
 * Import information
 */
interface ImportInfo {
    source: string;
    specifiers?: string[];
    default?: string;
    isTypeOnly?: boolean; // TypeScript type imports
    importKind: 'static' | 'dynamic'; // static or dynamic import
    range?: {
        start: Parser.Point;
        end: Parser.Point;
    };
}

/**
 * Export information
 */
interface ExportInfo {
    name: string;
    source?: string; // For re-exports
    isDefault: boolean;
    isTypeOnly?: boolean; // TypeScript type exports
    range?: {
        start: Parser.Point;
        end: Parser.Point;
    };
}

/**
 * Class node with enhanced information
 */
interface ClassNode extends CodeNode {
    type: 'class';
    superClass?: string;
    interfaces?: string[];
    methods: string[]; // IDs of method nodes
    properties: VariableNode[];
    constructorParams?: ParameterInfo[];
    exported?: boolean;
}

/**
 * Variable node for tracking variables
 */
interface VariableNode extends CodeNode {
    type: 'variable';
    dataType?: string;
    mutable: boolean; // const vs let/var
    initialValue?: string;
    usages: string[]; // IDs of nodes where this variable is used
    exported?: boolean;
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
 * Language configuration interface
 */
interface LanguageConfig {
    extensions: string[];
    parser: Parser;
    queries: {
        functions: Parser.Query;
        calls: Parser.Query;
        imports: Parser.Query;
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
    private languages: Record<string, LanguageConfig>;
    private jsParser: Parser;

    constructor() {
        this.nodes = new Map<string, CodeNode>();
        this.edges = new Map<string, CodeEdge>();
        this.files = new Map<string, FileInfo>();
        this.parsedFiles = new Map<string, ParsedFile>();
        this.jsParser = new Parser();
        this.jsParser.setLanguage(JavaScript as TreeSitterLanguage);

        // Initialize language configurations
        this.languages = {
            javascript: {
                extensions: ['.js', '.jsx', '.ts', '.tsx'],
                parser: this.jsParser,
                queries: {
                    functions: this.createJavaScriptFunctionQuery(),
                    calls: this.createJavaScriptCallQuery(),
                    imports: this.createJavaScriptImportQuery()
                }
            }
        };
    }


    /**
   * Create the JavaScript function query for Tree-sitter
   * @returns Tree-sitter query for JavaScript functions
   * @private
   */
    private createJavaScriptFunctionQuery(): Parser.Query {
        const queryString = `
  ;; Named function declarations
  (function_declaration
    name: (identifier) @name) @function

  ;; Exported named functions
  (export_statement
    (function_declaration
      name: (identifier) @name)) @function

  ;; Exported default anonymous function declaration
  (export_statement
    (function_declaration) @function) @default_anon

  ;; Exported default anonymous function expression
  (export_statement
    (function_expression) @function)

  ;; Exported default arrow function
  (export_statement
    (arrow_function) @function)

  ;; Arrow functions assigned to variables
  (variable_declarator
    name: (identifier) @name
    value: (arrow_function)) @function

  ;; Function expressions assigned to variables
  (variable_declarator
    name: (identifier) @name
    value: (function_expression)) @function

  ;; Arrow functions inside object literals
  (pair
    key: (property_identifier) @name
    value: (arrow_function)) @function

  ;; IIFE (Immediately Invoked Function Expression)
  (call_expression
    function: (parenthesized_expression
      (function_expression
        name: (identifier) @name)) @function) @iife

  ;; Class declarations
  (class_declaration
    name: (identifier) @name) @class

  ;; Class expressions
  (variable_declarator
    name: (identifier) @name
    value: (class)) @class

  ;; Method definitions
  (method_definition
    name: (property_identifier) @name) @method

  ;; Constructors
  (method_definition
    name: (property_identifier) @name
    (#eq? @name "constructor")) @constructor

  ;; Object literal methods
  (pair
    key: (property_identifier) @name
    value: (function_expression)) @method
`;


        return new Parser.Query(JavaScript as TreeSitterLanguage, queryString);

    }


    /**
    * Create the JavaScript import query for Tree-sitter
    * @returns Tree-sitter query for JavaScript imports
    * @private
    */
    private createJavaScriptImportQuery(): Parser.Query {
        const queryString = `
      ; Import statements
      (import_statement
        source: (string) @import_source
        (import_specifier
          name: (identifier) @import_specifier)?
        (import_clause
          (identifier) @import_default)?
      ) @import_statement

      ; Require statements
      (call_expression
        function: (identifier) @require
        arguments: (arguments (string) @require_path))
    `;

        return new Parser.Query(this.jsParser.getLanguage(), queryString);
    }


    /**
   * Create the JavaScript call query for Tree-sitter
   * @returns Tree-sitter query for JavaScript calls
   * @private
   */
    private createJavaScriptCallQuery(): Parser.Query {
        const queryString = `
        ;; Direct function calls like foo()
        (call_expression
          function: (identifier) @callee) @call
    
        ;; Method calls like obj.method()
        (call_expression
          function: (member_expression
            object: (identifier) @object
            property: (property_identifier) @method)) @method_call
    
        ;; Method calls via this: this.method()
        (call_expression
          function: (member_expression
            object: (this) @object
            property: (property_identifier) @method)) @method_call
    
        ;; Method calls via super: super.method()
        (call_expression
          function: (member_expression
            object: (super) @object
            property: (property_identifier) @method)) @method_call
    
        ;; Chained method call: foo().bar()
        (call_expression
          function: (member_expression
            object: (call_expression) @chained_object
            property: (property_identifier) @method)) @method_call
    
        ;; Computed property access: obj[expr]()
        (call_expression
          function: (subscript_expression) @dynamic_call)
      `;
    

        return new Parser.Query(this.jsParser.getLanguage(), queryString);
    }

    public async analyze(directoryPath: string, options: { ignoreDirs?: string[], ignoreFiles?: string[] } = {}): Promise<void> {
        //('Analyzing dir:', directoryPath);

        const files = await this.collectFiles(directoryPath, options);

        await this.performAnalysis(files);

        // console.log('parsed files', this.parsedFiles)

        // console.log('Files collected:', files);
    }


    private async collectFiles(directory: string, options: { ignoreDirs?: string[], ignoreFiles?: string[] } = {}) {
        //console.log('Collecting files in dir1:', directory);
        const files: any = [];

        const ignoredDirs = new Set(['node_modules', '.git', '.github', 'dist', 'build',
            'target', 'bin', 'obj', 'out', '.idea', '.vscode',
            ...(options.ignoreDirs || [])]);

        const ignoredFiles = new Set([
            '.DS_Store', 'Thumbs.db', 'package-lock.json', 'yarn.lock',
            ...(options.ignoreFiles || [])
        ]);

        const collectFilesRecursive = (dir: string): void => {
            //console.log('Collecting files in dir:', dir);
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    if (!ignoredDirs.has(entry.name)) {
                        collectFilesRecursive(fullPath);
                    }
                } else if (entry.isFile()) {
                    if (!ignoredFiles.has(entry.name)) {
                        const language = this.detectLanguage(fullPath);
                        if (language) {
                            files.push(fullPath);
                        }
                    }
                }
            }
        };

        collectFilesRecursive(directory);
        return files;

    }

    /**
   * Perform static AST analysis on files
   * @param files Array of file paths
   * @private
   */

    private async performAnalysis(files: string[]): Promise<void> {
        console.log('Starting static AST analysis phase...', files);

        // Process files in batches to avoid memory issues
        const batchSize = 50;

        for (let i = 0; i < files.length; i += batchSize) {

            let batchs = files.slice(i, i + batchSize);
            // Parse files
            for (const filePath of batchs) {
                await this.parseFile(filePath);
            }

            // Analyze parsed files
            for (const filePath of batchs) {
                if (this.parsedFiles.has(filePath)) {
                    const parsedFile = this.parsedFiles.get(filePath)!;

                    // Extract function declarations
                    this.extractFunctions(parsedFile);

                    // Extract function calls
                    this.extractCalls(parsedFile);

                }
            }

        }



        //  logger.writeResults(this.nodes, "nodes");





    }





    /**
  * Detect language from file path
  * @param filePath Path to the file
  * @returns Language identifier or null if unsupported
  * @private
  */
    private detectLanguage(filePath: string): string | null {
        const ext = path.extname(filePath).toLowerCase();

        for (const [language, config] of Object.entries(this.languages)) {
            if (config.extensions.includes(ext)) {
                return language;
            }
        }

        return null;
    }

    /**
      * Parse a file with the appropriate language parser
      * @param filePath Path to the file
      * @private
      */
    private async parseFile(filePath: string): Promise<void> {
        const language = this.detectLanguage(filePath);
        if (!language) {
            console.warn(`Unsupported file type: ${filePath}`);
            return;
        }
        const content = fs.readFileSync(filePath, 'utf8');

        // Store file content
        this.files.set(filePath, {
            path: filePath,
            language,
            content
        });

        // Parse with Tree-sitter
        const parser = this.languages[language].parser;
        const tree = parser.parse(content);

        // Store parsed file
        this.parsedFiles.set(filePath, {
            path: filePath,
            language,
            tree,
            functions: new Map(),
            calls: [],
            imports: []
        });

        // logger.writeResults(this.parsedFiles);


    }


    /**
 * Extract functions from a parsed file
 * @param parsedFile Parsed file object
 * @private
 */
    private extractFunctions(parsedFile: ParsedFile): void {
        const { path: filePath, language, tree } = parsedFile;
        const query = this.languages[language].queries.functions;

        try {
            const captures = query.captures(tree.rootNode);
            const classMap = new Map<number, string>();

            // First pass - identify classes
            for (const { node, name } of captures) {
                if (name === 'class') {
                    let className = '';
                    const classNode = node;

                    // Find the identifier inside the class declaration (captured as @name)
                    for (const capture of captures) {
                        if (
                            capture.name === 'name' &&
                            node.startIndex <= capture.node.startIndex &&
                            capture.node.endIndex <= node.endIndex
                        ) {
                            className = capture.node.text;
                            break;
                        }
                    }

                    // Fallback if somehow className isn't found
                    if (!className) {
                        className = node.text; // fallback (not ideal)
                    }

                    if (classNode) {
                        classMap.set(classNode.id, className);

                        const classId = `${filePath}:${className}`;
                        this.nodes.set(classId, {
                            id: classId,
                            name: className,
                            type: 'class',
                            language,
                            file: filePath,
                            range: {
                                start: classNode.startPosition,
                                end: classNode.endPosition,
                            },
                        });
                    }
                }
            }



            // Second pass - extract functions/methods
            for (const { node, name } of captures) {
                if (name === 'function' || name === 'method') {
                    let funcName = '';
                    let funcType = name as 'function' | 'method';
                    let className: string | null = null;

                    // Find function name
                    for (const capture of captures) {
                        if (
                            capture.name === 'name' &&
                            node.startIndex <= capture.node.startIndex &&
                            capture.node.endIndex <= node.endIndex
                        ) {
                            funcName = capture.node.text;
                            break;
                        }
                    }

                    if (!funcName) {
                        if (
                            node.type === 'arrow_function' || node.type === 'function_declaration' || node.type === 'function_expression'
                        ) {
                            // Check if wrapped in an export_statement
                            let maybeExport = node.parent;
                            while (maybeExport && maybeExport.type !== 'program') {
                                if (maybeExport.type === 'export_statement') {
                                    funcName = 'default'; // or 'export_default_anon'
                                    break;
                                }
                                maybeExport = maybeExport.parent;
                            }
                        }
                    }



                    // If it's a method, find the class it belongs to
                    if (name === 'method') {
                        let current = node.parent;
                        while (current) {
                            if (classMap.has(current.id)) {
                                className = classMap.get(current.id)!;
                                funcName = `${className}.${funcName}`;
                                break;
                            }
                            current = current.parent;
                        }
                    }


                    if (funcName) {
                        // Get docstring/comments if available
                        const docstring = this.extractDocstring(node, language);

                        // Create function node
                        const funcId = `${filePath}:${funcName}`;
                        const functionNode: FunctionNode = {
                            id: funcId,
                            name: funcName,
                            type: funcType,
                            language,
                            file: filePath,
                            docstring,
                            className,
                            range: {
                                start: node.startPosition,
                                end: node.endPosition
                            }
                        };

                        this.nodes.set(funcId, functionNode);
                        parsedFile.functions.set(funcId, functionNode);

                        // If this is a method, create relationship to class
                        if (className) {
                            const classId = `${filePath}:${className}`;
                            const edgeId = `${classId}->HAS_METHOD->${funcId}`;

                            this.edges.set(edgeId, {
                                id: edgeId,
                                from: classId,
                                to: funcId,
                                type: 'HAS_METHOD',
                                source: 'AST-direct',
                                confidence: 1.0
                            });
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Error extracting functions from ${filePath}:`, (error as Error).message);
        }
    }


    /**
  * Extract function calls from a parsed file
  * @param parsedFile Parsed file object
  * @private
  */
    private extractCalls(parsedFile: ParsedFile): void {
        const { path: filePath, language, tree, functions } = parsedFile;
        const query = this.languages[language].queries.calls;

        try {
            for (const [funcId, func] of functions.entries()) {
                if (!func.range) continue;

                const functionNode = tree.rootNode.descendantForPosition(func.range.start, func.range.end);
                if (!functionNode) continue;

                const captures = query.captures(functionNode);

                for (const { node, name } of captures) {
                    let callee = '';

                    console.log("name", name)

                    if (name === 'call') {
                        for (const capture of captures) {
                            if (
                                capture.name === 'callee' &&
                                node.startIndex <= capture.node.startIndex &&
                                capture.node.endIndex <= node.endIndex
                            ) {
                                callee = capture.node.text;
                                break;
                            }
                        }
                    }

                    else if (name === 'method_call') {
                        let object = '';
                        let method = '';

                        for (const capture of captures) {
                            if (
                                capture.name === 'object' &&
                                node.startIndex <= capture.node.startIndex &&
                                capture.node.endIndex <= node.endIndex
                            ) {
                                object = capture.node.text;
                            } else if (
                                capture.name === 'method' &&
                                node.startIndex <= capture.node.startIndex &&
                                capture.node.endIndex <= node.endIndex
                            ) {
                                method = capture.node.text;
                            }
                        }

                        if (object && method) {
                            callee = `${object}.${method}`;
                        } else if (object && !method) {
                            callee = `${object}.[computed]`;
                        }
                    }

                    else if (name === 'optional_method_call') {
                        let base = '';
                        let method = '';
                        for (const capture of captures) {
                            if (capture.name === 'object') base = capture.node.text;
                            if (capture.name === 'method') method = capture.node.text;
                        }
                        callee = `${base}?.${method}`;
                    }

                    else if (name === 'chained_object') {
                        callee = node.text + '.[chained]';
                    }

                    else if (name === 'dynamic_call') {
                        callee = '[dynamic_call]';
                    }

                    if (callee) {
                        const edgeId = `${funcId}->CALLS->${callee}`;

                        this.edges.set(edgeId, {
                            id: edgeId,
                            from: funcId,
                            to: callee,
                            fromName: func.name,
                            toName: callee,
                            type: 'CALLS',
                            source: 'AST-direct',
                            confidence: 1.0,
                            range: {
                                start: node.startPosition,
                                end: node.endPosition
                            },
                            file: filePath
                        });

                        

                        parsedFile.calls.push({
                            from: func.name,
                            to: callee,
                            node
                        });
                    }
                }

               
            }

           //console.log("parsed", this.parsedFiles)
            logger.writeResults(this.parsedFiles, "log-parsed-file-after-extract-call");
            logger.writeResults(this.edges, "log-edges-after-extract-call");
        } catch (error) {
            console.error(`Error extracting calls from ${filePath}:`, (error as Error).message);
        }
    }

    /**
 * Extract docstring from node by language
 * @param node Tree-sitter node
 * @param language Programming language
 * @returns Extracted docstring
 * @private
 */
    private extractDocstring(node: Parser.SyntaxNode, language: string): string {
        if (!node) return '';

        try {
            // Instead of accessing tree.sourcePath (which doesn't exist in Tree-sitter types),
            // we need to find the file path another way - we'll use our parsing context
            let filePath: string | undefined;

            // Find the root node and use it to identify the file
            const rootNode = node.tree?.rootNode;
            if (rootNode) {
                // Match this node's root with our parsed files to find the path
                for (const [path, parsedFile] of this.parsedFiles.entries()) {
                    if (parsedFile.tree.rootNode === rootNode) {
                        filePath = path;
                        break;
                    }
                }
            }

            if (!filePath || !this.files.has(filePath)) return '';

            const content = this.files.get(filePath)!.content;
            //For now we will impl for javascript, python and java
            // Language-specific docstring extraction
            switch (language) {
                case 'javascript':
                    // Look for JSDoc-style comments
                    const jsStart = node.startPosition.row;
                    if (jsStart > 0) {
                        const lines = content.split('\n');
                        const commentLines = [];

                        // Look for comments before the function
                        for (let i = jsStart - 1; i >= Math.max(0, jsStart - 20); i--) {
                            const line = lines[i].trim();

                            // Found the start of a JSDoc block
                            if (line.startsWith('/**')) {
                                commentLines.unshift(line);
                                break;
                            }
                            // Middle of JSDoc block
                            else if (line.startsWith('*')) {
                                commentLines.unshift(line);
                            }
                            // Empty line or regular comment - continue looking
                            else if (line === '' || line.startsWith('//')) {
                                continue;
                            }
                            // End search if we hit code
                            else {
                                break;
                            }
                        }

                        if (commentLines.length > 0) {
                            return commentLines.join('\n');
                        }
                    }
                    break;

                case 'python':
                    // Look for triple-quoted docstrings in function body
                    if (node.childCount > 0) {
                        const body = node.childCount > 2 ? node.child(2) : null; // Function body in Python

                        if (body && body.childCount > 0) {
                            const firstStatement = body.child(0);

                            if (firstStatement && firstStatement.type === 'expression_statement') {
                                const expr = firstStatement.child(0);

                                if (expr && expr.type === 'string') {
                                    return expr.text.replace(/^(['"])\1\1([\s\S]*)\1\1\1$/, '$2').trim();
                                }
                            }
                        }
                    }
                    break;

                case 'java':
                    // Look for Javadoc comments
                    const javaStart = node.startPosition.row;
                    if (javaStart > 0) {
                        const lines = content.split('\n');
                        const commentLines = [];

                        // Look for comments before the method
                        for (let i = javaStart - 1; i >= Math.max(0, javaStart - 20); i--) {
                            const line = lines[i].trim();

                            // Found the start of a Javadoc block
                            if (line.startsWith('/**')) {
                                commentLines.unshift(line);
                                break;
                            }
                            // Middle of Javadoc block
                            else if (line.startsWith('*')) {
                                commentLines.unshift(line);
                            }
                            // Empty line - continue looking
                            else if (line === '') {
                                continue;
                            }
                            // End search if we hit code
                            else {
                                break;
                            }
                        }

                        if (commentLines.length > 0) {
                            return commentLines.join('\n');
                        }
                    }
                    break;
            }
        } catch (error) {
            console.error('Error extracting docstring:', (error as Error).message);
        }

        return '';
    }

}


