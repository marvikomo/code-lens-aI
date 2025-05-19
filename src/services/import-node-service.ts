import Parser from 'tree-sitter';
import * as path from 'path';
import { Neo4jClient } from '../db/neo4j-client';
import { DbSchema } from '../db/schema';
import { TreeSitterUtil } from '../util/tree-sitter-util';

export class ImportNodeService {
  private dbClient: Neo4jClient;
  private treeSitterUtil: TreeSitterUtil;

  constructor(dbClient: Neo4jClient, treeSitterUtil?: TreeSitterUtil) {
    this.dbClient = dbClient;
    this.treeSitterUtil = treeSitterUtil || new TreeSitterUtil();
  }

  /**
   * Index a single import statement
   */
  public async indexImport(
    importNode: Parser.SyntaxNode,
    importName: string,
    importSource: string,
    filePath: string,
    resolvedPath: string | null,
    importType: 'es6' | 'require' | 'dynamic' | 'node_module' | 'unresolved' = 'es6'
  ): Promise<string> {
    const startPosition = importNode.startPosition;
    const endPosition = importNode.endPosition;

    // Generate unique ID
    const importId = `import:${filePath}:${startPosition.row}:${startPosition.column}`;

    // Create source module reference
    const sourceModuleId = `mod:${filePath}`;
    
    // Create target module reference if resolved
    const targetModuleId = resolvedPath ? `mod:${resolvedPath}` : null;

    // Index the import in Neo4j
    await this.dbClient.runInTransaction(async (session) => {
      if (resolvedPath) {
        // Create or update import node with resolved path
        await session.run(
          `
          // Ensure target module exists
          MERGE (targetMod:${DbSchema.labels.MODULE} {id: $targetModuleId})
          ON CREATE SET 
            targetMod.path = $resolvedPath,
            targetMod.name = $targetModuleName,
            targetMod.createdAt = timestamp()
          
          // Create import relationship
          MATCH (sourceMod:${DbSchema.labels.MODULE} {id: $sourceModuleId})
          MERGE (sourceMod)-[imp:${DbSchema.relationships.IMPORTS}]->(targetMod)
          ON CREATE SET 
            imp.name = $importName,
            imp.importSource = $importSource,
            imp.importType = $importType,
            imp.line = $lineStart,
            imp.column = $columnStart,
            imp.createdAt = timestamp()
          ON MATCH SET
            imp.name = $importName,
            imp.importSource = $importSource,
            imp.updatedAt = timestamp()
          `,
          {
            sourceModuleId,
            targetModuleId,
            resolvedPath,
            targetModuleName: path.basename(resolvedPath),
            importName,
            importSource,
            importType,
            lineStart: startPosition.row,
            columnStart: startPosition.column,
          }
        );
      } else {
        // Handle unresolved imports (node modules or unresolved paths)
        const isNodeModule = !importSource.startsWith('.') && !importSource.startsWith('/');
        const externalModuleType = isNodeModule ? 'ExternalModule' : 'UnresolvedModule';
        const externalModuleId = isNodeModule ? `npm:${importSource.split('/')[0]}` : `unresolved:${importSource}`;
        
        await session.run(
          `
          // Create external module reference
          MERGE (extMod:${externalModuleType} {id: $externalModuleId})
          ON CREATE SET 
            extMod.name = $moduleName,
            extMod.fullPath = $importSource,
            extMod.isNodeModule = $isNodeModule,
            extMod.createdAt = timestamp()
          
          // Create import relationship
          MATCH (sourceMod:${DbSchema.labels.MODULE} {id: $sourceModuleId})
          MERGE (sourceMod)-[imp:${DbSchema.relationships.IMPORTS}]->(extMod)
          ON CREATE SET 
            imp.name = $importName,
            imp.importSource = $importSource,
            imp.importType = $importType,
            imp.line = $lineStart,
            imp.column = $columnStart,
            imp.createdAt = timestamp()
          ON MATCH SET
            imp.name = $importName,
            imp.importSource = $importSource,
            imp.updatedAt = timestamp()
          `,
          {
            sourceModuleId,
            externalModuleId,
            moduleName: isNodeModule ? importSource.split('/')[0] : importSource,
            importName,
            importSource,
            importType: isNodeModule ? 'node_module' : 'unresolved',
            isNodeModule,
            lineStart: startPosition.row,
            columnStart: startPosition.column,
          }
        );
      }
    });

    return importId;
  }

  /**
   * Index a batch of imports
   */
  public async indexImportsInBatch(
    importMap:  Map<string, {
      importId: string;
      importName: string;
      importCode: string;
      importSource: string;
      context: string;
      filePath: string;
      startPosition: number;
      endPosition: number;

      resolvedPath: string | null;
      importType: 'es6' | 'require' | 'dynamic' | 'node_module' | 'unresolved';
    }>
  ): Promise<void> {
    if (importMap.size === 0) return;

    const importArray = Array.from(importMap.values()).map((imp) => {
      // Clean import source (remove quotes)
      const cleanImportSource = imp.importSource.replace(/['"]/g, '');
  
      
      return {
        importId: imp.importId,
        importName: imp.importName,
        importSource: cleanImportSource,
        importCode: imp.importCode,
        importType: imp.importType,
        filePath: imp.filePath,
        resolvedPath: imp.resolvedPath,
        lineStart: imp.startPosition,
        lineEnd: imp.endPosition,
        context: imp.context
      };
    });
  
    const moduleRelations = importArray.map(imp => ({
      importId: imp.importId,
      moduleId: `mod:${imp.filePath}`
    }));
  
    await this.dbClient.runInTransaction(async (session) => {
      try {
        // 1. Bulk insert all import nodes
        await session.run(`
          UNWIND $imports AS import
          MERGE (i:${DbSchema.labels.IMPORT} {id: import.importId})
          ON CREATE SET 
            i.name = import.name,
            i.source = import.source,
            i.code = import.code,
            i.type = import.type,
            i.context = import.context,
            i.filePath = import.filePath,
            i.resolvedPath = import.resolvedPath,
            i.lineStart = import.lineStart,
            i.lineEnd = import.lineEnd,
            i.columnStart = import.columnStart,
            i.createdAt = timestamp()
          ON MATCH SET
            i.name = import.name,
            i.source = import.source,
            i.code = import.code,
            i.type = import.type,
            i.context = import.context,
            i.filePath = import.filePath,
            i.resolvedPath = import.resolvedPath,
            i.lineStart = import.lineStart,
            i.lineEnd = import.lineEnd,
            i.columnStart = import.columnStart,
            i.updatedAt = timestamp()
        `, { imports: importArray });
  
        // 2. Bulk create DEFINED_IN relationships to modules
        await session.run(`
          UNWIND $relations AS rel
          MATCH (i:${DbSchema.labels.IMPORT} {id: rel.importId})
          MATCH (m:${DbSchema.labels.MODULE} {id: rel.moduleId})
          MERGE (i)-[:${DbSchema.relationships.DEFINED_IN}]->(m)
        `, { relations: moduleRelations });
  
      } catch (error) {
        console.error('Error indexing imports:', error);
        throw error;
      }
    });
  
    console.log(`Indexed ${importArray.length} imports in batch.`);
  }




}