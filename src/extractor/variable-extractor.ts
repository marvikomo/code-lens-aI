
import Parser from 'tree-sitter';
import { Extractor } from './extractor';
import { Neo4jClient } from '../db/neo4j-client';
import { DbSchema } from '../db/schema';
import { logger } from '../logger';


export class VariableExtractor extends Extractor {

  constructor(dbClient: Neo4jClient) {
    super(dbClient);
  }

  /**
   * Extract variables from a parsed file and store in Neo4j
   */
  async extract(
    tree: Parser.Tree,
    content: string,
    filePath: string,
    query: Parser.Query
  ): Promise<void> {
    // Ensure module node exists
    await this.ensureModuleNode(filePath);

    // Execute query against AST
    const matches = query.matches(tree.rootNode);

    logger.writeResults(matches, "variable_matches");

    // Filter out variable references to process only declarations
    // Filter out different types of matches
    const declarations = matches.filter(match => {
      const captureNames = match.captures.map(c => c.name);
      return captureNames.some(name =>
        // Standard variable declarations
        name === 'const_declaration' ||
        name === 'let_declaration' ||
        name === 'var_declaration' ||
        name === 'var_with_value' ||
        name === 'exported_var' ||
        // Function-type variables
        name === 'var_with_function' ||
        name === 'var_with_class' ||
        name === 'var_with_object' ||
        // Import declarations
        name === 'import_var' ||
        name === 'default_import' ||
        // Other specialized variables
        name === 'destructuring' ||
        name === 'nested_destructuring' ||
        // Parameter types
        name === 'rest_param' ||
        name === 'default_param' ||
        name === 'catch_param' ||
        // Loop variables
        name === 'for_of_var' ||
        name === 'for_in_var' ||
        // Instance properties
        name === 'instance_property'
      );
    });

    console.log(`Found ${declarations.length} variable declarations in ${filePath}`);

    let c = declarations.map(e => {
      return e.captures.map(e => {

        return {
          name: e.name,
          node: e.node.text,
          line: e.node.startPosition.row + 1,
          end: e.node.endPosition.row + 1,


        }
      })

    })
    logger.writeResults(c, "variable_declarations");

    const references = matches.filter(match => {
      return match.captures.some(c => c.name === 'var_reference');
    });



    // Process in batches
    const batchSize = 20;
    for (let i = 0; i < declarations.length; i += batchSize) {
      const batch = declarations.slice(i, i + batchSize);
      await this.processVariableBatch(batch, content, filePath);
    }

    // Process variable references (USED_IN relationships)
    await this.processVariableReferences(references, filePath);
    console.log(`Extracted ${declarations.length} variables from ${filePath}`);
  }

