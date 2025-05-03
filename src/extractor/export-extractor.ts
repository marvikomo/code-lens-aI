import Parser from 'tree-sitter';
import { Extractor } from "./extractor";
import { DbSchema } from '../db/schema';
import { Neo4jClient } from "../db/neo4j-client";
import { logger } from '../logger';

export class ExportExtractor extends Extractor {

  constructor(dbClient: Neo4jClient) {
    super(dbClient);
  }

  /**
   * Extract exports from a parsed file and store in Neo4j
   */
  async extract(tree: Parser.Tree, content: string, filePath: string, query: Parser.Query): Promise<void> {
    // Ensure module node exists
    await this.ensureModuleNode(filePath);

    // Create export query
    const matches = query.matches(tree.rootNode);
    // Extract export information to simple objects
    const exports = matches.flatMap(match => {
      let exportType = 'unknown';
      let exportNode = null;
      let sourceNode = null;
    

      // Determine export type and get nodes
      if (match.captures.some(c => c.name === 'named_export')) {
        exportType = 'named';
        exportNode = match.captures.find(c => c.name === 'named_export')?.node;
        // Check if this is actually a re-export
        sourceNode = match.captures.find(c => c.name === 'source')?.node;
        if (sourceNode) {
          // This is a named re-export
          exportType = 're-export';
        }
      } else if (match.captures.some(c => c.name === 'default_export')) {
        exportType = 'default';
        exportNode = match.captures.find(c => c.name === 'default_export')?.node;
      } else if (match.captures.some(c => c.name === 'export_from')) {
        exportType = 're-export';
        exportNode = match.captures.find(c => c.name === 'export_from')?.node;
        sourceNode = match.captures.find(c => c.name === 'source')?.node;
        if (sourceNode) {
          // This is a named re-export
          exportType = 're-export';
        }
      } else if (match.captures.some(c => c.name === 'export_all')) {
        exportType = 'export-all';
        exportNode = match.captures.find(c => c.name === 'export_all')?.node;
        sourceNode = match.captures.find(c => c.name === 'source')?.node;
      } else if (match.captures.some(c => c.name === 'export_declaration')) {
        exportType = 'declaration';
        exportNode = match.captures.find(c => c.name === 'export_declaration')?.node;
      }

      if (!exportNode) return [];

      // Basic export data
      const baseExportData = {
        id: `export:${filePath}:${exportNode.startPosition.row}:${exportNode.startPosition.column}`,
        moduleId: `mod:${filePath}`,
        type: exportType,
        line: exportNode.startPosition.row,
        column: exportNode.startPosition.column,
        sourceText: sourceNode ? sourceNode.text.replace(/['"]/g, '') : null,
        text: exportNode.text
      };

     // logger.writeResults(baseExportData, "baseExportData");

      // Results array with proper typing
      const results: Array<{
        id: string;
        moduleId: string;
        type: string;
        line: number;
        column: number;
        sourceText: string | null;
        text: string;
        name: string;
        alias?: string;
        isDefault?: boolean;
        isNamespaceExport?: boolean;
        isReExport?: boolean;
        isDeclaration?: boolean;
      }> = [];

      // For named exports, extract specifiers
      if (exportType === 'named') {
       
      //    if(match.captures[0].node.startPosition.row == 82) {
      //   console.log("mx", match.captures[0].node.children[3].text)
      //   console.log("export type", exportType)
      //   console.log("export node", sourceNode)
      // }
        const exportNames = this.extractExportSpecifiers(exportNode);

        // Create an export object for each name
        for (const spec of exportNames) {
          results.push({
            ...baseExportData,
            id: `${baseExportData.id}:${spec.name}`,
            name: spec.name,
            alias: spec.alias || spec.name
          });
        }
      }
      // For default exports, try to extract the name
      else if (exportType === 'default') {
        const identifier = this.findIdentifier(exportNode);
        results.push({
          ...baseExportData,
          name: identifier || 'default',
          isDefault: true
        });
      }

      // For re-exports, extract specifiers if any
      else if (exportType === 're-export' && sourceNode) {
        const exportNames = this.extractExportSpecifiers(exportNode);

        // If no specifiers, it's an "export * from"
        if (exportNames.length === 0) {
          results.push({
            ...baseExportData,
            name: '*',
            isNamespaceExport: true,
            isReExport: true
          });
        } else {
          // Create an export object for each name
          for (const spec of exportNames) {
            results.push({
              ...baseExportData,
              id: `${baseExportData.id}:${spec.name}`,
              name: spec.name,
              alias: spec.alias || spec.name,
              isReExport: true
            });
          }
        }
      }
      // For export-all, just one entry
      else if (exportType === 'export-all' && sourceNode) {
        
        results.push({
          ...baseExportData,
          name: '*',
          isNamespaceExport: true
        });
      }
      // For declarations, try to extract the name
      else if (exportType === 'declaration') {
        const identifier = this.findIdentifier(exportNode);
        results.push({
          ...baseExportData,
          name: identifier || 'unknown',
          isDeclaration: true
        });
      }

      return results;
    });

    //console.log("exports", exports)

    //logger.writeResults(exports, 'export');
    // Batch upload exports to Neo4j
    await this.batchUploadExports(exports);





  }


  private async batchUploadExports(exports: any[]): Promise<void> {
    if (exports.length === 0) return;

    // Process in smaller batches to avoid query complexity
    const batchSize = 25;
    for (let i = 0; i < exports.length; i += batchSize) {
      const batch = exports.slice(i, i + batchSize);

      // 1. First, create all Export nodes and connect to modules
      await this.dbClient.query(`
        UNWIND $exports as export
        
        // Get the source module
        MATCH (module:${DbSchema.labels.MODULE} {id: export.moduleId})
        
        // Create the export node
        MERGE (exp:Export {id: export.id})
        ON CREATE SET 
          exp.name = export.name,
          exp.type = export.type,
          exp.alias = COALESCE(export.alias, export.name),
          exp.isDefault = COALESCE(export.isDefault, false),
          exp.isNamespaceExport = COALESCE(export.isNamespaceExport, false),
          exp.isReExport = COALESCE(export.isReExport, false),
          exp.isDeclaration = COALESCE(export.isDeclaration, false),
          exp.sourceText = export.sourceText,
          exp.sourceCode = export.text,
          exp.line = export.line,
          exp.column = export.column,
          exp.createdAt = timestamp()
        
        // Connect export to source module
        MERGE (module)-[rel:${DbSchema.relationships.EXPORTS}]->(exp)
      `, { exports: batch });

      // 2. Process node module re-exports
      const nodeModuleReExports = batch.filter(exp =>
        exp.sourceText !== null &&
        !exp.sourceText.startsWith('.') &&
        !exp.sourceText.startsWith('/')
      );

      if (nodeModuleReExports.length > 0) {
        await this.dbClient.query(`
          UNWIND $exports as export
          
          // Get the export node
          MATCH (exp:Export {id: export.id})
          MATCH (module:${DbSchema.labels.MODULE} {id: export.moduleId})
          
          // Create external module
          MERGE (extMod:ExternalModule {
            name: SPLIT(export.sourceText, '/')[0]
          })
          SET extMod.isNodeModule = true
          
          // Connect export to external module
          MERGE (exp)-[:IMPORTS_FROM]->(extMod)
          
          // Create import relationship for analysis
          MERGE (module)-[:${DbSchema.relationships.IMPORTS} {
            importSource: export.sourceText,
            importType: 're-export'
          }]->(extMod)
        `, { exports: nodeModuleReExports });
      }

      // 3. Process local re-exports
      const localReExports = batch.filter(exp =>
        exp.sourceText !== null &&
        (exp.sourceText.startsWith('.') || exp.sourceText.startsWith('/'))
      );

      if (localReExports.length > 0) {
        // Handle finding target modules
        await this.dbClient.query(`
          UNWIND $exports as export
          
          // Get the export node and module
          MATCH (exp:Export {id: export.id})
          MATCH (module:${DbSchema.labels.MODULE} {id: export.moduleId})
          
          // Try to find target module
          OPTIONAL MATCH (targetMod:${DbSchema.labels.MODULE})
          WHERE targetMod.path CONTAINS export.sourceText OR 
                targetMod.path ENDS WITH (export.sourceText + '.js') OR
                targetMod.path ENDS WITH (export.sourceText + '.ts')
          
          // If target module found
          FOREACH (ignoreMe IN CASE WHEN targetMod IS NOT NULL THEN [1] ELSE [] END |
            MERGE (exp)-[:IMPORTS_FROM]->(targetMod)
            
            MERGE (module)-[:${DbSchema.relationships.IMPORTS} {
              importSource: export.sourceText,
              importType: 're-export'
            }]->(targetMod)
          )
          
          // If target module not found
          FOREACH (ignoreMe IN CASE WHEN targetMod IS NULL THEN [1] ELSE [] END |
            MERGE (placeholderMod:UnresolvedModule {path: export.sourceText})
            MERGE (exp)-[:IMPORTS_FROM]->(placeholderMod)
            
            MERGE (module)-[:${DbSchema.relationships.IMPORTS} {
              importSource: export.sourceText,
              importType: 're-export'
            }]->(placeholderMod)
          )
        `, { exports: localReExports });

        // Handle namespace re-exports separately
        const namespaceReExports = localReExports.filter(exp => exp.isNamespaceExport);
        if (namespaceReExports.length > 0) {
          await this.dbClient.query(`
            UNWIND $exports as export
            
            // Get the module
            MATCH (module:${DbSchema.labels.MODULE} {id: export.moduleId})
            
            // Try to find target module
            OPTIONAL MATCH (targetMod:${DbSchema.labels.MODULE})
            WHERE targetMod.path CONTAINS export.sourceText OR 
                  targetMod.path ENDS WITH (export.sourceText + '.js') OR
                  targetMod.path ENDS WITH (export.sourceText + '.ts')
            
            // If target module found
            FOREACH (ignoreMe IN CASE WHEN targetMod IS NOT NULL THEN [1] ELSE [] END |
              MERGE (module)-[reexp:${DbSchema.relationships.EXPORTS} {
                isNamespaceReExport: true
              }]->(targetMod)
            )
            
            // If target module not found
            FOREACH (ignoreMe IN CASE WHEN targetMod IS NULL THEN [1] ELSE [] END |
              MERGE (placeholderMod:UnresolvedModule {path: export.sourceText})
              MERGE (module)-[reexp:${DbSchema.relationships.EXPORTS} {
                isNamespaceReExport: true
              }]->(placeholderMod)
            )
          `, { exports: namespaceReExports });
        }
      }

      // 4. Connect regular exports to entities
      const normalExports = batch.filter(exp => exp.sourceText === null && !exp.isNamespaceExport);
      if (normalExports.length > 0) {
        await this.dbClient.query(`
          UNWIND $exports as export
          
          // Get the module and export
          MATCH (module:${DbSchema.labels.MODULE} {id: export.moduleId})
          MATCH (exp:Export {id: export.id})
          
          // Try to find the entity being exported
          OPTIONAL MATCH (entity)-[:${DbSchema.relationships.DEFINED_IN}]->(module)
          WHERE entity.name = export.name
          
          // If entity found, connect it
          FOREACH (ignoreMe IN CASE WHEN entity IS NOT NULL THEN [1] ELSE [] END |
            SET entity.exported = true
            SET entity.isDefault = COALESCE(export.isDefault, false)
            MERGE (exp)-[:EXPORTS_ENTITY]->(entity)
          )
        `, { exports: normalExports });
      }
    }

    console.log(`Processed ${exports.length} exports`);
  }






  /**
  * Extract export specifiers from an export node
  */
  private extractExportSpecifiers(exportNode: Parser.SyntaxNode): Array<{
    name: string;
    alias?: string;
  }> {

    try {
      const exportedNames: Array<{ name: string; alias?: string }> = [];

      // Find export clause
      const clauseNode = exportNode.children.find(child =>
        child.type === 'export_clause' ||
        child.type === 'named_imports'
      );

      if (!clauseNode) return exportedNames;

      // Extract specifiers
      for (const child of clauseNode.children) {
        if (child.type === 'export_specifier' || child.type === 'import_specifier') {
          const identifiers = child.children.filter(n => n.type === 'identifier');

          if (identifiers.length === 0) continue;

          if (identifiers.length === 1) {
            exportedNames.push({ name: identifiers[0].text });
          } else {
            exportedNames.push({
              name: identifiers[0].text,
              alias: identifiers[1].text
            });
          }
        }
      }

      return exportedNames;
    } catch (error) {
      console.error('Error extracting export specifiers:', error);
      return [];
    }
  }

  /**
  * Find an identifier in a node (for export declarations)
  */
  private findIdentifier(node: Parser.SyntaxNode): string | null {
    try {
      // For export declarations like "export const x = ..."
      if (node.type === 'export_declaration' || node.text.startsWith('export ')) {
        // Look for variable declarations
        const declarationNode = node.children.find(child =>
          child.type === 'variable_declaration' ||
          child.type === 'lexical_declaration'
        );

        if (declarationNode) {
          // Find variable declarator
          const declaratorNode = declarationNode.children.find(child =>
            child.type === 'variable_declarator'
          );

          if (declaratorNode) {
            // Get the identifier name
            const identifierNode = declaratorNode.children.find(child =>
              child.type === 'identifier'
            );

            if (identifierNode) {
              return identifierNode.text;
            }
          }
        }

        // For function declarations: export function x() {}
        const functionNode = node.children.find(child =>
          child.type === 'function_declaration'
        );

        if (functionNode) {
          const identifierNode = functionNode.children.find(child =>
            child.type === 'identifier'
          );

          if (identifierNode) {
            return identifierNode.text;
          }
        }

        // For class declarations: export class X {}
        const classNode = node.children.find(child =>
          child.type === 'class_declaration'
        );

        if (classNode) {
          const identifierNode = classNode.children.find(child =>
            child.type === 'identifier'
          );

          if (identifierNode) {
            return identifierNode.text;
          }
        }
      }

      // Direct child identifier (for default exports)
      const identifierNode = node.children.find(child => child.type === 'identifier');
      if (identifierNode) return identifierNode.text;

      // For more complex cases, we might need to do text analysis
      // This is a fallback for export declarations
      if (node.text.includes('export const ')) {
        const match = node.text.match(/export\s+const\s+(\w+)\s*=/);
        if (match && match[1]) {
          return match[1];
        }
      }

      if (node.text.includes('export let ')) {
        const match = node.text.match(/export\s+let\s+(\w+)\s*=/);
        if (match && match[1]) {
          return match[1];
        }
      }

      if (node.text.includes('export var ')) {
        const match = node.text.match(/export\s+var\s+(\w+)\s*=/);
        if (match && match[1]) {
          return match[1];
        }
      }

      if (node.text.includes('export function ')) {
        const match = node.text.match(/export\s+function\s+(\w+)/);
        if (match && match[1]) {
          return match[1];
        }
      }

      if (node.text.includes('export class ')) {
        const match = node.text.match(/export\s+class\s+(\w+)/);
        if (match && match[1]) {
          return match[1];
        }
      }

      return null;
    } catch (error) {
      console.error('Error finding identifier:', error);
      return null;
    }
  }


}