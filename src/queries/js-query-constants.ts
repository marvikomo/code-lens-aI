export const FunctionQuery = `
;; Named function declarations
(function_declaration
  name: (identifier) @name) @function

;; Exported named functions
(export_statement
  (function_declaration
    name: (identifier) @name)) @function

;; Arrow functions assigned to variables
(variable_declarator
  name: (identifier) @name
  value: (arrow_function)) @function

;; Exported default anonymous function declaration
(export_statement
  (function_declaration) @function) @default_anon

;; Exported default anonymous function expression
(export_statement
  (function_expression) @function)

;; Exported default arrow function
(export_statement
  (arrow_function) @function)

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

;; Object method shorthand
(method_definition
  name: (property_identifier) @name) @method

;; Callback arrow functions
(call_expression
  arguments: (arguments 
    (arrow_function) @function))

`;

export const VariableQuery = `
;; Variable with initial value 
(variable_declarator
  name: (identifier) @name
  value: (_) @value
  ) @var_with_value
  
;; Constant declarations
(lexical_declaration
  "const" @const_keyword
  (variable_declarator
    name: (identifier) @name
     !value
    )) @const_declaration

;; Let declarations
(lexical_declaration
  "let" @let_keyword
  (variable_declarator
    name: (identifier) @name
    !value
    )) @let_declaration

;; Variable declarations (var)
(variable_declaration
  (variable_declarator
    name: (identifier) @name
     !value
    )) @var_declaration

;; Destructuring assignment from object
(variable_declarator
  name: (object_pattern
    (shorthand_property_identifier_pattern) @name)
     value: (_) @value) @destructuring

;; Destructuring assignment from array
(variable_declarator
  name: (array_pattern
    (identifier) @name)
     value: (_) @value
    ) @destructuring

;; Method parameters
(method_definition
  name: (property_identifier) @method_name
  parameters: (formal_parameters
    (identifier) @name)) @var_declaration


;; Object property declarations
(pair
  key: (property_identifier) @name
  value: (_)? @value) @var_declaration

;; Variable initialized with a function
(variable_declarator
  name: (identifier) @name
  value: (function_expression)) @var_with_function

;; Variable initialized with arrow function
(variable_declarator
  name: (identifier) @name
  value: (arrow_function)) @var_with_function

;; Variable initialized with a class
(variable_declarator
  name: (identifier) @name
  value: (class)) @var_with_class

;; Variable initialized with object literal
(variable_declarator
  name: (identifier) @name
  value: (object)) @var_with_object



;; Exported variables without values
(export_statement
  (lexical_declaration
    (variable_declarator
      name: (identifier) @name
        !value
        )
      )) @exported_var

;; Export default variable
(export_statement 
  (identifier) @name
  !value
  ) @exported_var

;; Import declarations
(import_specifier
  name: (identifier) @name) @import_var

;; Default import
(import_clause
  (identifier) @name) @default_import

;; Variable assignment relationships
(assignment_expression
  left: (identifier) @assigned_var
  right: (identifier) @source_var) @assignment

;; Variable assigned to a value
(assignment_expression
  left: (identifier) @assigned_var
  right: (_) @assigned_value) @assignment

;; Member expression (object property access)
(member_expression
  object: (identifier) @object
  property: (property_identifier) @property) @property_access

;; Variable used as function argument
(call_expression
  function: (identifier) @function_name
  arguments: (arguments
    (identifier) @argument)) @function_call

;; Variable references - captures for USED_IN relationship
(identifier) @var_reference
;; Rest parameters
(formal_parameters
  (rest_pattern
    (identifier) @name)) @rest_param
;; Class instance properties
(assignment_expression
  left: (member_expression
    object: (this) @this_object
    property: (property_identifier) @name)) @instance_property

;; Default parameters
(formal_parameters
  (assignment_pattern
    left: (identifier) @name
    right: (_) @default_value)) @default_param

;; Catch clause parameter
(catch_clause
  parameter: (identifier) @name) @catch_param
;; Destructuring with property identifier
(variable_declarator
  name: (object_pattern
    (pair_pattern
      key: (property_identifier)
      value: (identifier) @name))) @destructuring

;; Nested object destructuring
(shorthand_property_identifier_pattern) @name @nested_destructuring
;; For-of loop variables
(for_in_statement
  left: (identifier) @name) @for_of_var

;; For-in loop variables
(for_in_statement 
  left: (identifier) @name) @for_in_var

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

;; capture the class _node_ when it’s on the RHS of a var or export
(variable_declarator
  name: (identifier) @name
  value: (class
    (identifier)?     ; optional inner name
    body: (class_body) @body) @class_expr)

  
`;


export const ImportQuery =`
;; Default imports
(import_statement
  (import_clause
    (identifier) @name)
  source: (string) @source
) @import_statement

;; Namespace imports
(import_statement
  (import_clause
    (namespace_import
      (identifier) @name))
  source: (string) @source
) @import_statement

;; Named imports
(import_statement
  (import_clause
    (named_imports
      (import_specifier
        name: (identifier) @name
        alias: (identifier)? @alias)?))
  source: (string) @source
) @import_statement


; Require statements
(call_expression
  function: (identifier) @name
  arguments: (arguments (string) @source)) @require_statement
`;

export const ExportQuery = `;; Export query for JavaScript/TypeScript

;; Named exports - export { x, y as z }
(export_statement
  (export_clause
    (export_specifier) @export_specifier)
  !source) @named_export

;; Default export - export default x
(export_statement
  "default" @default_keyword
  (_) @default_value
) @default_export

;; Export declaration - export function x() {}, export class X {}, export const x = 1
(export_statement
  declaration: (_) @declaration
) @export_declaration

;; Re-export from - export { x } from 'module'
(export_statement
  source: (string) @source
) @export_from

;; Export all - export * from 'module'
(export_statement
  "*" @star
  source: (string) @source
) @export_all

;; Extract names for more detailed analysis
(export_specifier
  name: (identifier) @export_name
) @export_spec

;; Extract "as" clauses
(export_specifier
  name: (identifier) @original_name
  "as"
  alias: (identifier) @alias_name
) @export_with_alias

;; For declaration exports, extract names
(function_declaration
  name: (identifier) @function_name
) @exported_function

(class_declaration
  name: (identifier) @class_name
) @exported_class

(variable_declaration
  (variable_declarator
    name: (identifier) @variable_name)
) @exported_variable
`

export const CallQuery  = `
;; All function calls with their context in one comprehensive query
;; Direct function calls
(call_expression
  function: (identifier) @callee) @call

;; Method calls with object context
(call_expression
  function: (member_expression
    object: (_) @object
    property: (property_identifier) @method)) @method_call

;; Nested calls (function calls inside function calls)
(call_expression
  function: (_) @outer_function
  arguments: (arguments 
    (call_expression) @nested_call)) @outer_call

;; Immediately Invoked Function Expressions (IIFEs)
(call_expression
  function: [(function_expression) (arrow_function) (parenthesized_expression)] @iife_function) @iife

;; Call expressions in assignment context
(assignment_expression
  right: (call_expression) @call_in_assignment) @assignment

;; Call expressions in variable declarations
(variable_declarator
  value: (call_expression) @call_in_declaration) @declaration

;; Call expressions in return statements
(return_statement
  (call_expression) @call_in_return) @return
`;