  /**
   * Process a batch of variable matches
   */
  private async processVariableBatch(
    matches: Parser.QueryMatch[],
    content: string,
    filePath: string
  ): Promise<void> {
    await this.dbClient.runInTransaction(async (session) => {
      for (const match of matches) {
        try {
          // Get variable name capture
          const nameCapture = match.captures.find(c => c.name === 'name');

          if (!nameCapture) continue;



          let p = match.captures.map(e => {
            return {
              name: e.name,
              node: e.node.text,
              line: e.node.startPosition
            }
          })



          logger.writeApendResults(p, "name_var");

          let line = match.captures.some(c => c.node.startPosition.row === 163)

          //  if(line) {
          //   console.log("capp",  match.captures)
          //  }


          // Determine variable type from the match
          const isConst = match.captures.some(c => c.name === 'const_declaration' || c.name === 'const_keyword');
          const isLet = match.captures.some(c => c.name === 'let_declaration' || c.name === 'let_keyword');
          const isVar = match.captures.some(c => c.name === 'var_declaration');
          const isExported = match.captures.some(c => c.name === 'exported_var');
          const isImport = match.captures.some(c => c.name === 'import_var' || c.name === 'default_import');
          const isFunction = match.captures.some(c => c.name === 'var_with_function');
          const isClass = match.captures.some(c => c.name === 'var_with_class');
          const isObject = match.captures.some(c => c.name === 'var_with_object');
          const isDestructured = match.captures.some(c => c.name === 'destructuring' || c.name === 'nested_destructuring');
          const isRestParam = match.captures.some(c => c.name === 'rest_param');
          const isDefaultParam = match.captures.some(c => c.name === 'default_param');
          const isCatchParam = match.captures.some(c => c.name === 'catch_param');
          const isLoopVar = match.captures.some(c => c.name === 'for_of_var' || c.name === 'for_in_var');
          const isInstanceProperty = match.captures.some(c => c.name === 'instance_property' ||
            (c.name === 'property' && match.captures.some(c => c.node.text === 'this')));

          // Determine variable type string
          let varType = 'var'; // default
          if (isConst) varType = 'const';
          else if (isLet) varType = 'let';
          else if (isImport) varType = 'import';
          else if (isFunction) varType = 'function';
          else if (isClass) varType = 'class';
          else if (isObject) varType = 'object';
          else if (isRestParam) varType = 'rest_param';
          else if (isDefaultParam) varType = 'default_param';
          else if (isCatchParam) varType = 'catch_param';
          else if (isLoopVar) varType = 'loop_var';
          else if (isDestructured) varType = 'destructured';
          else if (isInstanceProperty) varType = 'instance';

          // Get the declaration node
          const declarationCapture = match.captures.find(c =>
            c.name === 'const_declaration' ||
            c.name === 'let_declaration' ||
            c.name === 'var_declaration' ||
            c.name === 'var_with_value' ||
            c.name === 'destructuring' ||
            c.name === 'method_declaration' ||
            c.name === 'function_declaration' ||
            c.name === 'arrow_function' ||
            c.name === 'var_with_function' ||
            c.name === 'var_with_class' ||
            c.name === 'var_with_object' ||
            c.name === 'exported_var' ||
            c.name === 'import_var' ||
            c.name === 'default_import' ||
            c.name === 'rest_param' ||
            c.name === 'default_param' ||
            c.name === 'catch_param' ||
            c.name === 'nested_destructuring' ||
            c.name === 'for_of_var' ||
            c.name === 'for_in_var' ||
            c.name === 'instance_property'
          );

          if (!declarationCapture) continue;

          const declarationNode = declarationCapture.node;



          // Get variable details
          const varName = nameCapture.node.text;
          const startPosition = nameCapture.node.startPosition;
          const endPosition = nameCapture.node.endPosition;
          // console.log("path", filePath)
          // console.log("cc", match.captures)
          //console.log("text",  match.captures[0].node.text)
          // Look for value if it exists
          // Look for value if it exists
          let valueCapture = match.captures.find(c => c.name === 'value' || c.name === 'default_value');
          let varValue = '';
          if (valueCapture && valueCapture.node) {
            // Capture value text with some limits on size
            varValue = valueCapture.node.text.length > 200
              ? valueCapture.node.text.substring(0, 200) + '...'
              : valueCapture.node.text;
          }

          if (isInstanceProperty && !valueCapture) {
            // For instance properties like 'this.x = y', get the right side of the assignment
            const assignmentNode = declarationNode;
            const rightNode = assignmentNode.childForFieldName('right');
            if (rightNode) {
                valueCapture = { 
                    name: 'value', 
                    node: rightNode 
                };
            }
          }





          // Determine variable scope
          let varScope = this.determineVariableScope(declarationNode);

          if (isInstanceProperty) {
            varScope = 'class';
          }

          // Try to determine parent context (function, class, etc.)
          let parentContext = this.determineParentContext(declarationNode);
          let fullName = parentContext ? `${parentContext}.${varName}` : varName;

          // If it's an instance property, find the containing class
          if (isInstanceProperty) {
            const className = this.findContainingClassName(declarationNode);
            if (className) {
              fullName = `${className}.${varName}`;
              parentContext = className;
            }
          }

          // Generate unique ID
          const variableId = this.generateNodeId(
            'var',
            varName,
            filePath,
            startPosition.row,
            startPosition.column
          );

          // Create variable node
          await session.run(`
              MERGE (v:${DbSchema.labels.VARIABLE} {id: $variableId})
              ON CREATE SET 
                v.name = $varName,
                v.fullName = $fullName,
                v.lineStart = $lineStart,
                v.lineEnd = $lineEnd,
                v.columnStart = $columnStart,
                v.columnEnd = $columnEnd,
                v.type = $varType,
                v.scope = $varScope,
                v.value = $varValue,
                v.isExported = $isExported,
                v.createdAt = timestamp()
              ON MATCH SET
                v.name = $varName,
                v.fullName = $fullName,
                v.lineStart = $lineStart,
                v.lineEnd = $lineEnd,
                v.columnStart = $columnStart,
                v.columnEnd = $columnEnd,
                v.type = $varType,
                v.scope = $varScope,
                v.value = $varValue,
                v.isExported = $isExported,
                v.updatedAt = timestamp()
            `, {
            variableId,
            varName,
            fullName,
            lineStart: startPosition.row,
            lineEnd: endPosition.row,
            columnStart: startPosition.column,
            columnEnd: endPosition.column,
            varType,
            varScope,
            varValue,
            isExported
          });

          // Create relationship to module
          const moduleId = `mod:${filePath}`;
          await session.run(`
              MATCH (v:${DbSchema.labels.VARIABLE} {id: $variableId})
              MATCH (m:${DbSchema.labels.MODULE} {id: $moduleId})
              MERGE (v)-[:${DbSchema.relationships.DEFINED_IN}]->(m)
            `, { variableId, moduleId });

          // Create scope relationships
          if (varScope === 'module') {
            // For module scope variables, create GLOBAL_TO relationship
            await session.run(`
                  MATCH (v:${DbSchema.labels.VARIABLE} {id: $variableId})
                  MATCH (m:${DbSchema.labels.MODULE} {id: $moduleId})
                  MERGE (v)-[:${DbSchema.relationships.GLOBAL_IN}]->(m)
                `, { variableId, moduleId });
          } else if (varScope === 'function') {
            // For function scope variables
            const parentFuncId = this.findParentFunctionId(declarationNode, filePath);


            if (parentFuncId) {
              await session.run(`
                    MATCH (v:${DbSchema.labels.VARIABLE} {id: $variableId})
                    MATCH (f:${DbSchema.labels.FUNCTION} {id: $parentFuncId})
                    MERGE (v)-[:${DbSchema.relationships.LOCAL_TO}]->(f)
                    MERGE (v)-[:${DbSchema.relationships.LIFETIME_OF}]->(f)
                  `, { variableId, parentFuncId });
            }
          } else if (varScope === 'class') {
            // For class scope variables
            const parentClassId = this.findParentClassId(declarationNode, filePath);
            if (parentClassId) {
              await session.run(`
                    MATCH (v:${DbSchema.labels.VARIABLE} {id: $variableId})
                    MATCH (c:${DbSchema.labels.CLASS} {id: $parentClassId})
                    MERGE (v)-[:${DbSchema.relationships.LOCAL_TO}]->(c)
                    MERGE (v)-[:${DbSchema.relationships.LIFETIME_OF}]->(c)
                  `, { variableId, parentClassId });
            }
            if (isInstanceProperty) {
              const className = this.findContainingClassName(declarationNode);
              if (className) {
                await session.run(`
                  MATCH (c:${DbSchema.labels.CLASS})
                  WHERE c.name = $className AND c.file = $filePath
                  MATCH (v:${DbSchema.labels.VARIABLE} {id: $variableId})
                  MERGE (c)-[:${DbSchema.relationships.HAS_PROPERTY}]->(v)
                  MERGE (v)-[:${DbSchema.relationships.LOCAL_TO}]->(c)
                `, { variableId, className, filePath });
              }
            }
          } else if (varScope === 'block') {
            // For block scope variables - use the containing function if available
            const parentFuncId = this.findParentFunctionId(declarationNode, filePath);
            if (parentFuncId) {
              await session.run(`
                    MATCH (v:${DbSchema.labels.VARIABLE} {id: $variableId})
                    MATCH (f:${DbSchema.labels.FUNCTION} {id: $parentFuncId})
                    MERGE (v)-[:${DbSchema.relationships.LOCAL_TO}]->(f)
                  `, { variableId, parentFuncId });
            } else {
              // Block scope outside of a function (rare but possible)
              await session.run(`
                    MATCH (v:${DbSchema.labels.VARIABLE} {id: $variableId})
                    MATCH (m:${DbSchema.labels.MODULE} {id: $moduleId})
                    MERGE (v)-[:${DbSchema.relationships.LOCAL_TO}]->(m)
                  `, { variableId, moduleId });
            }
          }

          // If variable is initialized with a function, class, or object
          if (isFunction) {

            // Try to find/create a corresponding function node
            if (valueCapture && valueCapture.node) {
              const functionId = this.generateNodeId(
                'func',
                `${varName}_impl`,
                filePath,
                valueCapture.node.startPosition.row,
                valueCapture.node.startPosition.column
              );

              // Create a minimal function node
              await session.run(`
                    MERGE (f:${DbSchema.labels.FUNCTION} {id: $functionId})
                    ON CREATE SET
                      f.name = $funcName,
                      f.lineStart = $lineStart,
                      f.lineEnd = $lineEnd,
                      f.createdAt = timestamp()
                    MERGE (v:${DbSchema.labels.VARIABLE} {id: $variableId})
                    MERGE (v)-[:${DbSchema.relationships.REFERS_TO}]->(f)
                  `, {
                functionId,
                funcName: `${varName}_impl`,
                variableId,
                lineStart: valueCapture.node.startPosition.row,
                lineEnd: valueCapture.node.endPosition.row
              });
            }
          }

          // If variable is initialized with a class
          if (isClass) {
            // Try to find/create a corresponding class node
            if (valueCapture && valueCapture.node) {
              const classId = this.generateNodeId(
                'class',
                `${varName}_class`,
                filePath,
                valueCapture.node.startPosition.row,
                valueCapture.node.startPosition.column
              );

              // Create a minimal class node
              await session.run(`
                    MERGE (c:${DbSchema.labels.CLASS} {id: $classId})
                    ON CREATE SET
                      c.name = $className,
                      c.lineStart = $lineStart,
                      c.lineEnd = $lineEnd,
                      c.createdAt = timestamp()
                    MERGE (v:${DbSchema.labels.VARIABLE} {id: $variableId})
                    MERGE (v)-[:${DbSchema.relationships.REFERS_TO}]->(c)
                  `, {
                classId,
                className: `${varName}_class`,
                variableId,
                lineStart: valueCapture.node.startPosition.row,
                lineEnd: valueCapture.node.endPosition.row
              });
            }
          }

          // Handle imports - they REFER_TO modules
          if (isImport) {
            const sourceModule = this.findImportSource(declarationNode);
            if (sourceModule) {
              // Create a placeholder ID for the imported module
              const importedModuleId = `mod:${sourceModule}`;
              await session.run(`
                    MATCH (v:${DbSchema.labels.VARIABLE} {id: $variableId})
                    MERGE (im:${DbSchema.labels.MODULE} {id: $importedModuleId})
                    ON CREATE SET
                      im.path = $sourceModule,
                      im.createdAt = timestamp()
                    MERGE (v)-[:${DbSchema.relationships.REFERS_TO}]->(im)
                  `, { variableId, importedModuleId, sourceModule });
            }
          }

          // Find dependencies in initialization value
          if (valueCapture && valueCapture.node) {
            const dependencies = this.findVariableDependencies(valueCapture.node, filePath);

            for (const dependencyId of dependencies) {
              await session.run(`
                    MATCH (v:${DbSchema.labels.VARIABLE} {id: $variableId})
                    MATCH (dv:${DbSchema.labels.VARIABLE} {id: $dependencyId})
                    MERGE (v)-[:${DbSchema.relationships.DEPENDS_ON}]->(dv)
                    MERGE (v)-[:${DbSchema.relationships.INITIALIZED_WITH}]->(dv)
                  `, { variableId, dependencyId });
            }
          }


        } catch (error) {
          console.error('Error processing variable match:', error);
          // Continue with the next match
          continue;
        }
      }
    });
  }

