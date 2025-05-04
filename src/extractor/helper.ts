import { NodeType } from '../enum/NodeType';
import Parser from 'tree-sitter';

export function getSpecifiedParentNode(node: Parser.SyntaxNode, parentType: string): Parser.SyntaxNode | null {
    let parentNode = node.parent;

    while(parentNode && parentNode.type !== parentType) {
        parentNode = parentNode.parent; 
    }

    return parentNode;
}


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

