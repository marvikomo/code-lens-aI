import Parser from 'tree-sitter';
import * as fs from 'fs';
import * as path from 'path';
import { Extractor } from './extractor';
import { Neo4jClient } from '../db/neo4j-client';
import { DbSchema } from '../db/schema';
import { TreeSitterUtil } from '../util/tree-sitter-util';
import { resolveImport } from 'resolve-import';
import { ClassNodeService } from '../services/class-node-service';
import { FunctionNodeService } from '../services/function-node-service';
import { ImportNodeService } from '../services/import-node-service';
import { CodeVectorStore } from '../vector-store';
import { Graph } from 'graphlib';

export class ImportExtractor extends Extractor {
  private functionNodeService: FunctionNodeService;
  private classNodeService: ClassNodeService;
  private importNodeService: ImportNodeService;
  
  constructor(dbClient: Neo4jClient, treeSitterUtil: TreeSitterUtil, vectorStore: CodeVectorStore, graph: Graph) {
    super(dbClient, treeSitterUtil, vectorStore, graph);
    this.functionNodeService = new FunctionNodeService(dbClient);
    this.classNodeService = new ClassNodeService(dbClient);
    this.importNodeService = new ImportNodeService(dbClient, treeSitterUtil);
  }
  
  /**
   * Extract import statements from a parsed file and store in Neo4j
   */
  async extract(
    tree: Parser.Tree, 
    content: string, 
    filePath: string, 
    query: Parser.Query,
    files: string[],
  ): Promise<void> {
    // Ensure module node exists
    await this.ensureModuleNode(filePath);
  
    const matches = query.matches(tree.rootNode);


    let importFilter = matches.filter(match => {
      const captureNames = match.captures.map((c) => c.name)
      return captureNames.some(name => name === 'import_statement')
    })
    
    // Process in batches
    const batchSize = 20;
    for (let i = 0; i < matches.length; i += batchSize) {
      const batch = matches.slice(i, i + batchSize);
      await this.processImportBatch(importFilter, filePath, files, tree);
    }
    
    console.log(`Extracted ${matches.length} imports from ${filePath}`);
  }
  
  /**
   * Process a batch of import matches
   */
  private async processImportBatch(
    matches: Parser.QueryMatch[], 
    filePath: string,
    files: string[],
    tree: Parser.Tree
  ): Promise<void> {
  
      var importMap = new Map<string, any>();

      for (const match of matches) {
       // console.log("match", match.captures)
        // Handle ES6 import statements

        let nameCapture = match.captures.find(c => c.name === 'name');

        let statementCapture = match.captures.find(c =>  c.name === 'import_statement');

        if(!nameCapture && !statementCapture) continue;

         
        // console.log("statement", statementCapture)
    
        let importName = nameCapture.node.text;

        if(!importMap.has(importName)) {
          importMap.set(importName, {
            importId: null,
            importName: importName,
            importCode: statementCapture.node.text,
            importSource: '',
            context: '',
            filePath: filePath,
            lineStart: statementCapture.node.startPosition.row,
            lineEnd: statementCapture.node.endPosition.row,
            columnStart: statementCapture.node.startPosition.column,
            columnEnd: statementCapture.node.endPosition.column,
          })
        }

        const variableId = this.generateNodeId(
          'imp',
          importName,
          filePath,
          statementCapture.node.startPosition.row,
          statementCapture.node.startPosition.column,
        )

        
        let importDetails = importMap.get(importName);

        importDetails.importId = variableId;

        let importSource = match.captures.find(c => c.name === 'source').node.text;
        
         
        importDetails.importSource = importSource;

        importDetails.context = `This is an import with source ${importSource} and name ${importName}`;

       //let usageArr =  this.treeSitterUtils.findImportedIdentifierUsages(tree, importName);
       await this.importNodeService.indexImportsInBatch(importMap);

        let line = match.captures.some(c => c.node.startPosition.row + 1 === 9)
        if(line) {
       
       
         // console.log("usage", usage)
          //console.log("parent", usage.forEach(e => console.log("xx",e.node.parent)))
          console.log("name", importName)
      
   
          console.log("mkl", match.captures)
        }

       
      }

  }
  
