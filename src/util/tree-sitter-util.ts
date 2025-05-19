import * as path from 'path';
import * as fs from 'fs';
import { NodeType } from '../enum/NodeType'
import Parser from 'tree-sitter'

export class TreeSitterUtil {
  public determineNodeContext(
    node: Parser.SyntaxNode,
  ): {
    context: string
    node: Parser.SyntaxNode
    name: string
    parentNode: Parser.SyntaxNode | null
    type: NodeType
  } {
    let parent = node
    let depth = 0
    const maxDepth = 10 // Prevent infinite loops

    // This object will store the result
    let result = {
      context: 'Unknown Context', // Default context if no match is found
      node: node,
      name: '',
      parentNode: null,
      type: NodeType.Unknown,
    }

    while (parent && depth < maxDepth) {
      parent = parent.parent
      depth++

      if (!parent) break

      result.parentNode = parent

      // Handle method definitions inside a class (class methods)
      if (parent.type === NodeType.MethodDefinition) {
        const methodName = parent.childForFieldName('name')?.text || ''
        const classBodyNode = parent.parent // Method is inside class_body
        result.type = parent.type
        // Check if the parent of the method is a class body
        if (classBodyNode && classBodyNode.type === 'class_body') {
          const classNode = classBodyNode.parent // Class node is the grandparent of the method
          if (
            classNode &&
            (classNode.type === 'class_declaration' ||
              classNode.type === 'class')
          ) {
            const className = classNode.childForFieldName('name')?.text || ''
            result.context = `Class Method: ${className}.${methodName}`
            result.name = `${className}.${methodName}`
            return result
          }
        }
        result.context = `Method: ${methodName}`
        result.name = methodName
        return result
      }

      // Handle function declarations (e.g., standalone functions)
      else if (parent.type === NodeType.FunctionDeclaration) {
        result.type = parent.type
        const nameNode = parent.childForFieldName('name')
        if (nameNode) {
          result.context = `Function: ${nameNode.text}`
          result.name = nameNode.text
          return result
        }
      }

      // Handle class declarations
      else if (parent.type === NodeType.ClassDeclaration) {
        result.type = parent.type
        const nameNode = parent.childForFieldName('name')
        if (nameNode) {
          result.context = `Class: ${nameNode.text}`
          result.name = nameNode.text
          return result
        }
      }

      // Handle constructors inside classes
      else if (parent.type === NodeType.Constructor) {
        result.type = parent.type
        const classNode = parent.parent // Constructor is inside class body
        if (classNode && classNode.type === NodeType.ClassDeclaration) {
          const className = classNode.childForFieldName('name')?.text || ''
          result.context = `Constructor of Class: ${className}`
          result.name = className
          result.parentNode = classNode // Set the parentNode as the class declaration
          return result
        }
      }

      // Handle variable declarations
      else if (
        parent.type === NodeType.VariableDeclaration ||
        parent.type === NodeType.VariableDeclarator
      ) {
        result.type = parent.type
        if (
          parent.parent &&
          parent.parent.type === NodeType.FunctionDeclaration
        ) {
          result.context = `Variable in Function: ${
            parent.childForFieldName('name')?.text
          }`
          result.name = parent.childForFieldName('name')?.text || ''
          result.parentNode = parent.parent // The function node
          return result
        } else if (
          parent.parent &&
          parent.parent.type === NodeType.ClassDeclaration
        ) {
          result.context = `Variable in Class: ${
            parent.childForFieldName('name')?.text
          }`
          result.name = parent.childForFieldName('name')?.text || ''
          result.parentNode = parent.parent // The class node
          return result
        } else {
          result.context = `Variable declared outside any specific scope: ${
            parent.childForFieldName('name')?.text
          }`
          result.name = parent.childForFieldName('name')?.text || ''
          result.parentNode = parent.parent || null // The parent node (global or otherwise)
          return result
        }
      }

      // Handle block-level contexts (loops, conditionals)
      else if (parent.type === NodeType.Block) {
        result.type = parent.type
        const blockParent = parent.parent
        if (blockParent) {
          if (
            blockParent.type.includes('function') ||
            blockParent.type.includes('method')
          ) {
            result.context = `Block inside function or method`
            result.name = parent.childForFieldName('name')?.text || ''
            return result
          }
        }
      }

      // Handle import declarations (this would be top-level imports or within a module)
      else if (
        parent.type === NodeType.ImportStatement ||
        parent.type === NodeType.ImportSpecifier
      ) {
        result.type = parent.type
        result.context = `Import: ${parent.childForFieldName('source')?.text}`
        result.name = parent.childForFieldName('source')?.text || ''
        return result
      }

      // Handle assignment expressions (where the left side is a variable)
      else if (parent.type === NodeType.AssignmentExpression) {
        result.type = parent.type
        const leftSide = parent.childForFieldName('left')
        if (leftSide && leftSide.type === 'identifier') {
          result.context = `Assignment to Variable: ${leftSide.text}`
          result.name = leftSide.text || ''
          return result
        }
      }

      // Handle other block-level constructs (like loops or conditionals) inside a function or class
      else if (
        parent.type === NodeType.IfStatement ||
        parent.type === NodeType.ForStatement ||
        parent.type === NodeType.WhileStatement
      ) {
        result.type = parent.type
        const conditionType = parent.type
          .replace('_statement', '')
          .toUpperCase() // If, For, While
        result.context = `${conditionType} statement inside function or method`
        result.name = conditionType
        result.parentNode = parent.parent || null // Parent of the statement
        return result
      }
    }

    // Default return value if no specific context is found
    return result
  }

