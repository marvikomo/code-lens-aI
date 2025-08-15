import * as fs from 'fs'
import * as path from 'path'
import Parser from 'tree-sitter'
import JavaScript from 'tree-sitter-javascript'

import { Neo4jClient } from '../db/neo4j-client'

// Create a type for the language instance
type TreeSitterLanguage = Parser.Language & {
  nodeTypeInfo: any
}

import { createHash } from 'crypto'

import { logger } from '../logger'
import { FileInfo, ParsedFile } from '../interfaces/file'
import { CallInfo, CodeEdge, CodeNode, FunctionNode } from '../interfaces/code'
import { TreeSitterParser } from '../tree-sitter-parser'
import { LanguageRegistry } from '../languages/language-registry'
import { createQuery } from '../queries/create-queries'
import {
  CallQuery,
  ClassQuery,
  FunctionQuery,
  ImportQuery,
  VariableQuery,
  ExportQuery,
} from '../queries/js-query-constants'
import { FunctionExtractor } from '../extractor/function-extractor'
import { Extractor } from '../extractor/extractor'
import { ClassExtractor } from '../extractor/class-extractor'
import { ImportExtractor } from '../extractor/import-extractor'
import { ExportExtractor } from '../extractor/export-extractor'
import { CallExtractor } from '../extractor/call-extractor'
import { VariableExtractor } from '../extractor/variable-extractor'
import { TreeSitterUtil } from '../util/tree-sitter-util'
import { Graph } from 'graphlib'
import { TypeScriptLSPClient } from '../language-server/typescript-server/lsp-client'
import { getLSPClient } from '../language-server/index'

import { CodeVectorStore } from '../vector-store'

export class CodeAnalyzer {

  private graph: Graph
  private functionExtractor: Extractor
  private classExtractor: Extractor
  private importExtractor: Extractor
  private exportExtractor: Extractor
  private callExtractor: CallExtractor
  private variableExtractor: Extractor

  private parser: TreeSitterParser

  private jsParser = new Parser()
  private registry: LanguageRegistry
  private treeSitterUtil: TreeSitterUtil

  private vectorStore: CodeVectorStore

  constructor(dbClient: Neo4jClient, languageRegistry: LanguageRegistry) {
    this.jsParser.setLanguage(JavaScript as TreeSitterLanguage)

    this.treeSitterUtil = new TreeSitterUtil()

    this.graph = new Graph()

    this.registry = languageRegistry
    this.registry.register('javascript', {
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
      parser: this.jsParser,
      queries: {
        functions: createQuery(JavaScript as TreeSitterLanguage, FunctionQuery),
        calls: createQuery(JavaScript as TreeSitterLanguage, CallQuery),
        imports: createQuery(JavaScript as TreeSitterLanguage, ImportQuery),
        exports: createQuery(JavaScript as TreeSitterLanguage, ExportQuery),
        classes: createQuery(JavaScript as TreeSitterLanguage, ClassQuery),
        variables: createQuery(JavaScript as TreeSitterLanguage, VariableQuery),
      },
    })


    this.functionExtractor = new FunctionExtractor(
      dbClient,
      this.treeSitterUtil,
      this.vectorStore,
      this.graph,
    )
    this.classExtractor = new ClassExtractor(
      dbClient,
      this.treeSitterUtil,
      this.vectorStore,
      this.graph,
    )
    this.importExtractor = new ImportExtractor(
      dbClient,
      this.treeSitterUtil,
      this.vectorStore,
      this.graph,
    )
    this.exportExtractor = new ExportExtractor(
      dbClient,
      this.treeSitterUtil,
      this.vectorStore,
      this.graph,
    )
    this.classExtractor = new ClassExtractor(
      dbClient,
      this.treeSitterUtil,
      this.vectorStore,
      this.graph,
    )
    this.callExtractor = new CallExtractor(this.graph)
    this.variableExtractor = new VariableExtractor(
      dbClient,
      this.treeSitterUtil,
      this.vectorStore,
      this.graph,
    )

    this.parser = new TreeSitterParser(this.registry)
  }

  public async analyze(
    directoryPath: string,
    options: { ignoreDirs?: string[]; ignoreFiles?: string[] } = {},
  ): Promise<void> {
    //('Analyzing dir:', directoryPath);

    const client = getLSPClient('typescript')

    const files = await this.collectFiles(directoryPath, options)
    await this.performAnalysis(files)

    // console.log('parsed files', this.parsedFiles)

    // console.log('Files collected:', files);
  }

  private async collectFiles(
    directory: string,
    options: { ignoreDirs?: string[]; ignoreFiles?: string[] } = {},
  ) {
    //console.log('Collecting files in dir1:', directory);
    const files: any = []

    const ignoredDirs = new Set([
      'node_modules',
      '.git',
      '.github',
      'dist',
      'build',
      'target',
      'bin',
      'obj',
      'out',
      '.idea',
      '.vscode',
      ...(options.ignoreDirs || []),
    ])

    const ignoredFiles = new Set([
      '.DS_Store',
      'Thumbs.db',
      'package-lock.json',
      'yarn.lock',
      ...(options.ignoreFiles || []),
    ])

    const collectFilesRecursive = (dir: string): void => {
      //console.log('Collecting files in dir:', dir);
      const entries = fs.readdirSync(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          if (!ignoredDirs.has(entry.name)) {
            collectFilesRecursive(fullPath)
          }
        } else if (entry.isFile()) {
          if (!ignoredFiles.has(entry.name)) {
            const language = this.registry.detect(fullPath)
            if (language) {
              files.push(fullPath)
            }
          }
        }
      }
    }

    collectFilesRecursive(directory)
    return files
  }

  /**
   * Perform static AST analysis on files
   * @param files Array of file paths
   * @private
   */

  private async performAnalysis(files: string[]): Promise<void> {
    console.log('Starting static AST analysis phase...', files)
    const client = new TypeScriptLSPClient('test-dir/codebase')
    try {
      client.start()

      client.openAllProjectFiles(files)
      // Analyze parsed files
      for (const filePath of files) {
        const { language, tree, content } = await this.parser.parseFile(
          filePath,
        )

        //const parsedFile = this.parsedFiles.get(filePath)!;

        const functionQuery = this.registry.get(language).queries.functions
        const classQuery = this.registry.get(language).queries.classes
        const importQuery = this.registry.get(language).queries.imports
        const exportQuery = this.registry.get(language).queries.exports
        const callQuery = this.registry.get(language).queries.calls
        const variableQuery = this.registry.get(language).queries.variables

        //await this.importExtractor.extract(tree, content, filePath, importQuery, files);

        await this.functionExtractor.extract(
          tree,
          content,
          filePath,
          functionQuery,
          client,
        )

        // await this.classExtractor.extract(tree, content, filePath, classQuery);

        // await this.exportExtractor.extract(tree, content, filePath, exportQuery);

        // await this.variableExtractor.extract(tree, content, filePath, variableQuery);

        // Extract function declarations
        // this.extractFunctions(parsedFile);

        // // Extract function calls
        // this.extractCalls(parsedFile);
      }

      for (const filePath of files) {
        await this.callExtractor.extract(filePath, client)
      }
    } catch (error) {
      console.error('Error during analysis:', error)
    } finally {
      client.shutdown()
    }
  }

}
