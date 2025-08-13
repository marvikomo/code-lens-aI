import * as path from 'path'
import * as fs from 'fs'
import { NodeType } from '../enum/NodeType'
import Parser from 'tree-sitter'
import { Graph } from 'graphlib'

export interface NodeContext {
  nodeType:
    | 'function'
    | 'class'
    | 'method'
    | 'variable'
    | 'property'
    | 'parameter'
    | 'import'
    | 'export'
    | 'unknown'
  scope: string
  parentType?: string
  containerName?: string
  isStatic?: boolean
  isAsync?: boolean
  visibility?: 'public' | 'private' | 'protected'
}

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
      context: null, // Default context if no match is found
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
          result.context = `Variable Declaration: ${
            parent.childForFieldName('name')?.text
          }{}`
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

    if (result.context === null) {
      result.context =
        result.parentNode.startPosition.row == 0 &&
        result.parentNode.startPosition.column == 0
          ? 'Top-Level'
          : 'Unknown Context'
    }

    // Default return value if no specific context is found
    return result
  }

   getNodeType(node: Parser.SyntaxNode): NodeContext['nodeType'] {
    switch (node.type) {
      case 'function_declaration':
        return 'function'
      case 'method_definition':
        return 'method'
      case 'class_declaration':
        return 'class'
      case 'variable_declarator':
      case 'lexical_declaration':
        return 'variable'
      case 'property_definition':
        return 'property'
      case 'formal_parameter':
        return 'parameter'
      case 'import_statement':
      case 'import_specifier':
        return 'import'
      case 'export_statement':
      case 'export_specifier':
        return 'export'
      case 'arrow_function':
        // Check if it's assigned to a variable or property
        const parent = node.parent
        if (parent?.type === 'variable_declarator') {
          return 'function'
        }
        if (parent?.type === 'property_definition') {
          return 'method'
        }
        return 'function'

      case 'function_expression':
        // Similar logic for function expressions
        const funcParent = node.parent
        if (funcParent?.type === 'variable_declarator') {
          return 'function'
        }
        if (funcParent?.type === 'property_definition') {
          return 'method'
        }
        return 'function'
      default:
        return 'unknown'
    }
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

  public resolveImport(
    allFiles: string[],
    currentFile: string,
    importSource: string,
  ): string | null {
    const currentDir = path.dirname(currentFile)
    const resolvedPath = path.resolve(currentDir, importSource)
    console.log('Resolved Path:', resolvedPath)
    // Common extensions to try
    const extensions = ['', '.js', '.jsx', '.ts', '.tsx', '.json']

    for (const ext of extensions) {
      const fullPath = resolvedPath + ext
      if (allFiles.includes(fullPath)) {
        return fullPath
      }
    }

    return null
  }

  /**
   * Find the scope where a node is used
   * @param node The node to find the scope for
   * @returns Scope information
   */
  public findNodeScope(
    node: Parser.SyntaxNode,
  ): {
    type: 'function' | 'method' | 'class' | 'constructor' | 'block' | 'module'
    name: string
    node: Parser.SyntaxNode
    fullContext: string
    startLine: number
    endLine: number
    startColumn: number
    endColumn: number
  } {
    let current = node.parent
    let depth = 0
    const maxDepth = 50

    while (current && depth < maxDepth) {
      // Function declarations
      if (current.type === 'function_declaration') {
        const nameNode = current.childForFieldName('name')
        return {
          type: 'function',
          name: nameNode ? nameNode.text : '<anonymous>',
          node: current,
          fullContext: `Function: ${nameNode ? nameNode.text : '<anonymous>'}`,
          startLine: current.startPosition.row,
          endLine: current.endPosition.row,
          startColumn: current.startPosition.column,
          endColumn: current.endPosition.column,
        }
      }

      // Arrow functions
      if (current.type === 'arrow_function') {
        let funcName = '<anonymous>'
        let parent = current.parent
        if (parent?.type === 'variable_declarator') {
          const nameNode = parent.childForFieldName('name')
          if (nameNode) funcName = nameNode.text
        }
        return {
          type: 'function',
          name: funcName,
          node: current,
          fullContext: `Arrow Function: ${funcName}`,
          startLine: current.startPosition.row,
          endLine: current.endPosition.row,
          startColumn: current.startPosition.column,
          endColumn: current.endPosition.column,
        }
      }

      // Function expressions
      if (current.type === 'function_expression') {
        let funcName = '<anonymous>'
        const nameNode = current.childForFieldName('name')
        if (nameNode) {
          funcName = nameNode.text
        } else {
          let parent = current.parent
          if (parent?.type === 'variable_declarator') {
            const varNameNode = parent.childForFieldName('name')
            if (varNameNode) funcName = varNameNode.text
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
          endColumn: current.endPosition.column,
        }
      }

      // Method definitions
      if (current.type === 'method_definition') {
        const methodName =
          current.childForFieldName('name')?.text || '<anonymous>'

        let className = ''
        let classSearch = current.parent
        while (classSearch) {
          if (
            classSearch.type === 'class_declaration' ||
            classSearch.type === 'class'
          ) {
            const classNameNode = classSearch.childForFieldName('name')
            if (classNameNode) {
              className = classNameNode.text
              break
            }
          }
          classSearch = classSearch.parent
        }

        return {
          type: methodName === 'constructor' ? 'constructor' : 'method',
          name: methodName,
          node: current,
          fullContext: className ? `${className}.${methodName}` : methodName,
          startLine: current.startPosition.row,
          endLine: current.endPosition.row,
          startColumn: current.startPosition.column,
          endColumn: current.endPosition.column,
        }
      }

      // Class declarations
      if (current.type === 'class_declaration' || current.type === 'class') {
        const nameNode = current.childForFieldName('name')
        const className = nameNode ? nameNode.text : '<anonymous>'
        return {
          type: 'class',
          name: className,
          node: current,
          fullContext: `Class: ${className}`,
          startLine: current.startPosition.row,
          endLine: current.endPosition.row,
          startColumn: current.startPosition.column,
          endColumn: current.endPosition.column,
        }
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
          endColumn: current.endPosition.column,
        }
      }

      current = current.parent
      depth++
    }

    // Default to module scope if nothing found
    const rootNode = node.tree.rootNode
    return {
      type: 'module',
      name: 'module',
      node: rootNode,
      fullContext: 'Module/Global Scope',
      startLine: rootNode.startPosition.row,
      endLine: rootNode.endPosition.row,
      startColumn: rootNode.startPosition.column,
      endColumn: rootNode.endPosition.column,
    }
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
    importedName: string,
  ): Array<{
    node: Parser.SyntaxNode
    usage: string
    line: number
    column: number
    context: string
    parentType: string
    scope: {
      node: Parser.SyntaxNode
      type: 'function' | 'method' | 'class' | 'constructor' | 'block' | 'module'
      name: string
      fullContext: string
      startLine: number
      endLine: number
      startColumn: number
      endColumn: number
    }
  }> {
    const references = this.findReferences(tree, importedName)

    const isPartOfImport = (node: Parser.SyntaxNode): boolean => {
      let current = node.parent
      while (current) {
        if (
          current.type === 'import_statement' ||
          current.type === 'import_specifier' ||
          current.type === 'namespace_import' ||
          current.type === 'import_clause' ||
          current.type === 'named_imports' ||
          current.type === 'import'
        ) {
          return true
        }
        current = current.parent
      }
      return false
    }

    const usages = references
      .filter((ref) => !isPartOfImport(ref.node))
      .map((ref) => {
        const context = this.determineNodeContext(ref.node)
        const scope = this.findNodeScope(ref.node)

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
            endColumn: scope.endColumn,
          },
        }
      })

    return usages
  }

  extractRegularFunctionSignature(funcNode: Parser.SyntaxNode): string {
    const nameNode = funcNode.childForFieldName('name')
    const paramsNode = funcNode.childForFieldName('parameters')
    const returnTypeNode = funcNode.childForFieldName('return_type') // For TypeScript

    let signature = 'function '

    if (nameNode) {
      signature += nameNode.text
    }

    if (paramsNode) {
      signature += paramsNode.text
    }

    if (returnTypeNode) {
      signature += ': ' + returnTypeNode.text
    }

    return signature
  }

  extractMethodSignature(funcNode: Parser.SyntaxNode): string {
    const nameNode = funcNode.childForFieldName('name')
    const paramsNode = funcNode.childForFieldName('parameters')
    const returnTypeNode = funcNode.childForFieldName('return_type')

    // Check for modifiers (async, static, etc.)
    const modifiers: string[] = []

    // Check for async
    if (funcNode.text.includes('async ')) {
      modifiers.push('async')
    }

    // Check for static
    if (funcNode.text.includes('static ')) {
      modifiers.push('static')
    }

    // Check for access modifiers (private, public, protected)
    if (funcNode.text.includes('private ')) {
      modifiers.push('private')
    } else if (funcNode.text.includes('protected ')) {
      modifiers.push('protected')
    } else if (funcNode.text.includes('public ')) {
      modifiers.push('public')
    }

    let signature = modifiers.length > 0 ? modifiers.join(' ') + ' ' : ''

    if (nameNode) {
      signature += nameNode.text
    }

    if (paramsNode) {
      signature += paramsNode.text
    }

    if (returnTypeNode) {
      signature += ': ' + returnTypeNode.text
    }

    return signature
  }

  extractArrowFunctionSignature(
    funcNode: Parser.SyntaxNode,
    nameCapture?: Parser.QueryCapture,
  ): string {
    const paramsNode =
      funcNode.childForFieldName('parameters') ||
      funcNode.childForFieldName('parameter')
    const returnTypeNode = funcNode.childForFieldName('return_type')

    let signature = ''

    // If we have a name from variable assignment
    if (nameCapture) {
      signature += nameCapture.node.text + ' = '
    }

    // Check for async
    if (funcNode.text.includes('async ')) {
      signature += 'async '
    }

    if (paramsNode) {
      signature += paramsNode.text
    } else {
      // Single parameter without parentheses
      const firstChild = funcNode.child(0)
      if (firstChild && firstChild.type === 'identifier') {
        signature += firstChild.text
      }
    }

    signature += ' => '

    if (returnTypeNode) {
      signature += returnTypeNode.text
    } else {
      // Try to get return type from body if it's a simple expression
      const bodyNode = funcNode.childForFieldName('body')
      if (bodyNode && bodyNode.type !== 'statement_block') {
        // It's an expression, we could infer type but let's keep it simple
        signature += '...'
      }
    }

    return signature
  }

  extractFunctionExpressionSignature(
    funcNode: Parser.SyntaxNode,
    nameCapture?: Parser.QueryCapture,
  ): string {
    const nameNode = funcNode.childForFieldName('name')
    const paramsNode = funcNode.childForFieldName('parameters')
    const returnTypeNode = funcNode.childForFieldName('return_type')

    let signature = ''

    // If assigned to a variable
    if (nameCapture) {
      signature += nameCapture.node.text + ' = '
    }

    signature += 'function'

    if (nameNode) {
      signature += ' ' + nameNode.text
    }

    if (paramsNode) {
      signature += paramsNode.text
    }

    if (returnTypeNode) {
      signature += ': ' + returnTypeNode.text
    }

    return signature
  }

  extractGeneratorFunctionSignature(funcNode: Parser.SyntaxNode): string {
    const nameNode = funcNode.childForFieldName('name')
    const paramsNode = funcNode.childForFieldName('parameters')
    const returnTypeNode = funcNode.childForFieldName('return_type')

    let signature = 'function* '

    if (nameNode) {
      signature += nameNode.text
    }

    if (paramsNode) {
      signature += paramsNode.text
    }

    if (returnTypeNode) {
      signature += ': ' + returnTypeNode.text
    }

    return signature
  }

  extractFunctionName(
    funcNode: Parser.SyntaxNode,
    nameCapture?: Parser.QueryCapture,
  ): string {
    // First try to get name from the function node itself
    const nameNode = funcNode.childForFieldName('name')
    if (nameNode) {
      return nameNode.text
    }

    // If no name in function node, try from capture (for arrow functions assigned to variables)
    if (nameCapture) {
      return nameCapture.node.text
    }

    // For anonymous functions, generate a name based on context
    if (
      funcNode.type === 'arrow_function' ||
      funcNode.type === 'function_expression'
    ) {
      return `anonymous_${funcNode.startPosition.row + 1}_${
        funcNode.startPosition.column + 1
      }`
    }

    return 'unknown'
  }

  extractFunctionSignature(
    funcNode: Parser.SyntaxNode,
    nameCapture?: Parser.QueryCapture,
  ): string {
    const functionType = funcNode.type

    switch (functionType) {
      case 'function_declaration':
        return this.extractRegularFunctionSignature(funcNode)

      case 'method_definition':
        return this.extractMethodSignature(funcNode)

      case 'arrow_function':
        return this.extractArrowFunctionSignature(funcNode, nameCapture)

      case 'function_expression':
        return this.extractFunctionExpressionSignature(funcNode, nameCapture)

      case 'generator_function_declaration':
        return this.extractGeneratorFunctionSignature(funcNode)

      default:
        // Fallback: try to extract signature from the first line
        const firstLine = funcNode.text.split('\n')[0]
        return firstLine.trim()
    }
  }

  /**
   * Find all function calls within a given function node (extended version)
   * @param functionNode The function node to search within
   * @returns Array of call expression information
   */

  public findFunctionCalls(
    functionNode: Parser.SyntaxNode,
  ): Array<{
    node: Parser.SyntaxNode
    functionName: string
    arguments: Parser.SyntaxNode[]
    line: number
    column: number
    callType:
      | 'function_call'
      | 'method_call'
      | 'constructor_call'
      | 'tagged_template'
      | 'chained_call'
      | 'dynamic_call'
      | 'higher_order_call'
      | 'optional_chaining_call'
    chainDepth?: number
    isAsync?: boolean
  }> {
    const calls: Array<{
      node: Parser.SyntaxNode
      functionName: string
      arguments: Parser.SyntaxNode[]
      line: number
      column: number
      callType:
        | 'function_call'
        | 'method_call'
        | 'constructor_call'
        | 'tagged_template'
        | 'chained_call'
        | 'dynamic_call'
        | 'higher_order_call'
        | 'optional_chaining_call'
      chainDepth?: number
      isAsync?: boolean
    }> = []

    // Get the function body
    let bodyNode: Parser.SyntaxNode | null = null

    if (
      functionNode.type === 'function_declaration' ||
      functionNode.type === 'function_expression' ||
      functionNode.type === 'method_definition'
    ) {
      bodyNode = functionNode.childForFieldName('body')
    } else if (functionNode.type === 'arrow_function') {
      bodyNode = functionNode.childForFieldName('body')
      if (bodyNode && bodyNode.type !== 'statement_block') {
        this.searchForCallsExtended(bodyNode, calls)
        return calls
      }
    }

    if (!bodyNode) {
      return calls
    }

    this.searchForCallsExtended(bodyNode, calls)
    return calls
  }

  /**
   * Enhanced helper method to recursively search for all types of call expressions
   */

  private searchForCallsExtended(
    node: Parser.SyntaxNode,
    calls: Array<{
      node: Parser.SyntaxNode
      functionName: string
      arguments: Parser.SyntaxNode[]
      line: number
      column: number
      callType:
        | 'function_call'
        | 'method_call'
        | 'constructor_call'
        | 'tagged_template'
        | 'chained_call'
        | 'dynamic_call'
        | 'higher_order_call'
        | 'optional_chaining_call'
      chainDepth?: number
      isAsync?: boolean
    }>,
  ): void {
    // Handle regular call expressions
    if (node.type === 'call_expression') {
      const functionField = node.childForFieldName('function')
      const argumentsField = node.childForFieldName('arguments')

      if (functionField) {
        const callInfo = this.analyzeCallExpression(
          node,
          functionField,
          argumentsField,
        )
        if (callInfo) {
          calls.push(callInfo)
        }
      }
    }

    // Handle new expressions (constructor calls)
    else if (node.type === 'new_expression') {
      const constructorField = node.childForFieldName('constructor')
      const argumentsField = node.childForFieldName('arguments')

      if (constructorField) {
        const callInfo = this.analyzeNewExpression(
          node,
          constructorField,
          argumentsField,
        )
        if (callInfo) {
          calls.push(callInfo)
        }
      }
    }

    // Handle tagged template literals
    else if (
      node.type === 'template_string' &&
      node.parent?.type === 'call_expression'
    ) {
      // This is handled in the call_expression case above, but we can add specific logic here if needed
    }

    // Handle await expressions
    else if (node.type === 'await_expression') {
      const expression = node.childForFieldName('argument')
      if (expression && expression.type === 'call_expression') {
        const functionField = expression.childForFieldName('function')
        const argumentsField = expression.childForFieldName('arguments')

        if (functionField) {
          const callInfo = this.analyzeCallExpression(
            expression,
            functionField,
            argumentsField,
          )
          if (callInfo) {
            callInfo.isAsync = true
            calls.push(callInfo)
          }
        }
      }
    }

    // Recursively search all children
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child) {
        this.searchForCallsExtended(child, calls)
      }
    }
  }

  /**
   * Analyze a call expression to determine its type and extract information
   */

  private analyzeCallExpression(
    callNode: Parser.SyntaxNode,
    functionField: Parser.SyntaxNode,
    argumentsField: Parser.SyntaxNode | null,
  ): {
    node: Parser.SyntaxNode
    functionName: string
    arguments: Parser.SyntaxNode[]
    line: number
    column: number
    callType:
      | 'function_call'
      | 'method_call'
      | 'constructor_call'
      | 'tagged_template'
      | 'chained_call'
      | 'dynamic_call'
      | 'higher_order_call'
      | 'optional_chaining_call'
    chainDepth?: number
    isAsync?: boolean
  } | null {
    let functionName = ''
    let callType:
      | 'function_call'
      | 'method_call'
      | 'constructor_call'
      | 'tagged_template'
      | 'chained_call'
      | 'dynamic_call'
      | 'higher_order_call'
      | 'optional_chaining_call' = 'function_call'
    let chainDepth = 0

    // Check if this is a tagged template literal
    if (
      !argumentsField &&
      callNode.childForFieldName('arguments')?.type === 'template_string'
    ) {
      functionName = functionField.text
      callType = 'tagged_template'
    }
    // Simple function call: foo()
    else if (functionField.type === 'identifier') {
      functionName = functionField.text
      callType = 'function_call'
    }
    // Member expression: obj.method() or chained calls
    else if (functionField.type === 'member_expression') {
      const propertyNode = functionField.childForFieldName('property')
      if (propertyNode) {
        functionName = propertyNode.text

        // Check for chaining by analyzing the object
        const objectNode = functionField.childForFieldName('object')
        if (objectNode && this.isCallExpression(objectNode)) {
          callType = 'chained_call'
          chainDepth = this.calculateChainDepth(functionField)
        } else {
          callType = 'method_call'
        }
      }
    }
    // Dynamic/computed property access: obj[methodName]()
    else if (functionField.type === 'subscript_expression') {
      const propertyNode = functionField.childForFieldName('index')
      if (propertyNode) {
        functionName = propertyNode.text
        callType = 'dynamic_call'
      }
    }
    // Higher-order function calls: getFunction()()
    else if (functionField.type === 'call_expression') {
      functionName = this.extractFunctionNameFromCall(functionField)
      callType = 'higher_order_call'
    }
    // Optional chaining: obj?.method?.()
    else if (functionField.type === 'optional_chaining_expression') {
      const propertyNode = functionField.childForFieldName('property')
      if (propertyNode) {
        functionName = propertyNode.text
        callType = 'optional_chaining_call'
      }
    }
    // Complex expressions - fallback
    else {
      functionName = functionField.text
    }

    // Extract arguments
    const argumentNodes: Parser.SyntaxNode[] = []
    if (argumentsField) {
      for (let i = 0; i < argumentsField.namedChildCount; i++) {
        const arg = argumentsField.namedChild(i)
        if (arg) {
          argumentNodes.push(arg)
        }
      }
    }

    return {
      node: callNode,
      functionName,
      arguments: argumentNodes,
      line: callNode.startPosition.row + 1,
      column: callNode.startPosition.column + 1,
      callType,
      chainDepth: chainDepth > 0 ? chainDepth : undefined,
    }
  }

  /**
   * Analyze a new expression
   */

  analyzeNewExpression(
    newNode: Parser.SyntaxNode,
    constructorField: Parser.SyntaxNode,
    argumentsField: Parser.SyntaxNode | null,
  ): {
    node: Parser.SyntaxNode
    functionName: string
    arguments: Parser.SyntaxNode[]
    line: number
    column: number
    callType: 'constructor_call'
  } | null {
    let constructorName = ''

    if (constructorField.type === 'identifier') {
      constructorName = constructorField.text
    } else if (constructorField.type === 'member_expression') {
      const propertyNode = constructorField.childForFieldName('property')
      if (propertyNode) {
        constructorName = propertyNode.text
      }
    } else {
      constructorName = constructorField.text
    }

    // Extract arguments
    const argumentNodes: Parser.SyntaxNode[] = []
    if (argumentsField) {
      for (let i = 0; i < argumentsField.namedChildCount; i++) {
        const arg = argumentsField.namedChild(i)
        if (arg) {
          argumentNodes.push(arg)
        }
      }
    }

    return {
      node: newNode,
      functionName: constructorName,
      arguments: argumentNodes,
      line: newNode.startPosition.row + 1,
      column: newNode.startPosition.column + 1,
      callType: 'constructor_call',
    }
  }

  /**
   * Helper to check if a node is a call expression
   */

  isCallExpression(node: Parser.SyntaxNode): boolean {
    return node.type === 'call_expression'
  }

  /**
   * Calculate the depth of method chaining
   */

  calculateChainDepth(memberExpression: Parser.SyntaxNode): number {
    let depth = 0
    let current = memberExpression.childForFieldName('object')

    while (current) {
      if (current.type === 'call_expression') {
        depth++
        const functionField = current.childForFieldName('function')
        if (functionField && functionField.type === 'member_expression') {
          current = functionField.childForFieldName('object')
        } else {
          break
        }
      } else if (current.type === 'member_expression') {
        current = current.childForFieldName('object')
      } else {
        break
      }
    }

    return depth
  }

  /**
   * Extract function name from a call expression (for higher-order functions)
   */

  extractFunctionNameFromCall(callExpression: Parser.SyntaxNode): string {
    const functionField = callExpression.childForFieldName('function')
    if (functionField) {
      if (functionField.type === 'identifier') {
        return functionField.text + '()'
      } else if (functionField.type === 'member_expression') {
        const propertyNode = functionField.childForFieldName('property')
        if (propertyNode) {
          return propertyNode.text + '()'
        }
      }
    }
    return 'anonymous()'
  }
  public traceCalleeToDefinition(
    tree: Parser.Tree,
    calleeName: string,
    startNode?: Parser.SyntaxNode,
  ): {
    chain: Array<{
      name: string
      node: Parser.SyntaxNode
      type: 'variable' | 'function' | 'import' | 'parameter'
      assignedFrom?: string
    }>
    finalDefinition: {
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
    } | null
  } {
    const chain: Array<any> = []
    let currentName = calleeName
    const visited = new Set<string>()

    while (currentName && !visited.has(currentName)) {
      visited.add(currentName)

      // Find the declaration of the current name
      const declaration = this.findDeclarationNode(tree, currentName)

      if (!declaration) {
        break
      }

      chain.push({
        name: currentName,
        node: declaration.node,
        type: declaration.type,
      })

      // If it's a variable declaration, check what it's assigned to
      if (declaration.type === 'variable') {
        const assignedValue = this.getVariableAssignedValue(
          declaration.parentNode,
        )
        if (assignedValue && assignedValue.type === 'identifier') {
          // It's assigned to another identifier, continue tracing
          currentName = assignedValue.text
          chain[chain.length - 1].assignedFrom = currentName
        } else {
          // It's assigned to a function expression, arrow function, etc.
          break
        }
      } else {
        // Found a function declaration, class, etc. - end of chain
        break
      }
    }

    const finalDefinition =
      chain.length > 0
        ? {
            node: chain[chain.length - 1].node,
            type: chain[chain.length - 1].type,
            parentNode: chain[chain.length - 1].node.parent,
          }
        : null

    return {
      chain,
      finalDefinition,
    }
  }

  private getVariableAssignedValue(
    variableDeclaratorNode: Parser.SyntaxNode | null,
  ): Parser.SyntaxNode | null {
    if (
      !variableDeclaratorNode ||
      variableDeclaratorNode.type !== 'variable_declarator'
    ) {
      return null
    }

    return variableDeclaratorNode.childForFieldName('value')
  }

  public getAllClassMembers(
    classNode: Parser.SyntaxNode,
  ): Array<{
    node: Parser.SyntaxNode
    name: string
    signature: string
    memberType: 'method' | 'field' | 'static_block'
    isStatic: boolean
    isPrivate: boolean
    isAsync: boolean
    isConstructor: boolean
    startLine: number
    endLine: number
  }> {
    const members: Array<{
      node: Parser.SyntaxNode
      name: string
      signature: string
      memberType: 'method' | 'field' | 'static_block'
      isStatic: boolean
      isPrivate: boolean
      isAsync: boolean
      isConstructor: boolean
      startLine: number
      endLine: number
    }> = []

    // Ensure we have a class node
    if (classNode.type !== 'class_declaration' && classNode.type !== 'class') {
      return members
    }

    // Get the class body
    const classBody = classNode.childForFieldName('body')
    if (!classBody || classBody.type !== 'class_body') {
      return members
    }

    // Iterate through all members in the class body
    for (let i = 0; i < classBody.namedChildCount; i++) {
      const member = classBody.namedChild(i)
      if (!member) continue

      // Handle method definitions
      if (member.type === 'method_definition') {
        const nameNode = member.childForFieldName('name')
        if (!nameNode) continue

        const methodName = nameNode.text
        const methodText = member.text

        members.push({
          node: member,
          name: methodName,
          signature: this.extractMethodSignature(member),
          memberType: 'method',
          isStatic: methodText.includes('static'),
          isPrivate:
            nameNode.type === 'private_property_identifier' ||
            methodName.startsWith('#'),
          isAsync: methodText.includes('async'),
          isConstructor: methodName === 'constructor',
          startLine: member.startPosition.row + 1,
          endLine: member.endPosition.row + 1,
        })
      }

      // Handle field definitions
      else if (member.type === 'field_definition') {
        const propertyNode = member.childForFieldName('property')
        if (!propertyNode) continue

        const fieldName = propertyNode.text
        const fieldText = member.text
        const initializerNode = member.child(member.childCount - 1)

        // Determine signature based on initializer type
        let signature = fieldName
        if (
          initializerNode &&
          (initializerNode.type === 'arrow_function' ||
            initializerNode.type === 'function_expression')
        ) {
          signature = this.extractFieldFunctionSignature(
            member,
            initializerNode,
          )
        } else if (initializerNode) {
          signature = `${fieldName} = ${initializerNode.type}`
        }

        members.push({
          node: member,
          name: fieldName,
          signature: signature,
          memberType: 'field',
          isStatic: fieldText.includes('static'),
          isPrivate:
            propertyNode.type === 'private_property_identifier' ||
            fieldName.startsWith('#'),
          isAsync: fieldText.includes('async'),
          isConstructor: false,
          startLine: member.startPosition.row + 1,
          endLine: member.endPosition.row + 1,
        })
      }

      // Handle class static blocks
      else if (member.type === 'class_static_block') {
        members.push({
          node: member,
          name: 'static_block',
          signature: 'static { ... }',
          memberType: 'static_block',
          isStatic: true,
          isPrivate: false,
          isAsync: false,
          isConstructor: false,
          startLine: member.startPosition.row + 1,
          endLine: member.endPosition.row + 1,
        })
      }
    }

    return members
  }

  // Helper method to extract signature from field function assignments
  private extractFieldFunctionSignature(
    fieldNode: Parser.SyntaxNode,
    functionNode: Parser.SyntaxNode,
  ): string {
    const propertyNode = fieldNode.childForFieldName('property')
    const fieldName = propertyNode ? propertyNode.text : 'unknown'

    if (functionNode.type === 'arrow_function') {
      const paramsNode =
        functionNode.childForFieldName('parameters') ||
        functionNode.childForFieldName('parameter')
      let signature = fieldName + ' = '

      if (functionNode.text.includes('async ')) {
        signature += 'async '
      }

      if (paramsNode) {
        signature += paramsNode.text
      } else {
        // Single parameter without parentheses
        const firstChild = functionNode.child(0)
        if (firstChild && firstChild.type === 'identifier') {
          signature += firstChild.text
        } else {
          signature += '()'
        }
      }

      signature += ' => {...}'
      return signature
    }

    return fieldName + ' = function(...)'
  }
}