  public getParentNode(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    // Check if the node has a parent
    return node.parent || null
  }

  public findParentOfType(
    node: Parser.SyntaxNode,
    targetType: string,
    maxDepth: number = 5,
  ): string | null {
    let parent = node
    let depth = 0

    // Traverse upwards through the AST to find the parent node with the given type
    while (parent && depth < maxDepth) {
      if (parent.type === targetType) {
        return parent.text || null // Return the text or relevant data from the matched parent node
      }
      parent = parent.parent
      depth++
    }

    return null // Return null if no parent of the target type is found
  }

  public determineVariableScope(node: Parser.SyntaxNode): string {
    // Find closest scope-defining parent
    let parent = node.parent
    let depth = 0
    const maxDepth = 10 // Prevent infinite loops

    while (parent && depth < maxDepth) {
      if (parent.type === 'program') {
        return 'module'
      } else if (
        parent.type === 'function_declaration' ||
        parent.type === 'function_expression' ||
        parent.type === 'arrow_function' ||
        parent.type === 'method_definition'
      ) {
        return 'function'
      } else if (
        parent.type === 'class_declaration' ||
        parent.type === 'class_expression' ||
        parent.type === 'class' ||
        parent.type === 'class_body'
      ) {
        return 'class'
      } else if (parent.type === 'block') {
        // Check if this block belongs to a function, class, or is standalone
        const blockParent = parent.parent
        if (blockParent) {
          if (
            blockParent.type.includes('function') ||
            blockParent.type.includes('method')
          ) {
            return 'function'
          } else if (blockParent.type.includes('class')) {
            return 'class'
          } else if (
            blockParent.type.includes('if') ||
            blockParent.type.includes('for') ||
            blockParent.type.includes('while')
          ) {
            return 'block'
          }
        }
        return 'block'
      }

      parent = parent.parent
      depth++
    }

    // Default to module scope if no specific scope found
    return 'module'
  }

