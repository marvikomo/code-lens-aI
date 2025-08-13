export enum RelationshipType {
  // Core structural relationships
  DEFINED_IN = 'DEFINED_IN',           // Entity is defined in a module/scope
  CONTAINS = 'CONTAINS',               // Parent contains child element
  BELONGS_TO = 'BELONGS_TO',           // Child belongs to parent element

  // Function/Method relationships
  CALLS = 'CALLS',                     // Function calls another function
  HAS_METHOD = 'HAS_METHOD',           // Class has a method
  OVERRIDES = 'OVERRIDES',             // Method overrides parent method
  RETURNS = 'RETURNS',                 // Function returns a type/value

  // Class relationships
  EXTENDS = 'EXTENDS',                 // Class extends another class
  IMPLEMENTS = 'IMPLEMENTS',           // Class implements an interface
  HAS_PROPERTY = 'HAS_PROPERTY',       // Class has a property
  INSTANTIATES = 'INSTANTIATES',       // Creates instance of a class

  // Variable relationships
  USES = 'USES',                       // General usage relationship
  MODIFIES = 'MODIFIES',               // Modifies a variable/property
  USED_IN = 'USED_IN',                 // Variable is used in a context
  REFERS_TO = 'REFERS_TO',             // References another entity
  INITIALIZED_WITH = 'INITIALIZED_WITH', // Variable initialized with value
  ASSIGNS_TO = 'ASSIGNS_TO',           // Assigns value to variable

  // Scope relationships
  GLOBAL_IN = 'GLOBAL_IN',             // Global variable in module
  LOCAL_TO = 'LOCAL_TO',               // Local variable to function/block
  LIFETIME_OF = 'LIFETIME_OF',         // Variable lifetime scope
  GLOBAL_TO = 'GLOBAL_TO',             // Global accessibility

  // Import/Export relationships
  IMPORTS = 'IMPORTS',                 // Module imports from another
  EXPORTS = 'EXPORTS',                 // Module exports to another
  IMPORTS_FROM = 'IMPORTS_FROM',       // Specific import from module
  EXPORTS_TO = 'EXPORTS_TO',           // Specific export to module
  RE_EXPORTS = 'RE_EXPORTS',           // Re-exports from another module

  // Dependency relationships
  DEPENDS_ON = 'DEPENDS_ON',           // General dependency
  REQUIRES = 'REQUIRES',               // Required dependency
  PROVIDES = 'PROVIDES',               // Provides functionality
  CONSUMES = 'CONSUMES',               // Consumes from another entity

  // Type relationships (for TypeScript/typed languages)
  HAS_TYPE = 'HAS_TYPE',               // Entity has a specific type
  IMPLEMENTS_TYPE = 'IMPLEMENTS_TYPE', // Implements a type interface
  EXTENDS_TYPE = 'EXTENDS_TYPE',       // Extends a type definition
  TYPE_OF = 'TYPE_OF',                 // Type of an entity

  // Control flow relationships
  BRANCHES_TO = 'BRANCHES_TO',         // Control flow branches
  LOOPS_WITH = 'LOOPS_WITH',           // Loop construct relationship
  HANDLES = 'HANDLES',                 // Exception/error handling
  THROWS = 'THROWS',                   // Throws exception

  // Documentation relationships
  DOCUMENTS = 'DOCUMENTS',             // Documentation for entity
  ANNOTATES = 'ANNOTATES',             // Annotation relationship
  DESCRIBES = 'DESCRIBES',             // Description relationship

  // Test relationships
  TESTS = 'TESTS',                     // Test relationship
  MOCKS = 'MOCKS',                     // Mock relationship
  COVERS = 'COVERS',                   // Test coverage relationship

  // Generic relationships
  RELATED_TO = 'RELATED_TO',           // Generic relationship
  SIMILAR_TO = 'SIMILAR_TO',           // Similarity relationship
  UNKNOWN = 'UNKNOWN'                  // Unknown relationship type
}

/**
 * Relationship metadata for enhanced graph analysis
 */
export interface RelationshipMetadata {
  type: RelationshipType;
  direction: 'incoming' | 'outgoing' | 'bidirectional';
  strength?: number;              // Relationship strength (0-1)
  frequency?: number;             // How often this relationship occurs
  confidence?: number;            // Confidence in the relationship (0-1)
  context?: string;              // Additional context
  lineNumber?: number;           // Source line number
  columnNumber?: number;         // Source column number
  language?: string;             // Language-specific context
}