  /**
   * Process an ES6 import statement
   */
  private async processES6Import(
    match: Parser.QueryMatch,
    filePath: string,
    session: any
  ): Promise<void> {
    const importStmtCapture = match.captures.find(c => c.name === 'import_statement');
    const sourceCapture = match.captures.find(c => c.name === 'import_source');
    
    if (!importStmtCapture || !sourceCapture) return;
    
    const importNode = importStmtCapture.node;
    
    // Get import source path (remove quotes)
    const importSource = sourceCapture.node.text.replace(/['"]/g, '');
    
    // Resolve path to actual file
    const resolvedPath = this.resolveImportPath(importSource, filePath);
    if (!resolvedPath) {
      // Handle unresolved imports (likely node modules or types)
      await this.handleUnresolvedImport(importSource, filePath, session);
      return;
    }
    
    // Extract different types of imports
    const defaultImport = this.extractDefaultImport(importNode);
    const namedImports = this.extractNamedImports(importNode);
    const namespaceImport = this.extractNamespaceImport(importNode);
    
    // Generate unique ID for this import
    const importId = `import:${filePath}:${importNode.startPosition.row}:${importNode.startPosition.column}`;
    
    // Create source and target module references
    const sourceModuleId = `mod:${filePath}`;
    const targetModuleId = `mod:${resolvedPath}`;
    
    // Create import relationship between modules
    await session.run(`
      // Ensure target module exists (might not be processed yet)
      MERGE (targetMod:${DbSchema.labels.MODULE} {id: $targetModuleId})
      ON CREATE SET 
        targetMod.path = $resolvedPath,
        targetMod.name = $targetModuleName,
        targetMod.createdAt = timestamp()
      
      // Create import relationship
      MATCH (sourceMod:${DbSchema.labels.MODULE} {id: $sourceModuleId})
      MERGE (sourceMod)-[imp:${DbSchema.relationships.IMPORTS}]->(targetMod)
      ON CREATE SET 
        imp.defaultImport = $defaultImport,
        imp.namedImports = $namedImports,
        imp.namespaceImport = $namespaceImport,
        imp.importSource = $importSource,
        imp.importType = 'es6',
        imp.line = $line,
        imp.column = $column,
        imp.createdAt = timestamp()
      ON MATCH SET
        imp.defaultImport = $defaultImport,
        imp.namedImports = $namedImports,
        imp.namespaceImport = $namespaceImport,
        imp.importSource = $importSource,
        imp.updatedAt = timestamp()
    `, {
      sourceModuleId,
      targetModuleId,
      resolvedPath,
      targetModuleName: path.basename(resolvedPath),
      defaultImport,
      namedImports,
      namespaceImport,
      importSource,
      line: importNode.startPosition.row,
      column: importNode.startPosition.column
    });
    
    // Create individual import references for each imported entity
    if (defaultImport) {
      await this.createImportedEntityReference(
        session, 
        sourceModuleId, 
        targetModuleId, 
        'default', 
        defaultImport, 
        true
      );
    }
    
    for (const namedImport of namedImports) {
      const { name, alias } = namedImport;
      await this.createImportedEntityReference(
        session, 
        sourceModuleId, 
        targetModuleId, 
        name, 
        alias || name, 
        false
      );
    }
    
    if (namespaceImport) {
      await session.run(`
        MATCH (sourceMod:${DbSchema.labels.MODULE} {id: $sourceModuleId})
        MATCH (targetMod:${DbSchema.labels.MODULE} {id: $targetModuleId})
        MERGE (imp:Import {
          id: $importId,
          type: 'namespace',
          name: $namespaceImport,
          source: $importSource,
          line: $line,
          column: $column
        })
        MERGE (sourceMod)-[:HAS_IMPORT]->(imp)
        MERGE (imp)-[:IMPORTS_FROM]->(targetMod)
      `, {
        sourceModuleId,
        targetModuleId,
        importId: `${importId}:namespace`,
        namespaceImport,
        importSource,
        line: importNode.startPosition.row,
        column: importNode.startPosition.column
      });
    }
  }
  
  /**
   * Process a CommonJS require statement
   */
  private async processRequireImport(
    match: Parser.QueryMatch,
    filePath: string,
    session: any
  ): Promise<void> {
    const requireCapture = match.captures.find(c => c.name === 'require');
    const pathCapture = match.captures.find(c => c.name === 'require_path');
    
    if (!requireCapture || !pathCapture) return;
    
    const requireNode = requireCapture.node.parent; // Get the call_expression
    
    // Get require path (remove quotes)
    const requirePath = pathCapture.node.text.replace(/['"]/g, '');
    
    // Resolve path
    const resolvedPath = this.resolveImportPath(requirePath, filePath);
    if (!resolvedPath) {
      // Handle unresolved imports (likely node modules)
      await this.handleUnresolvedImport(requirePath, filePath, session);
      return;
    }
    
    // Generate unique ID for this require
    const requireId = `require:${filePath}:${requireNode.startPosition.row}:${requireNode.startPosition.column}`;
    
    // Get variable name if assigned (e.g., const x = require('y'))
    let variableName = null;
    if (requireNode.parent && requireNode.parent.type === 'variable_declarator') {
      const nameNode = requireNode.parent.children.find(n => n.type === 'identifier');
      if (nameNode) {
        variableName = nameNode.text;
      }
    }
    
    // Create source and target module references
    const sourceModuleId = `mod:${filePath}`;
    const targetModuleId = `mod:${resolvedPath}`;
    
    // Create import relationship between modules
    await session.run(`
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
        imp.importType = 'require',
        imp.variableName = $variableName,
        imp.importSource = $requirePath,
        imp.line = $line,
        imp.column = $column,
        imp.createdAt = timestamp()
      ON MATCH SET
        imp.variableName = $variableName,
        imp.importSource = $requirePath,
        imp.updatedAt = timestamp()
    `, {
      sourceModuleId,
      targetModuleId,
      resolvedPath,
      targetModuleName: path.basename(resolvedPath),
      variableName,
      requirePath,
      line: requireNode.startPosition.row,
      column: requireNode.startPosition.column
    });
    
    // If variable name is present, create a reference
    if (variableName) {
      await session.run(`
        MATCH (sourceMod:${DbSchema.labels.MODULE} {id: $sourceModuleId})
        MATCH (targetMod:${DbSchema.labels.MODULE} {id: $targetModuleId})
        MERGE (imp:Import {
          id: $requireId,
          type: 'require',
          name: $variableName,
          source: $requirePath,
          line: $line,
          column: $column
        })
        MERGE (sourceMod)-[:HAS_IMPORT]->(imp)
        MERGE (imp)-[:IMPORTS_FROM]->(targetMod)
      `, {
        sourceModuleId,
        targetModuleId,
        requireId,
        variableName,
        requirePath,
        line: requireNode.startPosition.row,
        column: requireNode.startPosition.column
      });
    }
  }
  
  /**
   * Process a dynamic import (import())
   */
  private async processDynamicImport(
    match: Parser.QueryMatch,
    filePath: string,
    session: any
  ): Promise<void> {
    const dynamicImportCapture = match.captures.find(c => c.name === 'dynamic_import');
    const pathCapture = match.captures.find(c => c.name === 'dynamic_import_source');
    
    if (!dynamicImportCapture || !pathCapture) return;
    
    const importNode = dynamicImportCapture.node;
    
    // Check if the path is a literal string or an expression
    const isDynamicPath = pathCapture.node.type !== 'string';
    
    // Get import path if it's a string literal
    let importPath = '';
    if (!isDynamicPath) {
      importPath = pathCapture.node.text.replace(/['"]/g, '');
    }
    
    // Generate unique ID for this dynamic import
    const importId = `dynamic_import:${filePath}:${importNode.startPosition.row}:${importNode.startPosition.column}`;
    
    // Create source module reference
    const sourceModuleId = `mod:${filePath}`;
    
    if (isDynamicPath) {
      // Handle completely dynamic imports (can't resolve target)
      await session.run(`
        MATCH (sourceMod:${DbSchema.labels.MODULE} {id: $sourceModuleId})
        MERGE (di:DynamicImport {
          id: $importId,
          line: $line,
          column: $column,
          isDynamicPath: true
        })
        MERGE (sourceMod)-[:HAS_DYNAMIC_IMPORT]->(di)
      `, {
        sourceModuleId,
        importId,
        line: importNode.startPosition.row,
        column: importNode.startPosition.column
      });
      
      return;
    }
    
    // Resolve path if possible
    const resolvedPath = this.resolveImportPath(importPath, filePath);
    if (!resolvedPath) {
      // Handle unresolved dynamic imports
      await session.run(`
        MATCH (sourceMod:${DbSchema.labels.MODULE} {id: $sourceModuleId})
        MERGE (di:DynamicImport {
          id: $importId,
          source: $importPath,
          line: $line,
          column: $column,
          isResolved: false
        })
        MERGE (sourceMod)-[:HAS_DYNAMIC_IMPORT]->(di)
      `, {
        sourceModuleId,
        importId,
        importPath,
        line: importNode.startPosition.row,
        column: importNode.startPosition.column
      });
      
      return;
    }
    
    // Create target module reference
    const targetModuleId = `mod:${resolvedPath}`;
    
    // Create dynamic import relationship
    await session.run(`
      // Ensure target module exists
      MERGE (targetMod:${DbSchema.labels.MODULE} {id: $targetModuleId})
      ON CREATE SET 
        targetMod.path = $resolvedPath,
        targetMod.name = $targetModuleName,
        targetMod.createdAt = timestamp()
      
      // Create dynamic import node
      MATCH (sourceMod:${DbSchema.labels.MODULE} {id: $sourceModuleId})
      MERGE (di:DynamicImport {
        id: $importId,
        source: $importPath,
        line: $line,
        column: $column,
        isResolved: true
      })
      MERGE (sourceMod)-[:HAS_DYNAMIC_IMPORT]->(di)
      MERGE (di)-[:IMPORTS_FROM]->(targetMod)
      
      // Also create a regular import relationship for analysis
      MERGE (sourceMod)-[imp:${DbSchema.relationships.IMPORTS}]->(targetMod)
      ON CREATE SET 
        imp.importType = 'dynamic',
        imp.importSource = $importPath,
        imp.line = $line,
        imp.column = $column,
        imp.isDynamic = true,
        imp.createdAt = timestamp()
      ON MATCH SET
        imp.isDynamic = true,
        imp.updatedAt = timestamp()
    `, {
      sourceModuleId,
      targetModuleId,
      importId,
      resolvedPath,
      targetModuleName: path.basename(resolvedPath),
      importPath,
      line: importNode.startPosition.row,
      column: importNode.startPosition.column
    });
  }
  
  /**
   * Create a reference for an imported entity
   */
  private async createImportedEntityReference(
    session: any,
    sourceModuleId: string,
    targetModuleId: string,
    originalName: string,
    localName: string,
    isDefault: boolean
  ): Promise<void> {
    await session.run(`
      MATCH (sourceMod:${DbSchema.labels.MODULE} {id: $sourceModuleId})
      MATCH (targetMod:${DbSchema.labels.MODULE} {id: $targetModuleId})
      
      // Try to find the actual entity in the target module
      OPTIONAL MATCH (entity)-[:${DbSchema.relationships.DEFINED_IN}]->(targetMod)
      WHERE entity.name = $originalName
      
      // Create import reference node
      MERGE (imp:Import {
        id: $importId,
        type: $importType,
        name: $localName,
        originalName: $originalName,
        isDefault: $isDefault
      })
      
      // Connect to source module
      MERGE (sourceMod)-[:HAS_IMPORT]->(imp)
      
      // Connect to entity if found, otherwise to module
      FOREACH (e IN CASE WHEN entity IS NOT NULL THEN [1] ELSE [] END |
        MERGE (imp)-[:IMPORTS_ENTITY]->(entity)
      )
      
      FOREACH (e IN CASE WHEN entity IS NULL THEN [1] ELSE [] END |
        MERGE (imp)-[:IMPORTS_FROM]->(targetMod)
      )
    `, {
      sourceModuleId,
      targetModuleId,
      importId: `import:${sourceModuleId}:${originalName}`,
      importType: isDefault ? 'default' : 'named',
      localName,
      originalName,
      isDefault
    });
  }
  
  /**
   * Handle imports that can't be resolved to a file (node_modules, types, etc.)
   */
  private async handleUnresolvedImport(
    importPath: string,
    filePath: string,
    session: any
  ): Promise<void> {
    // Is this a node module?
    const isNodeModule = !importPath.startsWith('.') && !importPath.startsWith('/');
    
    // Create source module reference
    const sourceModuleId = `mod:${filePath}`;
    
    if (isNodeModule) {
      // Handle node module import
      const packageName = importPath.split('/')[0];
      const targetModuleId = `npm:${packageName}`;
      
      await session.run(`
        // Create node module reference
        MERGE (targetMod:ExternalModule {id: $targetModuleId})
        ON CREATE SET 
          targetMod.name = $packageName,
          targetMod.fullPath = $importPath,
          targetMod.isNodeModule = true,
          targetMod.createdAt = timestamp()
        
        // Add WITH clause here to connect the queries
        WITH targetMod
        
        // Create import relationship
        MATCH (sourceMod:${DbSchema.labels.MODULE} {id: $sourceModuleId})
        MERGE (sourceMod)-[imp:${DbSchema.relationships.IMPORTS}]->(targetMod)
        ON CREATE SET 
          imp.importSource = $importPath,
          imp.importType = 'node_module',
          imp.createdAt = timestamp()
        ON MATCH SET
          imp.updatedAt = timestamp()
      `, {
        sourceModuleId,
        targetModuleId,
        packageName,
        importPath
      });
    } else {
      // Handle other unresolved imports
      const targetModuleId = `unresolved:${importPath}`;
      
      await session.run(`
        // Create unresolved module reference
        MERGE (targetMod:UnresolvedModule {id: $targetModuleId})
        ON CREATE SET 
          targetMod.path = $importPath,
          targetMod.createdAt = timestamp()
        
        // Add WITH clause here
        WITH targetMod
        
        // Create import relationship
        MATCH (sourceMod:${DbSchema.labels.MODULE} {id: $sourceModuleId})
        MERGE (sourceMod)-[imp:${DbSchema.relationships.IMPORTS}]->(targetMod)
        ON CREATE SET 
          imp.importSource = $importPath,
          imp.importType = 'unresolved',
          imp.createdAt = timestamp()
        ON MATCH SET
          imp.updatedAt = timestamp()
      `, {
        sourceModuleId,
        targetModuleId,
        importPath
      });
    }
  }
  
  /**
   * Extract default import from an import statement
   */
  private extractDefaultImport(importNode: Parser.SyntaxNode): string | null {
    try {
      // Find import clause
      const importClause = importNode.children.find(child => 
        child.type === 'import_clause'
      );
      
      if (!importClause) return null;
      
      // Check for default import (first identifier before any named imports)
      const firstChild = importClause.firstChild;
      if (firstChild && firstChild.type === 'identifier') {
        return firstChild.text;
      }
      
      return null;
    } catch (error) {
      console.error('Error extracting default import:', error);
      return null;
    }
  }
  
  /**
   * Extract named imports from an import statement
   */
  private extractNamedImports(importNode: Parser.SyntaxNode): Array<{
    name: string;
    alias?: string;
  }> {
    try {
      const namedImports: Array<{ name: string; alias?: string }> = [];
      
      // Find named imports
      const namedImportsList = importNode.children.find(child => 
        child.type === 'named_imports'
      );
      
      if (!namedImportsList) return namedImports;
      
      // Process import specifiers
      for (const child of namedImportsList.children) {
        if (child.type === 'import_specifier') {
          let name = '';
          let alias;
          
          // Find name node (first identifier)
          const nameNode = child.children.find(n => n.type === 'identifier');
          if (!nameNode) continue;
          
          name = nameNode.text;
          
          // Check for alias (has more than one identifier)
          if (child.children.filter(n => n.type === 'identifier').length > 1) {
            const identifiers = child.children.filter(n => n.type === 'identifier');
            name = identifiers[0].text;
            alias = identifiers[1].text;
          }
          
          namedImports.push({ name, alias });
        }
      }
      
      return namedImports;
    } catch (error) {
      console.error('Error extracting named imports:', error);
      return [];
    }
  }
  
  /**
   * Extract namespace import from an import statement
   */
  private extractNamespaceImport(importNode: Parser.SyntaxNode): string | null {
    try {
      // Find namespace import
      const namespaceImport = importNode.children.find(child => 
        child.type === 'namespace_import'
      );
      
      if (!namespaceImport) return null;
      
      // Get the identifier
      const identifier = namespaceImport.children.find(child => 
        child.type === 'identifier'
      );
      
      return identifier ? identifier.text : null;
    } catch (error) {
      console.error('Error extracting namespace import:', error);
      return null;
    }
  }
  
  /**
   * Resolve an import path to an absolute file path
   * This is a simplified implementation
   */
  private resolveImportPath(importPath: string, currentFilePath: string): string | null {
    try {
      // Handle node_modules imports
      if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
        // In a real implementation, you would resolve node_modules paths
        return null;
      }
      
      // Handle relative imports
      const currentDir = path.dirname(currentFilePath);
      let resolvedPath = path.resolve(currentDir, importPath);
      
      // Check if path exists as-is
      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
        return resolvedPath;
      }
      
      // Add extension if needed
      if (!path.extname(resolvedPath)) {
        // Try common extensions
        for (const ext of ['.js', '.jsx', '.ts', '.tsx']) {
          const withExt = `${resolvedPath}${ext}`;
          if (fs.existsSync(withExt)) {
            return withExt;
          }
        }
        
        // Try index files
        if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
          for (const ext of ['.js', '.jsx', '.ts', '.tsx']) {
            const indexFile = path.join(resolvedPath, `index${ext}`);
            if (fs.existsSync(indexFile)) {
              return indexFile;
            }
          }
        }
      }
      
      // Path not found
      return null;
    } catch (error) {
      console.error(`Error resolving import path ${importPath}:`, error);
      return null;
    }
  }
}