  /**
   * Find all references to an identifier in the tree
   */
  public findReferences(
    tree: Parser.Tree,
    targetName: string,
    declarationNode?: Parser.SyntaxNode,
  ): { node: Parser.SyntaxNode; isDeclaration: boolean; usage: string }[] {
    const references: {
      node: Parser.SyntaxNode
      isDeclaration: boolean
      usage: string
    }[] = []

    // Helper function to recursively search the tree
    const searchNode = (node: Parser.SyntaxNode) => {
      // Check if this node is an identifier with the target name
      if (node.type === 'identifier' && node.text === targetName) {
        // Determine if this is a declaration or reference
        const isDeclaration = this.isDeclarationNode(node)
        // Determine how it's being used
        const usage = this.determineNodeUsage(node)

        references.push({
          node,
          isDeclaration,
          usage,
        })
      }

      // Recursively search all children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child) {
          searchNode(child)
        }
      }
    }

    // Start the search from the root node
    searchNode(tree.rootNode)

    return references
  }

  public findDeclarationNode(
    tree: Parser.Tree,
    targetName: string,
  ): {
    node: Parser.SyntaxNode
    type:
      | 'function'
      | 'class'
      | 'variable'
      | 'import'
      | 'export'
      | 'method'
      | 'parameter'
    parentNode: Parser.SyntaxNode | null
  } | null {
    // Helper function to recursively search the tree
    const searchNode = (
      node: Parser.SyntaxNode,
    ): {
      node: Parser.SyntaxNode
      type:
        | 'function'
        | 'class'
        | 'variable'
        | 'import'
        | 'export'
        | 'method'
        | 'parameter'
      parentNode: Parser.SyntaxNode | null
    } | null => {
      // Check if this node is an identifier with the target name
      if (node.type === 'identifier' && node.text === targetName) {
        const parent = node.parent

        // Check various declaration patterns
        if (parent) {
          let declarationType:
            | 'function'
            | 'class'
            | 'variable'
            | 'import'
            | 'export'
            | 'method'
            | 'parameter'
            | null = null

          // Function declaration
          if (
            parent.type === 'function_declaration' &&
            node === parent.childForFieldName('name')
          ) {
            declarationType = 'function'
          }
          // Variable declaration
          else if (
            parent.type === 'variable_declarator' &&
            node === parent.childForFieldName('name')
          ) {
            declarationType = 'variable'
          }
          // Class declaration
          else if (
            parent.type === 'class_declaration' &&
            node === parent.childForFieldName('name')
          ) {
            declarationType = 'class'
          }
          // Method declaration
          else if (
            parent.type === 'method_definition' &&
            node === parent.childForFieldName('name')
          ) {
            declarationType = 'method'
          }
          // Import declaration - named import
          else if (
            parent.type === 'import_specifier' &&
            (node === parent.childForFieldName('name') ||
              node === parent.childForFieldName('alias'))
          ) {
            declarationType = 'import'
          }
          // Import declaration - namespace import
          else if (parent.type === 'namespace_import') {
            declarationType = 'import'
          }
          // Import declaration - default import
          else if (
            parent.type === 'import_clause' &&
            node === parent.firstChild
          ) {
            declarationType = 'import'
          }
          // Export declaration
          else if (
            parent.type === 'export_specifier' &&
            node === parent.childForFieldName('name')
          ) {
            declarationType = 'export'
          }
          // Parameter declaration
          else if (parent.type === 'formal_parameters') {
            declarationType = 'parameter'
          }

          // If we identified this as a declaration, return it immediately
          if (declarationType) {
            return {
              node,
              type: declarationType,
              parentNode: parent,
            }
          }
        }
      }

      // Recursively search all children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child) {
          const result = searchNode(child)
          if (result) {
            return result // Return the first declaration found
          }
        }
      }

      return null // No declaration found in this branch
    }

    // Start the search from the root node
    return searchNode(tree.rootNode)
  }
  /**
   * Determine if a node is a declaration
   */
  public isDeclarationNode(node: Parser.SyntaxNode): boolean {
    const parent = node.parent
    if (!parent) return false

    // Function declaration
    if (
      parent.type === 'function_declaration' &&
      node === parent.childForFieldName('name')
    ) {
      return true
    }

    // Variable declaration
    if (
      parent.type === 'variable_declarator' &&
      node === parent.childForFieldName('name')
    ) {
      return true
    }

    // Class declaration
    if (
      parent.type === 'class_declaration' &&
      node === parent.childForFieldName('name')
    ) {
      return true
    }

    // Parameter declaration
    if (parent.type === 'formal_parameters') {
      return true
    }

    return false
  }

  /**
   * Determine how a node is being used
   */
  public determineNodeUsage(node: Parser.SyntaxNode): string {
    const parent = node.parent
    if (!parent) return 'unknown'

    // Function call
    if (
      parent.type === 'call_expression' &&
      node === parent.childForFieldName('function')
    ) {
      return 'function_call'
    }

    // Assignment target
    if (
      parent.type === 'assignment_expression' &&
      node === parent.childForFieldName('left')
    ) {
      return 'assignment_target'
    }

    // Assignment source
    if (
      (parent.type === 'assignment_expression' &&
        node === parent.childForFieldName('right')) ||
      (parent.type === 'variable_declarator' &&
        node === parent.childForFieldName('value'))
    ) {
      return 'assignment_source'
    }

    // Function parameter
    if (parent.type === 'formal_parameters') {
      return 'parameter'
    }

    // Property access
    if (
      parent.type === 'member_expression' &&
      node === parent.childForFieldName('object')
    ) {
      return 'object_access'
    }

    // Return value
    if (parent.type === 'return_statement') {
      return 'return_value'
    }

    return 'reference'
  }

  public resolveImport(allFiles: string[], currentFile: string, importSource: string): string | null {
    const currentDir = path.dirname(currentFile);
    const resolvedPath = path.resolve(currentDir, importSource);
     console.log("Resolved Path:", resolvedPath);
    // Common extensions to try
    const extensions = ['', '.js', '.jsx', '.ts', '.tsx', '.json'];
    
    for (const ext of extensions) {
      const fullPath = resolvedPath + ext;
      if (allFiles.includes(fullPath)) {
        return fullPath;
      }
    }
    
    return null;
  }

  /**
 * Find the scope where a node is used
 * @param node The node to find the scope for
 * @returns Scope information
 */
