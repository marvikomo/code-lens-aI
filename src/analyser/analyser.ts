import * as fs from 'fs'
import * as path from 'path'
import Parser from 'tree-sitter'
import JavaScript from 'tree-sitter-javascript'
import simpleGit from 'simple-git'

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
import { ModuleLEvelExtractor } from '../extractor/module-level-extractor'
import { Indexer, Neo4jConfig } from '../indexer'
import { GraphEmbedding } from '../indexer/graph-embedding'
import { LLMModels } from '../langchain/model'
import { LLMService } from '../langchain'
import { NodeInference } from '../indexer/node-inference'

export class CodeAnalyzer {
  private graph: Graph
  private functionExtractor: Extractor
  private classExtractor: Extractor
  private importExtractor: Extractor
  private exportExtractor: Extractor
  private callExtractor: CallExtractor
  private variableExtractor: Extractor
  private moduleLevelExtractor: Extractor

  private parser: TreeSitterParser

  private jsParser = new Parser()
  private registry: LanguageRegistry
  private treeSitterUtil: TreeSitterUtil

  private indexer: Indexer

  private vectorStore: CodeVectorStore

  private embeddings: GraphEmbedding

  private llmModel: LLMModels

  private llmService: LLMService

  private nodeInference: NodeInference

  constructor(neo4jConfig: Neo4jConfig, languageRegistry: LanguageRegistry) {
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

    this.llmModel = new LLMModels()

    this.llmService = new LLMService(this.graph)

    this.embeddings = new GraphEmbedding(this.graph)

    this.functionExtractor = new FunctionExtractor(
      this.treeSitterUtil,
      this.vectorStore,
      this.graph,
    )
    this.classExtractor = new ClassExtractor(
      this.treeSitterUtil,
      this.vectorStore,
      this.graph,
    )
    this.importExtractor = new ImportExtractor(
      this.treeSitterUtil,
      this.vectorStore,
      this.graph,
    )
    this.exportExtractor = new ExportExtractor(
      this.treeSitterUtil,
      this.vectorStore,
      this.graph,
    )

    this.callExtractor = new CallExtractor(this.graph)
    this.variableExtractor = new VariableExtractor(
      this.treeSitterUtil,
      this.vectorStore,
      this.graph,
    )
    this.moduleLevelExtractor = new ModuleLEvelExtractor(
      this.treeSitterUtil,
      this.vectorStore,
      this.graph,
    )

    this.parser = new TreeSitterParser(this.registry)

    this.indexer = new Indexer(neo4jConfig)

    this.nodeInference = new NodeInference(this.graph, this.llmService)
  }

  private async collectAllFiles(directory: string) {
    //console.log('Collecting files in dir1:', directory);
    const files: any = []

    const collectFilesRecursive = (dir: string): void => {
      //console.log('Collecting files in dir:', dir);
      const entries = fs.readdirSync(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          collectFilesRecursive(fullPath)
        } else if (entry.isFile()) {
          files.push(fullPath)
        }
      }
    }

    collectFilesRecursive(directory)
    return files
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
            files.push(fullPath)
          }
        }
      }
    }

    collectFilesRecursive(directory)
    return files
  }

  async cloneRepo(repoUrl: string, localPath: string): Promise<string> {
    // Extract repo name from URL
    const match = repoUrl.match(/\/([^\/]+)\/?$/)
    const repoName = match ? match[1].replace(/\.git$/, '') : 'repo'
    const targetPath = path.join(localPath, repoName)
    const git = simpleGit()
    if (fs.existsSync(targetPath)) {
      // If already exists, pull latest changes
      await git.cwd(targetPath).pull()
    } else {
      await git.clone(repoUrl, targetPath)
    }
    return targetPath
  }

  public async analyze(
    directoryPath: string,
    options: { ignoreDirs?: string[]; ignoreFiles?: string[] } = {},
  ): Promise<void> {
    //('Analyzing dir:', directoryPath);

  //   const client = getLSPClient('typescript')

  //   const files = await this.collectFiles(directoryPath, options)
  //   await this.performAnalysis(files, directoryPath)

  //   const docFiles = await this.llmService.identifyDocFiles(files)
  //   console.log('doc files', docFiles)

  //   const projectDescription = await this.llmService.getProjectDescription(
  //     docFiles.documentationFiles,
  //   )
  //   // console.log('project description', projectDescription)

  //   const nodes = await this.llmService.selectTopNodesFromAllModules(
  //     docFiles.documentationFiles,
  //     projectDescription,
  //   )

  //   console.log('selected nodes', nodes)

  //   await this.nodeInference.processSelectedNodes(nodes, projectDescription)

  //   for (const nodeId of this.graph.nodes()) {
  //     const nodeData = this.graph.node(nodeId)
  //     if (nodeData && nodeData?.type === 'function') {
  //       console.log('function nodes', nodeData)
  //     }
  //   }

  //   // await this.indexer.indexGraph(this.graph)
  //   // console.log('All nodes indexed to Neo4j successfully')

  //     console.log('🔮 Generating embeddings...')
  //   await this.embeddings.generateAllEmbeddings({
  //     includeRelationships: true,
  //     includeCode: true,
  //     includeSignature: true,
  //     includeContext: true,
  //     maxContextLength: 1500,
  //   })

  //  await this.indexer.indexGraph(this.graph)

     let vector = await this.embeddings.generateEmbedding("how is the implemtation for permission")

     const result = await this.indexer.searchSimilarNodes(vector, 15)
     console.log("search result", result)

    // console.log('parsed files', this.parsedFiles)

    // console.log('Files collected:', files);
  }

  /**
   * Perform static AST analysis on files
   * @param files Array of file paths
   * @private
   */

  private async performAnalysis(
    files: string[],
    directoryPath: string,
  ): Promise<void> {
    console.log('Starting static AST analysis phase...')
    console.log('directory path', directoryPath)
    const client = new TypeScriptLSPClient(directoryPath)
    try {
      await client.start()

      await client.openAllProjectFiles(files)
      console.log('LSP client started and files opened.')
      // Analyze parsed files
      for (const filePath of files) {
        const parseResult = await this.parser.parseFile(filePath)

        if (!parseResult) {
          continue // Skip unsupported files
        }

        const { language, tree, content } = parseResult
        console.log('herezz')

        if (!language) continue

        //const parsedFile = this.parsedFiles.get(filePath)!;

        console.log('here')

        const functionQuery = this.registry.get(language).queries.functions
        const classQuery = this.registry.get(language).queries.classes
        const importQuery = this.registry.get(language).queries.imports
        const exportQuery = this.registry.get(language).queries.exports
        const callQuery = this.registry.get(language).queries.calls
        const variableQuery = this.registry.get(language).queries.variables

        const moduleId = `mod:${filePath}`
        this.graph.setNode(moduleId, { type: 'module', path: filePath })

        await this.importExtractor.extract(
          tree,
          content,
          filePath,
          importQuery,
          files,
        )

        await this.functionExtractor.extract(
          tree,
          content,
          filePath,
          functionQuery,
          client,
        )

        await this.classExtractor.extract(tree, content, filePath, classQuery)

        await this.moduleLevelExtractor.extract(
          tree,
          content,
          filePath,
          importQuery,
          client,
        )

        // await this.exportExtractor.extract(tree, content, filePath, exportQuery);

        // await this.variableExtractor.extract(tree, content, filePath, variableQuery);

        // Extract function declarations
        // this.extractFunctions(parsedFile);

        // // Extract function calls
        // this.extractCalls(parsedFile);
      }
      console.log('Static AST analysis phase complete!')
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
