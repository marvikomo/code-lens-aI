
import * as fs from 'fs';
import * as path from 'path';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';

import { Neo4jClient } from '../db/neo4j-client';

// Create a type for the language instance
type TreeSitterLanguage = Parser.Language & {
    nodeTypeInfo: any;
};


import { createHash } from 'crypto';

import { logger } from '../logger';
import { FileInfo, ParsedFile } from '../interfaces/file';
import { CallInfo, CodeEdge, CodeNode, FunctionNode } from '../interfaces/code';
import { TreeSitterParser } from '../tree-sitter-parser';
import { LanguageRegistry } from '../languages/language-registry';
import { createQuery } from '../queries/create-queries';
import { CallQuery, ClassQuery, FunctionQuery, ImportQuery, VariableQuery, ExportQuery } from '../queries/js-query-constants';
import { FunctionExtractor } from '../extractor/function-extractor';
import { Extractor } from '../extractor/extractor';
import { ClassExtractor } from '../extractor/class-extractor';
import { ImportExtractor } from '../extractor/import-extractor';
import { ExportExtractor } from '../extractor/export-extractor';
import { CallExtractor } from '../extractor/call-extractor';




export class CodeAnalyzer {

    private nodes: Map<string, CodeNode>;
    private edges: Map<string, CodeEdge>;
    private files: Map<string, FileInfo>;
    private parsedFiles: Map<string, ParsedFile>;
    private functionExtractor: Extractor;
    private classExtractor: Extractor;
    private importExtractor: Extractor;
    private exportExtractor: Extractor;
    private callExtractor: Extractor;

    private parser: TreeSitterParser;

    private jsParser = new Parser();
    private registry: LanguageRegistry;

    constructor( dbClient: Neo4jClient,
         languageRegistry: LanguageRegistry) {

        this.jsParser.setLanguage(JavaScript as TreeSitterLanguage);

        this.registry = languageRegistry;
        this.registry.register('javascript', {
            extensions: ['.js', '.jsx', '.ts', '.tsx'],
            parser: this.jsParser,
            queries: {
                functions: createQuery(JavaScript as TreeSitterLanguage, FunctionQuery),
                calls: createQuery(JavaScript as TreeSitterLanguage, CallQuery),
                imports: createQuery(JavaScript as TreeSitterLanguage, ImportQuery),
                exports: createQuery(JavaScript as TreeSitterLanguage, ExportQuery),
                classes: createQuery(JavaScript as TreeSitterLanguage, ClassQuery),
                variables: createQuery(JavaScript as TreeSitterLanguage, VariableQuery),
            }
        });

        this.functionExtractor = new FunctionExtractor(dbClient);
        this.classExtractor = new ClassExtractor(dbClient);
        this.importExtractor = new ImportExtractor(dbClient);
        this.exportExtractor = new ExportExtractor(dbClient);
        this.classExtractor = new ClassExtractor(dbClient);
        this.callExtractor = new CallExtractor(dbClient);
        
        this.parser = new TreeSitterParser(this.registry);
        this.nodes = new Map<string, CodeNode>();
        this.edges = new Map<string, CodeEdge>();
        this.files = new Map<string, FileInfo>();
        this.parsedFiles = new Map<string, ParsedFile>();
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
                        const language = this.registry.detect(fullPath);
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
            

            // Analyze parsed files
            for (const filePath of batchs) {
                const { language, tree, content } = await this.parser.parseFile(filePath);
            
                    //const parsedFile = this.parsedFiles.get(filePath)!;

                   const functionQuery = this.registry.get(language).queries.functions;
                   const classQuery = this.registry.get(language).queries.classes;
                   const importQuery = this.registry.get(language).queries.imports;
                   const exportQuery = this.registry.get(language).queries.exports;
                   const callQuery = this.registry.get(language).queries.calls;
                   

                    await this.functionExtractor.extract(tree, content, filePath, functionQuery);

                    await this.classExtractor.extract(tree, content, filePath, classQuery);

                     //await this.importExtractor.extract(tree, content, filePath, importQuery);
                     await this.exportExtractor.extract(tree, content, filePath, exportQuery);

                     await this.callExtractor.extract(tree, content, filePath, callQuery);

                    // Extract function declarations
                    // this.extractFunctions(parsedFile);

                    // // Extract function calls
                    // this.extractCalls(parsedFile);

                
            }

        }

        logger.writeResults(this.parsedFiles, "Log-after-perform-analysis");
        logger.writeResults(this.edges, "Log-edges-after-perform-analysis");



