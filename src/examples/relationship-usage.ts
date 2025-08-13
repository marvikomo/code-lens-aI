import { RelationshipType, RelationshipMetadata, RelationshipUtils } from '../enum/RelationshipType';
import { DbSchema } from '../db/schema';

/**
 * Example usage of the RelationshipType enum and utilities
 */

// Example 1: Creating relationship metadata
const functionCallRelationship: RelationshipMetadata = {
  type: RelationshipType.CALLS,
  direction: 'outgoing',
  strength: 0.8,
  frequency: 5,
  confidence: 0.95,
  context: 'Direct function call in main execution path',
  lineNumber: 42,
  columnNumber: 15,
  language: 'typescript'
};

// Example 2: Using relationship validation
const isValidCall = RelationshipUtils.isValidRelationship(
  'Function', 
  RelationshipType.CALLS, 
  'Function'
);
console.log(`Function calling function is valid: ${isValidCall}`);

// Example 3: Getting relationship descriptions
const callDescription = RelationshipUtils.getDescription(RelationshipType.CALLS);
console.log(`CALLS relationship: ${callDescription}`);

// Example 4: Finding inverse relationships
const inverseOfCalls = RelationshipUtils.getInverse(RelationshipType.CALLS);
console.log(`Inverse of CALLS: ${inverseOfCalls}`);

// Example 5: Using with existing schema
console.log('Schema relationships:');
Object.entries(DbSchema.relationships).forEach(([key, value]) => {
  console.log(`${key}: ${value} - ${RelationshipUtils.getDescription(value as RelationshipType)}`);
});

// Example 6: Language-specific relationship handling
function createLanguageSpecificRelationship(
  sourceType: string,
  targetType: string,
  language: 'javascript' | 'typescript' | 'python'
): RelationshipMetadata | null {
  
  let relationshipType: RelationshipType;
  
  // Language-specific logic
  switch (language) {
    case 'javascript':
    case 'typescript':
      if (sourceType === 'Function' && targetType === 'Function') {
        relationshipType = RelationshipType.CALLS;
      } else if (sourceType === 'Class' && targetType === 'Class') {
        relationshipType = RelationshipType.EXTENDS;
      } else {
        return null;
      }
      break;
    case 'python':
      if (sourceType === 'function' && targetType === 'function') {
        relationshipType = RelationshipType.CALLS;
      } else if (sourceType === 'class' && targetType === 'class') {
        relationshipType = RelationshipType.EXTENDS;
      } else {
        return null;
      }
      break;
    default:
      return null;
  }

  // Validate the relationship
  if (!RelationshipUtils.isValidRelationship(sourceType, relationshipType, targetType)) {
    console.warn(`Invalid relationship: ${sourceType} -[${relationshipType}]-> ${targetType}`);
    return null;
  }

  return {
    type: relationshipType,
    direction: 'outgoing',
    language,
    confidence: 0.9
  };
}

// Example usage
const jsRelationship = createLanguageSpecificRelationship('Function', 'Function', 'javascript');
console.log('JavaScript function call relationship:', jsRelationship);

export {
  functionCallRelationship,
  createLanguageSpecificRelationship
};