  /**
 * Find the containing class name for a node (for instance properties)
 */
private findContainingClassName(node: Parser.SyntaxNode): string | null {
  if (!node) return null;
  
  let current = node;
  let depth = 0;
  const maxDepth = 10; // Prevent infinite loops
  
  while (current && depth < maxDepth) {
    if (current.type === 'method_definition') {
      // We're in a method, now find the class
      const classBodyNode = current.parent;
      if (classBodyNode && classBodyNode.type === 'class_body') {
        const classNode = classBodyNode.parent;
        if (classNode && (classNode.type === 'class_declaration' || classNode.type === 'class')) {
          const nameNode = classNode.childForFieldName('name');
          return nameNode ? nameNode.text : '<anonymous>';
        }
      }
      break;
    }
    
    current = current.parent;
    depth++;
  }
  
  return null;
}

  /**
  * Process variable references to create USED_IN relationships
  */
  private async processVariableReferences(
    references: Parser.QueryMatch[],
    filePath: string
  ): Promise<void> {
    await this.dbClient.runInTransaction(async (session) => {
      for (const match of references) {
        try {


        } catch (error) {
          console.error('Error processing variable reference:', error);
          // Continue with the next match
          continue;
        }
      }
    });
  }

  /**
   * Determine the scope of the variable
   */
  private determineVariableScope(node: Parser.SyntaxNode): string {
    // Find closest scope-defining parent
    let parent = node.parent;
    let depth = 0;
    const maxDepth = 10; // Prevent infinite loops

    while (parent && depth < maxDepth) {
      if (parent.type === 'program') {
        return 'module';
      } else if (parent.type === 'function_declaration' ||
        parent.type === 'function_expression' ||
        parent.type === 'arrow_function' ||
        parent.type === 'method_definition') {
        return 'function';
      } else if (parent.type === 'class_declaration' ||
        parent.type === 'class_expression' ||
        parent.type === 'class' ||
        parent.type === 'class_body') {
        return 'class';
      } else if (parent.type === 'block') {
        // Check if this block belongs to a function, class, or is standalone
        const blockParent = parent.parent;
        if (blockParent) {
          if (blockParent.type.includes('function') ||
            blockParent.type.includes('method')) {
            return 'function';
          } else if (blockParent.type.includes('class')) {
            return 'class';
          } else if (blockParent.type.includes('if') ||
            blockParent.type.includes('for') ||
            blockParent.type.includes('while')) {
            return 'block';
          }
        }
        return 'block';
      }

      parent = parent.parent;
      depth++;
    }

    // Default to module scope if no specific scope found
    return 'module';
  }

