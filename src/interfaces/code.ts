import Parser from 'tree-sitter';
/**
 * Node in the code graph
 */
interface CodeNode {
    id: string;
    name: string;
    type: 'function' | 'method' | 'class' | 'module' | 'package' | 'variable' | 'export';
    language?: string;
    file?: string;
    docstring?: string;
    className?: string | null;
    range?: {
        start: Parser.Point;
        end: Parser.Point;
    };
    metrics?: CodeMetrics;
    semanticProperties?: SemanticProperties;
}

/**
 * Code metrics for functions, classes, and files
 */
interface CodeMetrics {
    complexity: number; // Cyclomatic complexity
    linesOfCode: number;
    commentPercentage: number;
    parameterCount?: number;
    nestingDepth: number;
    cognitiveComplexity?: number;
}

/**
 * Semantic properties for enhanced analysis
 */
interface SemanticProperties {
    purity: 'pure' | 'impure' | 'unknown'; // Function purity
    sideEffects: boolean;
    mutatesParameters: boolean;
    accessesGlobalState: boolean;
    throwsExceptions: boolean;
    categories: string[]; // Inferred categories like 'data processing', 'UI', etc.
}

/**
 * Class node with enhanced information
 */
interface ClassNode extends CodeNode {
    type: 'class';
    superClass?: string;
    interfaces?: string[];
    methods: string[]; // IDs of method nodes
    properties: VariableNode[];
    constructorParams?: ParameterInfo[];
    exported?: boolean;
}

/**
 * Function/method node
 */
interface FunctionNode extends CodeNode {
    type: 'function' | 'method';
    className?: string | null;
    docstring?: string;
    parameters?: ParameterInfo[];
    returnType?: string;
    complexity?: number;
    async?: boolean;
    generator?: boolean;
    exported?: boolean;
    visibility?: 'public' | 'private' | 'protected';
    // New fields for variables and source code
    variables?: VariableReference[];  // Variables used in the function
    sourceCode?: string;
}

/**
 * Parameter information
 */
interface ParameterInfo {
    name: string;
    type?: string;
    defaultValue?: string;
    optional: boolean;
    rest: boolean; // whether it's a rest parameter (...args)
}

/**
 * Reference to a variable used in a function
 */
interface VariableReference {
    name: string;
    isDeclaration: boolean;  // Whether it's declared in this function
    isModified: boolean;     // Whether it's modified in this function
    references: number;      // Number of times it's referenced
    usageLocations: Parser.Point[];  // Where it's used in the function
}

/**
 * Variable node for tracking variables
 */
interface VariableNode extends CodeNode {
    type: 'variable';
    dataType?: string;
    mutable: boolean; // const vs let/var
    initialValue?: string;
    usages: string[]; // IDs of nodes where this variable is used
    exported?: boolean;
}


/**
* Call information
*/
interface CallInfo {
    from: string;
    to: string;
    node: Parser.SyntaxNode;
    argumentCount: number;
    isDynamic: boolean;
    confidence: number;
    isAsync: boolean;
}

/**
 * Import information
 */
interface ImportInfo {
    source: string;
    specifiers?: string[];
    default?: string;
    isTypeOnly?: boolean; // TypeScript type imports
    importKind: 'static' | 'dynamic'; // static or dynamic import
    range?: {
        start: Parser.Point;
        end: Parser.Point;
    };
}

/**
 * Export information
 */
interface ExportInfo {
    name: string;
    source?: string; // For re-exports
    isDefault: boolean;
    isTypeOnly?: boolean; // TypeScript type exports
    range?: {
        start: Parser.Point;
        end: Parser.Point;
    };
}

/**
 * File-level metrics
 */
interface FileMetrics extends CodeMetrics {
    functionCount: number;
    classCount: number;
    variableCount: number;
    importCount: number;
    exportCount: number;
    dependencyCount: number;
    maintainabilityIndex: number; // A calculated index of maintainability
}

/**
 * Edge in the code graph with enhanced relationship data
 */
interface CodeEdge {
    id: string;
    from: string;
    to: string;
    fromName?: string;
    toName?: string;
    type: 'CALLS' | 'CALLS_DYNAMIC' | 'IMPORTS' | 'EXPORTS' | 'HAS_METHOD' | 'DEFINED_IN' | 'EXTENDS' | 'IMPLEMENTS' | 'USES' | 'MODIFIES';
    source: 'AST-direct' | 'AI-inferred' | 'Static-analysis';
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
 * Language configuration interface with enhanced queries
 */
interface LanguageConfig {
    extensions: string[];
    parser: Parser;
    queries: {
        functions: Parser.Query;
        calls: Parser.Query;
        imports: Parser.Query;
        exports: Parser.Query;
        classes: Parser.Query;
        variables: Parser.Query;
    };
}

export {
    CodeNode,
    CodeMetrics,
    SemanticProperties,
    ClassNode,
    FunctionNode,
    ParameterInfo,
    VariableReference,
    VariableNode,
    CallInfo,
    ImportInfo,
    ExportInfo,
    FileMetrics,
    CodeEdge,
    LanguageConfig
};
