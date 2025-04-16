import Parser from 'tree-sitter';
import * as fs from 'fs';
import * as path from 'path';
// Update the module declaration to match tree-sitter's Language type
// Import the module directly without type declaration
import JavaScript from 'tree-sitter-javascript';

// Create a type for the language instance
type TreeSitterLanguage = Parser.Language & {
    nodeTypeInfo: any;
};


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

  ;; Exported default anonymous function
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

  ;; Class declarations
  (class_declaration
    name: (identifier) @name) @class

  ;; Class expressions (e.g., const A = class {})
  (variable_declarator
    name: (identifier) @name
    value: (class)) @class

  ;; Method definitions (including static)
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
          ; Direct function calls
          (call_expression
            function: (identifier) @callee) @call
    
          ; Method calls
          (call_expression
            function: (member_expression
              object: (identifier) @object
              property: (property_identifier) @method)) @method_call
        `;

        return new Parser.Query(this.jsParser.getLanguage(), queryString);
    }

    public async analyze(directoryPath: string, options: { ignoreDirs?: string[], ignoreFiles?: string[] } = {}): Promise<void> {
        console.log('Analyzing dir:', directoryPath);

        const files = await this.collectFiles(directoryPath, options);

        await this.performAnalysis(files);

        console.log('parsed files', this.parsedFiles)

        console.log('Files collected:', files);
    }


    private async collectFiles(directory: string, options: { ignoreDirs?: string[], ignoreFiles?: string[] } = {}) {
        console.log('Collecting files in dir1:', directory);
        const files: any = [];

        const ignoredDirs = new Set(['node_modules', '.git', '.github', 'dist', 'build',
            'target', 'bin', 'obj', 'out', '.idea', '.vscode',
            ...(options.ignoreDirs || [])]);

        const ignoredFiles = new Set([
            '.DS_Store', 'Thumbs.db', 'package-lock.json', 'yarn.lock',
            ...(options.ignoreFiles || [])
        ]);

        const collectFilesRecursive = (dir: string): void => {
            console.log('Collecting files in dir:', dir);
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
        

    }

    /**
      * Perform static AST analysis on files
      * @param files Array of file paths
      * @private
      */

    private async performAnalysis(files: string[]): Promise<void> {
        console.log('Starting static AST analysis phase...');

        // Process files in batches to avoid memory issues
        const batchSize = 50;

        for (let i = 0; i < files.length; i += batchSize) {

            let batchs = files.slice(i, i + batchSize);
            // Parse files
            for (const filePath of batchs) {
                console.log('Batch:', filePath);
                await this.parseFile(filePath);
            }

        }



    }

}


