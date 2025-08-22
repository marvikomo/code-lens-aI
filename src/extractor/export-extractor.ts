import Parser from 'tree-sitter';
import { Extractor } from "./extractor";
import { DbSchema } from '../db/schema';
import { Neo4jClient } from "../db/neo4j-client";
import { logger } from '../logger';
import { TreeSitterUtil } from '../util/tree-sitter-util';
import { CodeVectorStore } from '../vector-store';
import { Graph } from 'graphlib';

export class ExportExtractor extends Extractor {

  constructor(treeSitterUtil: TreeSitterUtil, vectorStore: CodeVectorStore, graph: Graph){
    super(treeSitterUtil, vectorStore, graph);
  }

  /**
   * Extract exports from a parsed file and store in Neo4j
   */
  async extract(tree: Parser.Tree, content: string, filePath: string, query: Parser.Query): Promise<void> {
 


  }





}