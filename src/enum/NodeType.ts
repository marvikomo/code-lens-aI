export enum NodeType {
    // Function types
    FunctionDeclaration = 'function_declaration',   // Standalone function
    MethodDefinition = 'method_definition',         // Method inside a class
  
    // Class-related types
    ClassDeclaration = 'class_declaration',         // Class declaration (e.g., class MyClass)
    Constructor = 'constructor',                     // Constructor method inside a class
  
    // Variable-related types
    VariableDeclaration = 'variable_declaration',   // Variable declaration (e.g., const x = 10)
    VariableDeclarator = 'variable_declarator',     // A specific variable declaration (like const x)
    AssignmentExpression = 'assignment_expression', // Assignment (e.g., x = 10)
  
    // Block-related types
    Block = 'block',                               // Block statement (like if, for, while)
    IfStatement = 'if_statement',                   // If statement
    ForStatement = 'for_statement',                 // For loop
    WhileStatement = 'while_statement',             // While loop
  
    // Import and export types
    ImportStatement = 'import_statement',           // Import statement
    ImportSpecifier = 'import_specifier',           // Import specifier inside the import statement
    ExportStatement = 'export_statement',           // Export statement (e.g., export default)
    
    // Class body-related types
    ClassBody = 'class_body',                       // The body of a class (contains methods, properties)
  
    // Function parameters and related types
    FormalParameters = 'formal_parameters',         // Function or method parameters
    RestPattern = 'rest_pattern',                   // Rest parameters (e.g., ...args)
  
    // Property and member types
    MemberExpression = 'member_expression',         // Member access expression (e.g., obj.property)
    Property = 'property',                          // A property of an object or class
  
    // Destructuring and patterns
    ObjectPattern = 'object_pattern',               // Object destructuring pattern
    ArrayPattern = 'array_pattern',                 // Array destructuring pattern
    ShorthandPropertyIdentifierPattern = 'shorthand_property_identifier_pattern', // For shorthand object properties
  
    // Miscellaneous
    Identifier = 'identifier',                      // An identifier (variable, function, class name)
    Literal = 'literal',                            // A literal value (number, string, etc.)
    ArrowFunction = 'arrow_function',               // Arrow function expression (e.g., () => {})
    ClassExpression = 'class_expression',           // Class expressions (class MyClass {})
    FunctionExpression = 'function_expression',     // Function expressions (function() {})
    Unknown = 'unknown',  
    NewExpression = 'new_expression',
    Class = 'class'                         // Placeholder for unknown node types
  }