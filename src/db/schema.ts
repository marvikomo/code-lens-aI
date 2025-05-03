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
    // Defined relationship types
    relationships: {
      DEFINED_IN: 'DEFINED_IN',
      CALLS: 'CALLS',
      EXTENDS: 'EXTENDS',
      IMPLEMENTS: 'IMPLEMENTS',
      HAS_METHOD: 'HAS_METHOD',
      HAS_PROPERTY: 'HAS_PROPERTY',
      IMPORTS: 'IMPORTS',
      EXPORTS: 'EXPORTS',
      USES: 'USES',
      MODIFIES: 'MODIFIES',
      USED_IN: 'USED_IN',
      GLOBAL_IN: 'GLOBAL_IN',
      LOCAL_TO: 'LOCAL_TO',
      LIFETIME_OF: 'LIFETIME_OF',
      REFERS_TO: 'REFERS_TO',
      DEPENDS_ON: 'DEPENDS_ON',
      INITIALIZED_WITH: 'INITIALIZED_WITH',
      GLOBAL_TO: 'GLOBAL_TO'
    }
  };
  