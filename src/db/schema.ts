import { RelationshipType } from '../enum/RelationshipType';

export const DbSchema = {
    constraints: [
      'CREATE CONSTRAINT module_id IF NOT EXISTS FOR (m:Module) REQUIRE m.id IS UNIQUE',
      'CREATE CONSTRAINT function_id IF NOT EXISTS FOR (f:Function) REQUIRE f.id IS UNIQUE',
      'CREATE CONSTRAINT class_id IF NOT EXISTS FOR (c:Class) REQUIRE c.id IS UNIQUE',
      'CREATE CONSTRAINT variable_id IF NOT EXISTS FOR (v:Variable) REQUIRE v.id IS UNIQUE'
    ],
    indices: [
      'CREATE INDEX module_path_idx IF NOT EXISTS FOR (m:Module) ON (m.path)',
      'CREATE INDEX function_name_idx IF NOT EXISTS FOR (f:Function) ON (f.name)',
      'CREATE INDEX class_name_idx IF NOT EXISTS FOR (c:Class) ON (c.name)',
      'CREATE INDEX variable_name_idx IF NOT EXISTS FOR (v:Variable) ON (v.name)'
    ],
    // Defined node labels
    labels: {
      MODULE: 'Module',
      FUNCTION: 'Function',
      CLASS: 'Class',
      VARIABLE: 'Variable',
      IMPORT: 'Import',
      EXPORT: 'Export'
    },
    // Defined relationship types - now using the RelationshipType enum
    relationships: {
      DEFINED_IN: RelationshipType.DEFINED_IN,
      CALLS: RelationshipType.CALLS,
      EXTENDS: RelationshipType.EXTENDS,
      IMPLEMENTS: RelationshipType.IMPLEMENTS,
      HAS_METHOD: RelationshipType.HAS_METHOD,
      HAS_PROPERTY: RelationshipType.HAS_PROPERTY,
      IMPORTS: RelationshipType.IMPORTS,
      EXPORTS: RelationshipType.EXPORTS,
      USES: RelationshipType.USES,
      MODIFIES: RelationshipType.MODIFIES,
      USED_IN: RelationshipType.USED_IN,
      GLOBAL_IN: RelationshipType.GLOBAL_IN,
      LOCAL_TO: RelationshipType.LOCAL_TO,
      LIFETIME_OF: RelationshipType.LIFETIME_OF,
      REFERS_TO: RelationshipType.REFERS_TO,
      DEPENDS_ON: RelationshipType.DEPENDS_ON,
      INITIALIZED_WITH: RelationshipType.INITIALIZED_WITH,
      GLOBAL_TO: RelationshipType.GLOBAL_TO
    }
  };
  