public findNodeScope(node: Parser.SyntaxNode): {
  type: 'function' | 'method' | 'class' | 'constructor' | 'block' | 'module';
  name: string;
  node: Parser.SyntaxNode;
  fullContext: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
} {
  let current = node.parent;
  let depth = 0;
  const maxDepth = 50;
  
  while (current && depth < maxDepth) {
    // Function declarations
    if (current.type === 'function_declaration') {
      const nameNode = current.childForFieldName('name');
      return {
        type: 'function',
        name: nameNode ? nameNode.text : '<anonymous>',
        node: current,
        fullContext: `Function: ${nameNode ? nameNode.text : '<anonymous>'}`,
        startLine: current.startPosition.row,
        endLine: current.endPosition.row,
        startColumn: current.startPosition.column,
        endColumn: current.endPosition.column
      };
    }
    
    // Arrow functions
    if (current.type === 'arrow_function') {
      let funcName = '<anonymous>';
      let parent = current.parent;
      if (parent?.type === 'variable_declarator') {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) funcName = nameNode.text;
      }
      return {
        type: 'function',
        name: funcName,
        node: current,
        fullContext: `Arrow Function: ${funcName}`,
        startLine: current.startPosition.row,
        endLine: current.endPosition.row,
        startColumn: current.startPosition.column,
        endColumn: current.endPosition.column
      };
    }
    
    // Function expressions
    if (current.type === 'function_expression') {
      let funcName = '<anonymous>';
      const nameNode = current.childForFieldName('name');
      if (nameNode) {
        funcName = nameNode.text;
      } else {
        let parent = current.parent;
        if (parent?.type === 'variable_declarator') {
          const varNameNode = parent.childForFieldName('name');
          if (varNameNode) funcName = varNameNode.text;
        }
      }
      return {
        type: 'function',
        name: funcName,
        node: current,
        fullContext: `Function Expression: ${funcName}`,
        startLine: current.startPosition.row,
        endLine: current.endPosition.row,
        startColumn: current.startPosition.column,
        endColumn: current.endPosition.column
      };
    }
    
    // Method definitions
    if (current.type === 'method_definition') {
      const methodName = current.childForFieldName('name')?.text || '<anonymous>';
      
      let className = '';
      let classSearch = current.parent;
      while (classSearch) {
        if (classSearch.type === 'class_declaration' || classSearch.type === 'class') {
          const classNameNode = classSearch.childForFieldName('name');
          if (classNameNode) {
            className = classNameNode.text;
            break;
          }
        }
        classSearch = classSearch.parent;
      }
      
      return {
        type: methodName === 'constructor' ? 'constructor' : 'method',
        name: methodName,
        node: current,
        fullContext: className ? `${className}.${methodName}` : methodName,
        startLine: current.startPosition.row,
        endLine: current.endPosition.row,
        startColumn: current.startPosition.column,
        endColumn: current.endPosition.column
      };
    }
    
    // Class declarations
    if (current.type === 'class_declaration' || current.type === 'class') {
      const nameNode = current.childForFieldName('name');
      const className = nameNode ? nameNode.text : '<anonymous>';
      return {
        type: 'class',
        name: className,
        node: current,
        fullContext: `Class: ${className}`,
        startLine: current.startPosition.row,
        endLine: current.endPosition.row,
        startColumn: current.startPosition.column,
        endColumn: current.endPosition.column
      };
    }
    
    // If we reach the program/module level
    if (current.type === 'program') {
      return {
        type: 'module',
        name: 'module',
        node: current,
        fullContext: 'Module/Global Scope',
        startLine: current.startPosition.row,
        endLine: current.endPosition.row,
        startColumn: current.startPosition.column,
        endColumn: current.endPosition.column
      };
    }
    
    current = current.parent;
    depth++;
  }
  
  // Default to module scope if nothing found
  const rootNode = node.tree.rootNode;
  return {
    type: 'module',
    name: 'module',
    node: rootNode,
    fullContext: 'Module/Global Scope',
    startLine: rootNode.startPosition.row,
    endLine: rootNode.endPosition.row,
    startColumn: rootNode.startPosition.column,
    endColumn: rootNode.endPosition.column
  };
}


  /**
 * Find all usages of an imported identifier in the tree
 * @param tree Parser tree to search in
 * @param importedName The name of the imported identifier to find
 * @param importNode Optional: The import declaration node to exclude from results
 * @returns Array of usage information
 */
  public findImportedIdentifierUsages(
    tree: Parser.Tree,
    importedName: string
  ): Array<{
    node: Parser.SyntaxNode;
    usage: string;
    line: number;
    column: number;
    context: string;
    parentType: string;
    scope: {
      node: Parser.SyntaxNode;
      type: 'function' | 'method' | 'class' | 'constructor' | 'block' | 'module';
      name: string;
      fullContext: string;
      startLine: number;
      endLine: number;
      startColumn: number;
      endColumn: number;
    };
  }> {
    const references = this.findReferences(tree, importedName);
  
    const isPartOfImport = (node: Parser.SyntaxNode): boolean => {
      let current = node.parent;
      while (current) {
        if (
          current.type === 'import_statement' ||
          current.type === 'import_specifier' ||
          current.type === 'namespace_import' ||
          current.type === 'import_clause' ||
          current.type === 'named_imports' ||
          current.type === 'import'
        ) {
          return true;
        }
        current = current.parent;
      }
      return false;
    };
    
    const usages = references
      .filter(ref => !isPartOfImport(ref.node))
      .map(ref => {
        const context = this.determineNodeContext(ref.node);
        const scope = this.findNodeScope(ref.node);
        
        return {
          node: ref.node,
          usage: ref.usage,
          line: ref.node.startPosition.row + 1,
          column: ref.node.startPosition.column + 1,
          context: context.context,
          parentType: ref.node.parent?.type || 'unknown',
          scope: {
            node: scope.node,
            type: scope.type,
            name: scope.name,
            fullContext: scope.fullContext,
            startLine: scope.startLine,
            endLine: scope.endLine,
            startColumn: scope.startColumn,
            endColumn: scope.endColumn
          }
        };
      });
    
    return usages;
  }
  

}