        //  logger.writeResults(this.nodes, "nodes");

    }







    /**
      * Parse a file with the appropriate language parser
      * @param filePath Path to the file
      * @private
      */
    private async parseFile(filePath: string): Promise<void> {



        // Get file metadata
        const stats = fs.statSync(filePath);

        const { language, tree, content } = await this.parser.parseFile(filePath);

        const fileHash = this.calculateFileHash(filePath, content);

        // Store file info
        const fileInfo: FileInfo = {
            path: filePath,
            language,
            content,
            size: stats.size,
            lastModified: stats.mtime,
            hash: fileHash
        };

        this.files.set(filePath, fileInfo);

        // Initialize parsed file structure
        const parsedFile: ParsedFile = {
            path: filePath,
            language,
            tree,
            functions: new Map(),
            classes: new Map(),
            variables: new Map(),
            calls: [],
            imports: [],
            exports: [],
            metrics: null,
            dependsOn: new Set(),
            dependedOnBy: new Set()
        };

        // Store parsed file
        this.parsedFiles.set(filePath, parsedFile);

        // logger.writeResults(this.parsedFiles);


    }

    /**
 * Calculate a hash for a file's content
 * @param filePath Path to the file
 * @param content Optional file content (if already read)
 * @returns Hash string
 */
    private calculateFileHash(filePath: string, content?: string): string {
        try {
            // If content is not provided, read it from the file
            const fileContent = content || fs.readFileSync(filePath, 'utf8');

            // Create hash from content
            const hash = createHash('sha256');
            hash.update(fileContent);
            return hash.digest('hex');
        } catch (error) {
            console.error(`Error calculating hash for ${filePath}:`, (error as Error).message);
            // Return a timestamp-based value as fallback
            return `ts-${Date.now()}`;
        }
    }


    /**
 * Extract functions from a parsed file
 * @param parsedFile Parsed file object
 * @private
 */
    private extractFunctions(parsedFile: ParsedFile): void {
        const { path: filePath, language, tree } = parsedFile;
        const query = this.registry.get(language).queries.functions;
        // Get the file content from your files collection
        const fileInfo = this.files.get(filePath);
        if (!fileInfo) {
            console.error(`File info not found for ${filePath}`);
            return;
        }

        const fileContent = fileInfo.content;

        try {
            const captures = query.captures(tree.rootNode);
            const classMap = new Map<number, string>();

            // First pass - identify classes
            for (const { node, name } of captures) {
                if (name === 'class' || name === 'class_with_extends' || name === 'class_expr') {
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
                if (
                    name === 'function' ||
                    name === 'function_expression' ||
                    name === 'arrow_function' ||
                    name === 'method' ||
                    name === 'constructor' ||
                    name === 'static_method' ||
                    name === 'async_function' ||
                    name === 'async_arrow' ||
                    name === 'async_function_expr'
                ) {
                    let funcName = '';
                    let funcType = name as any;
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
                        // Get the function source code
                        const startOffset = node.startIndex;
                        const endOffset = node.endIndex;
                        const sourceCode = fileContent.substring(startOffset, endOffset);
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
                            sourceCode,
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

            // Now extract Express route handlers (app.get, app.post, etc.)
            this.extractRouteHandlerFunctions(tree.rootNode, parsedFile, fileContent);
        } catch (error) {
            console.error(`Error extracting functions from ${filePath}:`, (error as Error).message);
        }
    }


    /**
 * Extract Express-style route handler functions
 * @param rootNode Root node of the file
 * @param parsedFile Parsed file
 */
    private extractRouteHandlerFunctions(rootNode: Parser.SyntaxNode, parsedFile: ParsedFile, fileContent: string): void {
        const { path: filePath, language } = parsedFile;

        // Helper function to traverse the AST
        const findRouteHandlers = (node: Parser.SyntaxNode) => {
            // Check if it's a method call (like app.get, router.post, etc.)
            if (node.type === 'call_expression') {
                const functionNode = node.childForFieldName('function');

                if (functionNode && functionNode.type === 'member_expression') {
                    const objectNode = functionNode.childForFieldName('object');
                    const propertyNode = functionNode.childForFieldName('property');

                    // Check if it looks like a route definition (app.get, router.post, etc.)
                    if (objectNode && propertyNode &&
                        (objectNode.text === 'app' || objectNode.text === 'router') &&
                        (propertyNode.text === 'get' || propertyNode.text === 'post' ||
                            propertyNode.text === 'put' || propertyNode.text === 'delete' ||
                            propertyNode.text === 'use')) {

                        // Get arguments
                        const argsNode = node.childForFieldName('arguments');
                        if (argsNode) {
                            // Look for route handler function (typically the last argument)
                            let handlerNode: Parser.SyntaxNode | null = null;

                            // Check each argument to find callback function
                            for (let i = 0; i < argsNode.childCount; i++) {
                                const argNode = argsNode.child(i);
                                if (argNode && (
                                    argNode.type === 'arrow_function' ||
                                    argNode.type === 'function_expression' ||
                                    argNode.type === 'function_declaration'
                                )) {
                                    handlerNode = argNode;
                                    break;
                                }
                            }

                            // Found a route handler callback function
                            if (handlerNode) {
                                // Create a unique ID for this route handler
                                let routePath = 'unknown-route';

                                // Try to extract the route path from first argument
                                if (argsNode.childCount > 0) {
                                    const firstArg = argsNode.child(0);
                                    if (firstArg && firstArg.type === 'string') {
                                        routePath = firstArg.text.replace(/['"]/g, '');
                                    }
                                }

                                const handlerName = `${objectNode.text}.${propertyNode.text}('${routePath}')`;
                                const funcId = `${filePath}:${handlerName}`;

                                // Check if handler is async
                                const isAsync = handlerNode.startPosition.column > 0 &&
                                    handlerNode.text.substring(0, 5) === 'async';

                                // Get docstring if available
                                const docstring = this.extractDocstring(handlerNode, language);

                                const sourceCode = fileContent.slice(handlerNode.startIndex, handlerNode.endIndex);
                                // Create function node for this route handler
                                const handlerFunc: FunctionNode = {
                                    id: funcId,
                                    name: handlerName,
                                    type: 'function',
                                    language,
                                    file: filePath,
                                    docstring,
                                    sourceCode,
                                    async: isAsync,
                                    range: {
                                        start: handlerNode.startPosition,
                                        end: handlerNode.endPosition
                                    }
                                };

                                // Add to collections
                                this.nodes.set(funcId, handlerFunc);
                                parsedFile.functions.set(funcId, handlerFunc);
                            }
                        }
                    }
                }
            }

            // Recursively check all children
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (child) {
                    findRouteHandlers(child);
                }
            }
        };

        // Start traversal from root node
        findRouteHandlers(rootNode);
    }


    /**
  * Extract function calls from a parsed file
  * @param parsedFile Parsed file object
  * @private
  */
    private extractCalls(parsedFile: ParsedFile): void {
        const { path: filePath, language, tree, functions } = parsedFile;
        const query = this.registry.get(language).queries.calls;

        try {
            // First process function contexts
            for (const [funcId, func] of functions.entries()) {
                if (!func.range) continue;

                // Get the function node
                const functionNode = tree.rootNode.descendantForPosition(
                    func.range.start,
                    func.range.end
                );

                if (!functionNode) continue;

                // Get captures for this function body
                // Process all call expressions
                this.processCallsInNode(functionNode, funcId, func, parsedFile);
            }

            // Process exported default functions specially
            this.processExportDefaultFunctions(tree.rootNode, parsedFile);

            // Now process calls outside of functions (top-level calls)
            this.processTopLevelCalls(parsedFile);


            // Log processed calls
            console.log(`Extracted ${parsedFile.calls.length} function calls from ${filePath}`);
        } catch (error) {
            console.log("error", error);
            console.error(`Error extracting calls from ${filePath}:`, (error as Error).message);
        }
    }


    /**
 * Process all calls in a node, including nested and chained calls
 * @param node The node to process
 * @param funcId ID of the containing function
 * @param func Function node
 * @param parsedFile Parsed file
 */
    private processCallsInNode(
        node: Parser.SyntaxNode,
        funcId: string,
        func: FunctionNode,
        parsedFile: ParsedFile
    ): void {
        const { path: filePath } = parsedFile;

        // Handle call_expression nodes
        if (node.type === 'call_expression') {
            // Process this call
            this.processCallExpression(node, funcId, func, parsedFile);
        }

        // Visit all children
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) {
                this.processCallsInNode(child, funcId, func, parsedFile);
            }
        }
    }

    /**
     * Process calls inside exported default functions
     * @param rootNode Root node of the file
     * @param parsedFile Parsed file
     */
    private processExportDefaultFunctions(rootNode: Parser.SyntaxNode, parsedFile: ParsedFile): void {
        const { path: filePath } = parsedFile;

        // Find export default statements
        for (let i = 0; i < rootNode.childCount; i++) {
            const child = rootNode.child(i);
            if (!child) continue;

            if (child.type === 'export_statement') {
                // Check if it's a default export
                for (let j = 0; j < child.childCount; j++) {
                    const token = child.child(j);
                    if (token && token.type === 'default') {
                        // Found default export - now look for the function
                        for (let k = 0; k < child.childCount; k++) {
                            const exportedItem = child.child(k);
                            if (!exportedItem) continue;

                            if (exportedItem.type === 'function_declaration' ||
                                exportedItem.type === 'arrow_function' ||
                                exportedItem.type === 'function_expression') {

                                // Create a function ID for this anonymous function
                                const funcId = `${filePath}:default_export_function`;

                                // Create a function node if it doesn't exist
                                if (!parsedFile.functions.has(funcId)) {
                                    const anonymousFunc: FunctionNode = {
                                        id: funcId,
                                        name: 'default',
                                        type: 'function',
                                        language: parsedFile.language,
                                        file: filePath,
                                        exported: true,
                                        range: {
                                            start: exportedItem.startPosition,
                                            end: exportedItem.endPosition
                                        }
                                    };

                                    parsedFile.functions.set(funcId, anonymousFunc);
                                    this.nodes.set(funcId, anonymousFunc);
                                }

                                // Get the function from our map
                                const func = parsedFile.functions.get(funcId)!;

                                // Process calls inside this function
                                this.processCallsInNode(exportedItem, funcId, func, parsedFile);
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Process a call expression node
     * @param callNode Call expression node
     * @param funcId ID of containing function
     * @param func Function node
     * @param parsedFile Parsed file
     */
    private processCallExpression(
        callNode: Parser.SyntaxNode,
        funcId: string,
        func: FunctionNode,
        parsedFile: ParsedFile
    ): void {
        const { path: filePath } = parsedFile;

        // Get the function being called (direct or method)
        const functionNode = callNode.childForFieldName('function');
        if (!functionNode) return;

        let callee = '';
        let isDynamic = false;
        let isChained = false;

        if (functionNode.type === 'identifier') {
            // Direct function call: functionName()
            callee = functionNode.text;
        } else if (functionNode.type === 'member_expression') {
            // Method call: object.method()
            const objectNode = functionNode.childForFieldName('object');
            const propertyNode = functionNode.childForFieldName('property');

            if (objectNode && propertyNode) {
                // Check if the object is itself a call_expression (chained call)
                if (objectNode.type === 'call_expression') {
                    isChained = true;
                    // We'll process the inner call separately as a normal call
                    // Just record this chained call
                    callee = `[chain].${propertyNode.text}`;
                } else {
                    // Normal method call
                    callee = `${objectNode.text}.${propertyNode.text}`;
                }
            }
        } else if (functionNode.type === 'call_expression') {
            // This is a chained call like: func()()
            isChained = true;
            callee = '[chain]()';
        } else {
            // Dynamic calls, other patterns
            isDynamic = true;
            callee = '[dynamic]';
        }

        if (callee) {
            // Create call information
            const callData: CallInfo = {
                from: func.name,
                to: callee,
                node: callNode,
                argumentCount: 0, // You can count arguments here if needed
                isDynamic,
                confidence: isDynamic ? 0.7 : 1.0,
                isAsync: false // You can detect async calls if needed
            };

            // Add to call collection
            parsedFile.calls.push(callData);

            // Generate unique edge ID
            const edgeId = `${funcId}->CALLS->${callee}:${callNode.startPosition.row}:${callNode.startPosition.column}`;

            // Determine edge type
            let edgeType: any = 'CALLS';
            if (isDynamic) edgeType = 'CALLS_DYNAMIC';
            else if (isChained) edgeType = 'CALLS'; // You could use a special type for chains

            // Create the edge
            this.edges.set(edgeId, {
                id: edgeId,
                from: funcId,
                to: callee,
                fromName: func.name,
                toName: callee,
                type: edgeType,
                source: 'AST-direct',
                confidence: isDynamic ? 0.7 : 1.0,
                file: filePath,
                range: {
                    start: callNode.startPosition,
                    end: callNode.endPosition
                }
            });
        }
    }

    /**
 * Process call captures within a function context
 * @param captures Query captures
 * @param funcId Function ID
 * @param func Function node
 * @param parsedFile Parsed file
 */
    private processCallCaptures(
        captures: Parser.QueryCapture[],
        funcId: string,
        func: FunctionNode,
        parsedFile: ParsedFile
    ): void {
        const { path: filePath } = parsedFile;

        // Group captures by parent call node to handle nested structures
        const callNodeMap = new Map<number, Parser.QueryCapture>();
        const callInfoMap = new Map<number, {
            callType: string;
            callee?: string;
            object?: string;
            method?: string;
            isDynamic: boolean;
            isAsync: boolean;
            argumentCount: number;
        }>();

        // First identify all call nodes
        for (const capture of captures) {
            if (
                capture.name === 'call' ||
                capture.name === 'method_call' ||
                capture.name === 'dynamic_method_call' ||
                capture.name === 'optional_method_call' ||
                capture.name === 'iife'
            ) {
                callNodeMap.set(capture.node.id, capture);
            }
        }

        // Process each call node to extract call information
        for (const [nodeId, capture] of callNodeMap.entries()) {
            const callNode = capture.node;
            const callType = capture.name;

            let callee: string | undefined;
            let object: string | undefined;
            let method: string | undefined;
            let isDynamic = callType === 'dynamic_method_call';
            let isAsync = false;
            let argumentCount = 0;

            // Check for direct function calls (identifier)
            if (callType === 'call') {
                for (const subCapture of captures) {
                    if (
                        subCapture.name === 'callee' &&
                        callNode.startIndex <= subCapture.node.startIndex &&
                        subCapture.node.endIndex <= callNode.endIndex
                    ) {
                        callee = subCapture.node.text;
                        break;
                    }
                }
            }

            // Check for method calls (obj.method())
            else if (callType === 'method_call' || callType === 'optional_method_call') {
                for (const subCapture of captures) {
                    if (
                        subCapture.name === 'object' &&
                        callNode.startIndex <= subCapture.node.startIndex &&
                        subCapture.node.endIndex <= callNode.endIndex
                    ) {
                        object = subCapture.node.text;
                    }
                    else if (
                        subCapture.name === 'method' &&
                        callNode.startIndex <= subCapture.node.startIndex &&
                        subCapture.node.endIndex <= callNode.endIndex
                    ) {
                        method = subCapture.node.text;
                    }
                }

                // Combine object and method
                if (object && method) {
                    callee = `${object}.${method}`;
                } else if (object) {
                    callee = `${object}.[computed]`;
                }
            }

            // Check for dynamic method calls (obj[expr]())
            else if (callType === 'dynamic_method_call') {
                for (const subCapture of captures) {
                    if (
                        subCapture.name === 'dynamic_call' &&
                        callNode.startIndex <= subCapture.node.startIndex &&
                        subCapture.node.endIndex <= callNode.endIndex
                    ) {
                        // Try to get the base object
                        const subscriptNode = subCapture.node;
                        const objectNode = subscriptNode.childForFieldName('object');
                        const indexNode = subscriptNode.childForFieldName('index');

                        if (objectNode) {
                            object = objectNode.text;
                            if (indexNode && indexNode.type === 'string') {
                                // If the property access is a string literal, we can be more specific
                                const methodName = indexNode.text.replace(/['"]/g, '');
                                method = methodName;
                                callee = `${object}.${methodName}`;
                                isDynamic = false; // We know exactly what's being called
                            } else {
                                callee = `${object}.[dynamic]`;
                            }
                        } else {
                            callee = '[dynamic_call]';
                        }
                        break;
                    }
                }
            }

            // Check for IIFE (Immediately Invoked Function Expression)
            else if (callType === 'iife') {
                callee = 'IIFE';

                // Check if it's an async IIFE
                for (const subCapture of captures) {
                    if (
                        (subCapture.name === 'iife_func' || subCapture.name === 'iife_arrow') &&
                        callNode.startIndex <= subCapture.node.startIndex &&
                        subCapture.node.endIndex <= callNode.endIndex
                    ) {
                        const funcNode = subCapture.node.childForFieldName('function');
                        if (funcNode && funcNode.text.includes('async')) {
                            isAsync = true;
                        }
                        break;
                    }
                }
            }

            // Check if this is an awaited call
            for (const subCapture of captures) {
                if (
                    subCapture.name === 'await_expr' &&
                    subCapture.node.startIndex <= callNode.startIndex &&
                    callNode.endIndex <= subCapture.node.endIndex
                ) {
                    isAsync = true;
                    break;
                }
            }

            // Count arguments
            for (const subCapture of captures) {
                if (
                    subCapture.name === 'args' &&
                    callNode.startIndex <= subCapture.node.startIndex &&
                    subCapture.node.endIndex <= callNode.endIndex
                ) {
                    // Count non-empty arguments
                    const argsText = subCapture.node.text;
                    if (argsText.trim()) {
                        argumentCount = argsText.split(',').filter(arg => arg.trim()).length;
                    }
                    break;
                }
            }

            // Store the call information
            callInfoMap.set(nodeId, {
                callType,
                callee,
                object,
                method,
                isDynamic,
                isAsync,
                argumentCount
            });
        }

        // Create call edges
        for (const [nodeId, callInfo] of callInfoMap.entries()) {
            const callNode = callNodeMap.get(nodeId)?.node;
            if (!callNode || !callInfo.callee) continue;

            // Create call information
            const callData: CallInfo = {
                from: func.name,
                to: callInfo.callee,
                node: callNode,
                argumentCount: callInfo.argumentCount,
                isDynamic: callInfo.isDynamic,
                confidence: callInfo.isDynamic ? 0.7 : 1.0,
                isAsync: callInfo.isAsync
            };

            // Add to call collection
            parsedFile.calls.push(callData);

            // Generate unique edge ID
            const edgeId = `${funcId}->CALLS->${callInfo.callee}:${callNode.startPosition.row}:${callNode.startPosition.column}`;

            // Determine edge type based on whether it's dynamic
            const edgeType = callInfo.isDynamic ? 'CALLS_DYNAMIC' : 'CALLS';

            // Create the edge
            this.edges.set(edgeId, {
                id: edgeId,
                from: funcId,
                to: callInfo.callee,
                fromName: func.name,
                toName: callInfo.callee,
                type: edgeType,
                source: 'AST-direct',
                confidence: callInfo.isDynamic ? 0.7 : 1.0,
                file: filePath,
                range: {
                    start: callNode.startPosition,
                    end: callNode.endPosition
                }
            });

            // If this calls a known function, try to find it by name
            if (!callInfo.isDynamic) {
                // Simple case: calling a function in the same file
                const targetFuncId = `${filePath}:${callInfo.callee}`;

                if (parsedFile.functions.has(targetFuncId)) {
                    // Update the edge to point to the actual function node
                    const updatedEdgeId = `${funcId}->CALLS->${targetFuncId}`;
                    this.edges.set(updatedEdgeId, {
                        id: updatedEdgeId,
                        from: funcId,
                        to: targetFuncId,
                        fromName: func.name,
                        toName: callInfo.callee,
                        type: 'CALLS',
                        source: 'AST-direct',
                        confidence: 1.0,
                        file: filePath,
                        range: {
                            start: callNode.startPosition,
                            end: callNode.endPosition
                        }
                    });

                    // Remove the previous edge
                    this.edges.delete(edgeId);
                } else {
                    // For method calls, check if it's calling a known class method
                    if (callInfo.object && callInfo.method) {
                        // Try to find any class with this method
                        for (const [classId, classNode] of parsedFile.classes.entries()) {
                            for (const methodId of classNode.methods) {
                                const methodNode = parsedFile.functions.get(methodId);
                                if (methodNode && methodNode.name.endsWith(`.${callInfo.method}`)) {
                                    // Found a potential target method
                                    const updatedEdgeId = `${funcId}->CALLS->${methodId}`;

                                    this.edges.set(updatedEdgeId, {
                                        id: updatedEdgeId,
                                        from: funcId,
                                        to: methodId,
                                        fromName: func.name,
                                        toName: methodNode.name,
                                        type: 'CALLS',
                                        source: 'Static-analysis',
                                        confidence: 0.8, // Lower confidence since it's inferred
                                        file: filePath,
                                        range: {
                                            start: callNode.startPosition,
                                            end: callNode.endPosition
                                        }
                                    });
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Process top-level calls outside of functions
     * @param parsedFile Parsed file
     */
    private processTopLevelCalls(parsedFile: ParsedFile): void {
        const { path: filePath, language, tree } = parsedFile;
        const query = this.registry.get(language).queries.calls;

        try {
            // Create a pseudo-function for top-level code
            const moduleId = `${filePath}:module`;
            const moduleName = path.basename(filePath);

            // Check if we already created this node
            if (!this.nodes.has(moduleId)) {
                const moduleNode: FunctionNode = {
                    id: moduleId,
                    name: moduleName,
                    type: 'function',
                    language,
                    file: filePath,
                    docstring: 'Top-level module code',
                    range: {
                        start: tree.rootNode.startPosition,
                        end: tree.rootNode.endPosition
                    }
                };

                this.nodes.set(moduleId, moduleNode);
                parsedFile.functions.set(moduleId, moduleNode);
            }

            // Find all top-level call expressions
            const captures = query.captures(tree.rootNode);
            const topLevelCallNodes = new Set<number>();

            // Identify top-level calls (not inside functions)
            for (const capture of captures) {
                if (
                    (capture.name === 'call' ||
                        capture.name === 'method_call' ||
                        capture.name === 'dynamic_method_call' ||
                        capture.name === 'optional_method_call' ||
                        capture.name === 'iife')
                ) {
                    // Check if this call is inside a function
                    let isInsideFunction = false;
                    let current = capture.node.parent;

                    while (current && current !== tree.rootNode) {
                        if (
                            current.type === 'function_declaration' ||
                            current.type === 'function_expression' ||
                            current.type === 'arrow_function' ||
                            current.type === 'method_definition'
                        ) {
                            isInsideFunction = true;
                            break;
                        }
                        current = current.parent;
                    }

                    if (!isInsideFunction) {
                        topLevelCallNodes.add(capture.node.id);
                    }
                }
            }

            // Process each top-level call
            for (const nodeId of topLevelCallNodes) {
                // Find the call node with matching ID
                let callNode: Parser.SyntaxNode | null = null;

                // Helper function to find a node by ID
                const findNodeById = (node: Parser.SyntaxNode): Parser.SyntaxNode | null => {
                    if (node.id === nodeId) return node;

                    for (let i = 0; i < node.childCount; i++) {
                        const child = node.child(i);
                        if (child) {
                            const found = findNodeById(child);
                            if (found) return found;
                        }
                    }

                    return null;
                };

                callNode = findNodeById(tree.rootNode);
                if (!callNode) continue;

                // Re-run the query on just this call node to get detailed info
                const callCaptures = query.captures(callNode);

                let callee: string | undefined;
                let object: string | undefined;
                let method: string | undefined;
                let isDynamic = false;
                let isAsync = false;
                let argumentCount = 0;

                // Determine call type
                let callType = '';
                for (const capture of callCaptures) {
                    if (capture.node.id === nodeId) {
                        callType = capture.name;
                        break;
                    }
                }

                // Extract call details based on type
                if (callType === 'call') {
                    for (const capture of callCaptures) {
                        if (capture.name === 'callee') {
                            callee = capture.node.text;
                            break;
                        }
                    }
                } else if (callType === 'method_call' || callType === 'optional_method_call') {
                    for (const capture of callCaptures) {
                        if (capture.name === 'object') {
                            object = capture.node.text;
                        } else if (capture.name === 'method') {
                            method = capture.node.text;
                        }
                    }

                    if (object && method) {
                        callee = `${object}.${method}`;
                    }
                } else if (callType === 'dynamic_method_call') {
                    isDynamic = true;
                    for (const capture of callCaptures) {
                        if (capture.name === 'dynamic_call') {
                            // Try to extract object
                            const subscriptNode = capture.node;
                            const objectNode = subscriptNode.childForFieldName('object');
                            if (objectNode) {
                                object = objectNode.text;
                                callee = `${object}.[dynamic]`;
                            } else {
                                callee = '[dynamic_call]';
                            }
                            break;
                        }
                    }
                } else if (callType === 'iife') {
                    callee = 'IIFE';

                    // Check if it's an async IIFE
                    for (const capture of callCaptures) {
                        if (capture.name === 'iife_func' || capture.name === 'iife_arrow') {
                            const funcNode = capture.node.childForFieldName('function');
                            if (funcNode && funcNode.text.includes('async')) {
                                isAsync = true;
                            }
                            break;
                        }
                    }
                }

                // Check for await
                for (const capture of callCaptures) {
                    if (capture.name === 'await_expr') {
                        isAsync = true;
                        break;
                    }
                }

                // Count arguments
                for (const capture of callCaptures) {
                    if (capture.name === 'args') {
                        const argsText = capture.node.text;
                        if (argsText.trim()) {
                            argumentCount = argsText.split(',').filter(arg => arg.trim()).length;
                        }
                        break;
                    }
                }

                if (callee) {
                    // Create call information
                    const callData: CallInfo = {
                        from: moduleName,
                        to: callee,
                        node: callNode,
                        argumentCount,
                        isDynamic,
                        confidence: isDynamic ? 0.7 : 1.0,
                        isAsync
                    };

                    // Add to call collection
                    parsedFile.calls.push(callData);

                    // Generate unique edge ID
                    const edgeId = `${moduleId}->CALLS->${callee}:${callNode.startPosition.row}:${callNode.startPosition.column}`;

                    // Determine edge type based on whether it's dynamic
                    const edgeType = isDynamic ? 'CALLS_DYNAMIC' : 'CALLS';

                    // Create the edge
                    this.edges.set(edgeId, {
                        id: edgeId,
                        from: moduleId,
                        to: callee,
                        fromName: moduleName,
                        toName: callee,
                        type: edgeType,
                        source: 'AST-direct',
                        confidence: isDynamic ? 0.7 : 1.0,
                        file: filePath,
                        range: {
                            start: callNode.startPosition,
                            end: callNode.endPosition
                        }
                    });

                    // Try to link to actual function
                    const targetFuncId = `${filePath}:${callee}`;
                    if (parsedFile.functions.has(targetFuncId)) {
                        // Update edge to point to actual function
                        const updatedEdgeId = `${moduleId}->CALLS->${targetFuncId}`;
                        this.edges.set(updatedEdgeId, {
                            id: updatedEdgeId,
                            from: moduleId,
                            to: targetFuncId,
                            fromName: moduleName,
                            toName: callee,
                            type: 'CALLS',
                            source: 'AST-direct',
                            confidence: 1.0,
                            file: filePath,
                            range: {
                                start: callNode.startPosition,
                                end: callNode.endPosition
                            }
                        });

                        // Remove previous edge
                        this.edges.delete(edgeId);
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing top-level calls in ${filePath}:`, (error as Error).message);
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
            // Find the file path
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
            const lines = content.split('\n');

            // Get the starting line number of the function/method
            const startLine = node.startPosition.row;

            // Look for JSDoc-style comments
            if (startLine > 0) {
                const commentLines = [];
                let inComment = false;
                let commentStartLine = -1;

                // Look for comments before the function (up to 20 lines back)
                for (let i = startLine - 1; i >= Math.max(0, startLine - 20); i--) {
                    const line = lines[i].trim();

                    // Found the end of a JSDoc block
                    if (line.includes('*/')) {
                        inComment = true;
                        commentLines.unshift(line);
                        continue;
                    }
                    // Middle of JSDoc block
                    else if (inComment || line.startsWith('*')) {
                        inComment = true;
                        commentLines.unshift(line);
                        continue;
                    }
                    // Start of JSDoc block
                    else if (line.startsWith('/**')) {
                        commentLines.unshift(line);
                        commentStartLine = i;
                        break;
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

                // If we found a complete JSDoc comment
                if (commentLines.length > 0 && commentStartLine !== -1) {
                    // Process the comment to extract just the text content
                    return this.processDocstringComment(commentLines.join('\n'));
                }
            }

            // Check for single-line comments immediately preceding the function
            if (startLine > 0) {
                const lineComments = [];

                // Look for consecutive single-line comments
                for (let i = startLine - 1; i >= Math.max(0, startLine - 10); i--) {
                    const line = lines[i].trim();

                    if (line.startsWith('//')) {
                        lineComments.unshift(line.substring(2).trim());
                    } else if (line === '') {
                        // Skip empty lines
                        continue;
                    } else {
                        // Break on non-comment code
                        break;
                    }
                }

                if (lineComments.length > 0) {
                    return lineComments.join('\n');
                }
            }

            // For arrow functions or function expressions in variable declarations,
            // check for comments above the parent statement
            if (node.type === 'arrow_function' || node.type === 'function_expression') {
                let parent = node.parent;
                while (parent && parent.type !== 'program' &&
                    parent.type !== 'variable_declaration' &&
                    parent.type !== 'lexical_declaration' &&
                    parent.type !== 'function_declaration') {
                    parent = parent.parent;
                }

                if (parent && parent.startPosition.row > 0) {
                    const parentStart = parent.startPosition.row;
                    const commentLines = [];
                    let inComment = false;

                    // Look for comments before the parent statement
                    for (let i = parentStart - 1; i >= Math.max(0, parentStart - 20); i--) {
                        const line = lines[i].trim();

                        // Found the end of a JSDoc block
                        if (line.includes('*/')) {
                            inComment = true;
                            commentLines.unshift(line);
                            continue;
                        }
                        // Middle of JSDoc block
                        else if (inComment || line.startsWith('*')) {
                            inComment = true;
                            commentLines.unshift(line);
                            continue;
                        }
                        // Start of JSDoc block
                        else if (line.startsWith('/**')) {
                            commentLines.unshift(line);
                            break;
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
                        return this.processDocstringComment(commentLines.join('\n'));
                    }
                }
            }
        } catch (error) {
            console.error('Error extracting docstring:', (error as Error).message);
        }

        return '';
    }
    /**
     * Process a JSDoc-style comment to extract clean docstring text
     * @param comment Raw comment with asterisks and slashes
     * @returns Cleaned docstring text
     */
    private processDocstringComment(comment: string): string {
        // Remove the comment start and end markers
        let text = comment.replace(/\/\*\*|\*\//g, '');

        // Remove leading asterisks and spaces from each line
        const lines = text.split('\n');
        const cleanedLines = lines.map(line => {
            // Remove leading asterisks and whitespace
            return line.replace(/^\s*\*\s?/, '');
        });

        // Join lines and trim
        return cleanedLines.join('\n').trim();
    }


}