  /**
   * Try to determine parent context for a variable (class name, object name, etc.)
   */
  private determineParentContext(node: Parser.SyntaxNode): string {
    let parent = node;
    let depth = 0;
    const maxDepth = 10; // Prevent infinite loops

    while (parent && depth < maxDepth) {
      parent = parent.parent;
      depth++;

      if (!parent) break;

      if (parent.type === 'function_declaration') {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) {
          return nameNode.text;
        }
      } else if (parent.type === 'method_definition') {
        const methodName = parent.childForFieldName('name')?.text || '';
        const classBodyNode = parent.parent;
        if (classBodyNode && classBodyNode.type === 'class_body') {
          const classNode = classBodyNode.parent;
          if (classNode && (classNode.type === 'class_declaration' || classNode.type === 'class')) {
            const className = classNode.childForFieldName('name')?.text || '';
            if (className && methodName) {
              return `${className}.${methodName}`;
            } else if (className) {
              return className;
            }
          }
        }
        return methodName || '';
      } else if (parent.type === 'class_declaration') {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) {
          return nameNode.text;
        }
      }
    }

    return '';
  }

  /**
   * Try to find parent function ID for a variable node
   */
  private findParentFunctionId(node: Parser.SyntaxNode, filePath: string): string | null {
    let parent = node;
    let depth = 0;
    const maxDepth = 10; // Prevent infinite loops


    while (parent && depth < maxDepth) {
      parent = parent.parent;
      depth++;

      if (!parent) break;

      if (parent.type === 'function_declaration' ||
        parent.type === 'function_expression' ||
        parent.type === 'arrow_function' ||
        parent.type === 'method_definition') {

        // Get function name
        const nameNode = parent.childForFieldName('name');
        const funcName = nameNode ? nameNode.text : '<anonymous>';

        // Generate function ID
        return this.generateNodeId(
          'func',
          funcName,
          filePath,
          parent.startPosition.row,
          parent.startPosition.column
        );
      }
    }

    return null;
  }


  private findParentClassId(node: Parser.SyntaxNode, filePath: string): string | null {
    let parent = node;
    let depth = 0;
    const maxDepth = 10; // Prevent infinite loops

    while (parent && depth < maxDepth) {
      parent = parent.parent;
      depth++;

      if (!parent) break;

      if (parent.type === 'class_declaration' ||
        parent.type === 'class_expression' ||
        parent.type === 'class') {

        // Get class name
        const nameNode = parent.childForFieldName('name');
        const className = nameNode ? nameNode.text : '<anonymous>';

        // Generate class ID
        return this.generateNodeId(
          'class',
          className,
          filePath,
          parent.startPosition.row,
          parent.startPosition.column
        );
      }
    }

    return null;
  }

  /**
* Find the source module of an import
*/
  private findImportSource(node: Parser.SyntaxNode): string | null {
    // Look for import declaration parent
    let parent = node;
    let depth = 0;
    const maxDepth = 5;

    while (parent && depth < maxDepth) {
      if (parent.type === 'import_statement') {
        const sourceNode = parent.childForFieldName('source');
        if (sourceNode) {
          // Remove quotes from source string
          let source = sourceNode.text;
          if (source.startsWith('"') || source.startsWith("'")) {
            source = source.substring(1, source.length - 1);
          }
          return source;
        }
        break;
      }
      parent = parent.parent;
      depth++;
    }

    return null;
  }

  /**
 * Find variables that the given expression depends on
 */
  private findVariableDependencies(node: Parser.SyntaxNode, filePath: string): string[] {
    const dependencies: string[] = [];

    // Collect all identifiers in the expression
    this.collectIdentifiers(node, (identNode) => {
      const varName = identNode.text;

      // Skip keywords, built-ins, etc.
      if (this.isKeywordOrBuiltin(varName)) return;

      // Generate a variable ID
      const varId = this.generateNodeId(
        'var',
        varName,
        filePath,
        identNode.startPosition.row,
        identNode.startPosition.column
      );

      dependencies.push(varId);
    });

    return dependencies;
  }

  /**
* Collect all identifier nodes in an expression
*/
  private collectIdentifiers(node: Parser.SyntaxNode, callback: (node: Parser.SyntaxNode) => void): void {
    if (!node) return;

    if (node.type === 'identifier') {
      callback(node);
    }

    // Process children recursively
    for (const child of node.children) {
      this.collectIdentifiers(child, callback);
    }
  }

  /**
* Check if a name is a JavaScript keyword or built-in
*/
  private isKeywordOrBuiltin(name: string): boolean {
    const keywords = [
      'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
      'default', 'delete', 'do', 'else', 'export', 'extends', 'false',
      'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof',
      'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true',
      'try', 'typeof', 'var', 'void', 'while', 'with', 'yield'
    ];

    const builtins = [
      'Object', 'Function', 'Boolean', 'Symbol', 'Error', 'EvalError',
      'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError',
      'Number', 'BigInt', 'Math', 'Date', 'String', 'RegExp', 'Array',
      'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array',
      'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array',
      'Float64Array', 'BigInt64Array', 'BigUint64Array', 'Map', 'Set',
      'WeakMap', 'WeakSet', 'ArrayBuffer', 'SharedArrayBuffer', 'Atomics',
      'DataView', 'JSON', 'Promise', 'Reflect', 'Proxy', 'Intl', 'WebAssembly',
      'console', 'document', 'window', 'global', 'process', 'require'
    ];

    return keywords.includes(name) || builtins.includes(name);
  }

  /**
* Check if a node is or contains a call expression
*/
  private isCallExpression(node: Parser.SyntaxNode): boolean {
    if (!node) return false;

    if (node.type === 'call_expression') {
      return true;
    }

    // Check if any of the children are call expressions
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && this.isCallExpression(child)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Find a call expression within a node
   */
  private findCallExpression(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (!node) return null;

    if (node.type === 'call_expression') {
      return node;
    }

    // Check children for call expressions
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      const result = this.findCallExpression(child);
      if (result) {
        return result;
      }
    }

    return null;
  }



}