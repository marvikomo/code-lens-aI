export const FunctionQuery = `
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


export const VariableQuery = `
;; Constant declarations
(lexical_declaration
  "const" @const_keyword
  (variable_declarator
    name: (identifier) @name)) @const_declaration

;; Let declarations
(lexical_declaration
  "let" @let_keyword
  (variable_declarator
    name: (identifier) @name)) @let_declaration

;; Var declarations
(variable_declaration
  "var" @var_keyword
  (variable_declarator
    name: (identifier) @name)) @var_declaration

;; Variable with initial value
(variable_declarator
  name: (identifier) @name
  value: (_) @value) @var_with_value

;; Exported variables
(export_statement
  (lexical_declaration
    (variable_declarator
      name: (identifier) @name))) @exported_var

;; Variable references/usage
(identifier) @var_reference
`;

export const ClassQuery = `
;; Class declarations
(class_declaration
  name: (identifier) @name) @class

;; Class expressions
(variable_declarator
  name: (identifier) @name
  value: (class)) @class_expr

;; Method definitions
(method_definition
  name: (property_identifier) @name) @method

;; Constructor method
(method_definition
  name: (property_identifier) @name
  (#eq? @name "constructor")) @constructor

  
`;


export const ImportQuery =`
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

export const ExportQuery = ``

export const CallQuery  = `
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

