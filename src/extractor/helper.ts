import { NodeType } from '../enum/NodeType';
import Parser from 'tree-sitter';


export function determineNodeContext(node: Parser.SyntaxNode): { context: string, node: Parser.SyntaxNode, name: string, parentNode: Parser.SyntaxNode | null, type: NodeType } {
    let parent = node;
    let depth = 0;
    const maxDepth = 10; // Prevent infinite loops
  
    // This object will store the result
    let result = {
      context: 'Unknown Context',  // Default context if no match is found
      node: node,
      name: '',
      parentNode: null,
      type: NodeType.Unknown
    };
  
    while (parent && depth < maxDepth) {
      parent = parent.parent;
      depth++;
   
      if (!parent) break;

      result.parentNode = parent;
  
      // Handle method definitions inside a class (class methods)
      if (parent.type === NodeType.MethodDefinition) {
        const methodName = parent.childForFieldName('name')?.text || '';
        const classBodyNode = parent.parent;  // Method is inside class_body
        result.type = parent.type;
        // Check if the parent of the method is a class body
        if (classBodyNode && classBodyNode.type === 'class_body') {
          const classNode = classBodyNode.parent;  // Class node is the grandparent of the method
          if (classNode && (classNode.type === 'class_declaration' || classNode.type === 'class')) {
            const className = classNode.childForFieldName('name')?.text || '';
            result.context = `Class Method: ${className}.${methodName}`;
            result.name = `${className}.${methodName}`;
            return result;
          }
        }
        result.context = `Method: ${methodName}`;
        result.name = methodName;
        return result;
      }
  
      // Handle function declarations (e.g., standalone functions)
      else if (parent.type === NodeType.FunctionDeclaration) {
        result.type = parent.type;
        const nameNode = parent.childForFieldName('name');
        if (nameNode) {
          result.context = `Function: ${nameNode.text}`;
          result.name = nameNode.text;
          return result;
        }
      }
  
      // Handle class declarations
      else if (parent.type === NodeType.ClassDeclaration) {
        result.type = parent.type;
        const nameNode = parent.childForFieldName('name');
        if (nameNode) {
          result.context = `Class: ${nameNode.text}`;
          result.name = nameNode.text;
          return result;
        }
      }
  
      // Handle constructors inside classes
      else if (parent.type === NodeType.Constructor) {
        result.type = parent.type;
        const classNode = parent.parent;  // Constructor is inside class body
        if (classNode && classNode.type === NodeType.ClassDeclaration) {
          const className = classNode.childForFieldName('name')?.text || '';
          result.context = `Constructor of Class: ${className}`;
          result.name = className;
          result.parentNode = classNode;  // Set the parentNode as the class declaration
          return result;
        }
      }
  
      // Handle variable declarations
      else if (parent.type === NodeType.VariableDeclaration || parent.type === NodeType.VariableDeclarator) {
        result.type = parent.type;
        if (parent.parent && parent.parent.type === NodeType.FunctionDeclaration) {
          result.context = `Variable in Function: ${parent.childForFieldName('name')?.text}`;
          result.name = parent.childForFieldName('name')?.text || '';
          result.parentNode = parent.parent;  // The function node
          return result;
        } else if (parent.parent && parent.parent.type === NodeType.ClassDeclaration) {
          result.context = `Variable in Class: ${parent.childForFieldName('name')?.text}`;
          result.name = parent.childForFieldName('name')?.text || '';
          result.parentNode = parent.parent;  // The class node
          return result;
        } else {
          result.context = `Variable declared outside any specific scope: ${parent.childForFieldName('name')?.text}`;
          result.name = parent.childForFieldName('name')?.text || '';
          result.parentNode = parent.parent || null;  // The parent node (global or otherwise)
          return result;
        }
      }
  
      // Handle block-level contexts (loops, conditionals)
      else if (parent.type === NodeType.Block) {
        result.type = parent.type;
        const blockParent = parent.parent;
        if (blockParent) {
          if (blockParent.type.includes('function') || blockParent.type.includes('method')) {
            result.context = `Block inside function or method`;
            result.name = parent.childForFieldName('name')?.text || '';
            return result;
          }
        }
      }
  
      // Handle import declarations (this would be top-level imports or within a module)
      else if (parent.type === NodeType.ImportStatement || parent.type === NodeType.ImportSpecifier) {
        result.type = parent.type;
        result.context = `Import: ${parent.childForFieldName('source')?.text}`;
        result.name = parent.childForFieldName('source')?.text || '';
        return result;
      }
  
      // Handle assignment expressions (where the left side is a variable)
      else if (parent.type === NodeType.AssignmentExpression) {
        result.type = parent.type;
        const leftSide = parent.childForFieldName('left');
        if (leftSide && leftSide.type === 'identifier') {
          result.context = `Assignment to Variable: ${leftSide.text}`;
          result.name = leftSide.text || '';
          return result;
        }
      }
  
      // Handle other block-level constructs (like loops or conditionals) inside a function or class
      else if (parent.type === NodeType.IfStatement || parent.type === NodeType.ForStatement || parent.type === NodeType.WhileStatement) {
        result.type = parent.type;
        const conditionType = parent.type.replace('_statement', '').toUpperCase(); // If, For, While
        result.context = `${conditionType} statement inside function or method`;
        result.name = conditionType;
        result.parentNode = parent.parent || null;  // Parent of the statement
        return result;
      }
    }
  
    // Default return value if no specific context is found
    return result;
  }

  export function getParentNode(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    // Check if the node has a parent
    return node.parent || null;
  }

  export function findParentOfType(node: Parser.SyntaxNode, targetType: string, maxDepth: number = 5): string | null {
    let parent = node;
    let depth = 0;
  
    // Traverse upwards through the AST to find the parent node with the given type
    while (parent && depth < maxDepth) {
      if (parent.type === targetType) {
        return parent.text || null;  // Return the text or relevant data from the matched parent node
      }
      parent = parent.parent;
      depth++;
    }
  
    return null;  // Return null if no parent of the target type is found
  }

   export function determineVariableScope(node: Parser.SyntaxNode): string {
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
 * Determine if a node is a declaration
 */
function isDeclarationNode(node: Parser.SyntaxNode): boolean {
  const parent = node.parent;
  if (!parent) return false;
  
  // Function declaration
  if (parent.type === 'function_declaration' && 
      node === parent.childForFieldName('name')) {
    return true;
  }
  
  // Variable declaration
  if (parent.type === 'variable_declarator' && 
      node === parent.childForFieldName('name')) {
    return true;
  }
  
  // Class declaration
  if (parent.type === 'class_declaration' && 
      node === parent.childForFieldName('name')) {
    return true;
  }
  
  // Parameter declaration
  if (parent.type === 'formal_parameters') {
    return true;
  }
  
  return false;
}

/**
 * Determine how a node is being used
 */
function determineNodeUsage(node: Parser.SyntaxNode): string {
  const parent = node.parent;
  if (!parent) return 'unknown';
  
  // Function call
  if (parent.type === 'call_expression' && 
      node === parent.childForFieldName('function')) {
    return 'function_call';
  }
  
  // Assignment target
  if (parent.type === 'assignment_expression' && 
      node === parent.childForFieldName('left')) {
    return 'assignment_target';
  }
  
  // Assignment source
  if (parent.type === 'assignment_expression' && 
      node === parent.childForFieldName('right') ||
      parent.type === 'variable_declarator' && 
      node === parent.childForFieldName('value')) {
    return 'assignment_source';
  }
  
  // Function parameter
  if (parent.type === 'formal_parameters') {
    return 'parameter';
  }
  
  // Property access
  if (parent.type === 'member_expression' && 
      node === parent.childForFieldName('object')) {
    return 'object_access';
  }
  
  // Return value
  if (parent.type === 'return_statement') {
    return 'return_value';
  }
  
  return 'reference';
}