/**
 * Helper functions for relationship management
 */
export class RelationshipUtils {
  /**
   * Get inverse relationship type if applicable
   */
  static getInverse(type: RelationshipType): RelationshipType | null {
    const inverseMap: Partial<Record<RelationshipType, RelationshipType>> = {
      [RelationshipType.CONTAINS]: RelationshipType.BELONGS_TO,
      [RelationshipType.BELONGS_TO]: RelationshipType.CONTAINS,
      [RelationshipType.IMPORTS]: RelationshipType.EXPORTS,
      [RelationshipType.EXPORTS]: RelationshipType.IMPORTS,
      [RelationshipType.CALLS]: RelationshipType.CALLS, // Symmetric
      [RelationshipType.EXTENDS]: RelationshipType.EXTENDS, // Could be "EXTENDED_BY"
      [RelationshipType.IMPLEMENTS]: RelationshipType.IMPLEMENTS, // Could be "IMPLEMENTED_BY"
      [RelationshipType.USES]: RelationshipType.USES, // Symmetric
      [RelationshipType.DEPENDS_ON]: RelationshipType.PROVIDES,
      [RelationshipType.PROVIDES]: RelationshipType.DEPENDS_ON,
      [RelationshipType.TESTS]: RelationshipType.TESTS, // Symmetric
    };

    return inverseMap[type] || null;
  }

  /**
   * Check if relationship type is valid for given node types
   */
  static isValidRelationship(
    sourceType: string, 
    relationshipType: RelationshipType, 
    targetType: string
  ): boolean {
    // Define valid relationship patterns
    const validPatterns: Record<string, Partial<Record<RelationshipType, string[]>>> = {
      'Function': {
        [RelationshipType.CALLS]: ['Function'],
        [RelationshipType.DEFINED_IN]: ['Module', 'Class'],
        [RelationshipType.USES]: ['Variable', 'Class'],
        [RelationshipType.RETURNS]: ['Variable', 'Class'],
      },
      'Class': {
        [RelationshipType.EXTENDS]: ['Class'],
        [RelationshipType.IMPLEMENTS]: ['Interface'],
        [RelationshipType.HAS_METHOD]: ['Function'],
        [RelationshipType.HAS_PROPERTY]: ['Variable'],
        [RelationshipType.DEFINED_IN]: ['Module'],
      },
      'Variable': {
        [RelationshipType.DEFINED_IN]: ['Module', 'Function', 'Class'],
        [RelationshipType.REFERS_TO]: ['Function', 'Class', 'Variable'],
        [RelationshipType.INITIALIZED_WITH]: ['Variable', 'Function', 'Class'],
      },
      'Module': {
        [RelationshipType.IMPORTS]: ['Module'],
        [RelationshipType.EXPORTS]: ['Function', 'Class', 'Variable'],
        [RelationshipType.DEPENDS_ON]: ['Module'],
      }
    };

    const sourcePatterns = validPatterns[sourceType];
    if (!sourcePatterns) return true; // Allow if source type not defined

    const validTargets = sourcePatterns[relationshipType];
    if (!validTargets) return true; // Allow if relationship not defined

    return validTargets.includes(targetType);
  }

  /**
   * Get relationship description for documentation
   */
  static getDescription(type: RelationshipType): string {
    const descriptions: Partial<Record<RelationshipType, string>> = {
      [RelationshipType.DEFINED_IN]: 'Entity is defined within the scope of another entity',
      [RelationshipType.CALLS]: 'Function or method calls another function',
      [RelationshipType.EXTENDS]: 'Class extends functionality from another class',
      [RelationshipType.IMPLEMENTS]: 'Class implements an interface or contract',
      [RelationshipType.IMPORTS]: 'Module imports functionality from another module',
      [RelationshipType.EXPORTS]: 'Module exports functionality to other modules',
      [RelationshipType.USES]: 'Entity uses or references another entity',
      [RelationshipType.DEPENDS_ON]: 'Entity depends on another entity for functionality',
      // Add more as needed...
    };

    return descriptions[type] || `Relationship of type: ${type}`;
  }
}
