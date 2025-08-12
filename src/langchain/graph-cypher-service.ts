import neo4j, { Driver, Session, Record as Neo4jRecord } from "neo4j-driver";
import { BaseChain, ChainInputs } from "langchain/chains";
import { PromptTemplate } from "@langchain/core/prompts";
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import { ChainValues } from "@langchain/core/utils/types";

/**
 * Interface for GraphCypherQAChain configuration
 */
export interface GraphCypherQAChainInput extends ChainInputs {
  llm: BaseLanguageModel;
  driver: Driver;
  cypherPrompt?: PromptTemplate;
  qaPrompt?: PromptTemplate;
  topK?: number;
  returnDirect?: boolean;
  inputKey?: string;
  outputKey?: string;
  defaultDatabase?: string;
}

/**
 * A LangChain for querying Neo4j using Cypher and answering questions
 */
export class GraphCypherQAChain extends BaseChain {
  llm: BaseLanguageModel;
  driver: Driver;
  cypherPrompt: PromptTemplate;
  qaPrompt: PromptTemplate;
  topK: number;
  returnDirect: boolean;
  inputKey: string;
  outputKey: string;
  defaultDatabase?: string;

  constructor(fields: GraphCypherQAChainInput) {
    super(fields);
    this.llm = fields.llm;
    this.driver = fields.driver;
    this.topK = fields.topK ?? 10;
    this.returnDirect = fields.returnDirect ?? false;
    this.inputKey = fields.inputKey ?? "query";
    this.outputKey = fields.outputKey ?? "result";
    this.defaultDatabase = fields.defaultDatabase;

    // Default Cypher generation prompt
    this.cypherPrompt = fields.cypherPrompt ?? PromptTemplate.fromTemplate(
      `You are an expert in converting natural language into Neo4j Cypher queries.
      Convert the following question into a Cypher query that runs against a Neo4j graph database.
      
      
      Question: {question}
      
      Cypher query:`
    );

    // Default QA prompt
    this.qaPrompt = fields.qaPrompt ?? PromptTemplate.fromTemplate(
      `You are an expert in answering questions based on the provided context.
      
      Question: {question}
      
      Neo4j Cypher query: {cypher}
      
      Query results: {context}
      
      Answer the question based on the provided context:`
    );
  }

  get inputKeys(): string[] {
    return [this.inputKey];
  }

  get outputKeys(): string[] {
    return [this.outputKey];
  }

  /**
   * Get a string name for this chain instance.
   */
  _chainType() {
    return "graph_cypher_qa_chain" as const;
  }

  /**
   * Generate a Cypher query from a natural language question using the LLM
   */
  async generateCypherQuery(question: string): Promise<string> {
    const promptValue = await this.cypherPrompt.format({ question });
    const response = await this.llm.invoke(promptValue);
    const text = response.toString();
    
    // Extract only the Cypher query from the response
    const cypherQuery = this.extractCypherFromLLMResponse(text);
    return cypherQuery;
  }

  /**
   * Extract the Cypher query from the LLM response
   */
  private extractCypherFromLLMResponse(text: string): string {
    // Look for query between triple backticks
    const match = text.match(/```(?:cypher)?\n([\s\S]*?)```/i);
    if (match) {
      return match[1].trim();
    }
    
    // If no match with backticks, return the whole text as the query
    // after removing any non-Cypher prefixes like "Cypher query:"
    return text.replace(/^(cypher query:)/i, "").trim();
  }

  /**
   * Execute a Cypher query against Neo4j
   */
  async executeCypher(cypher: string): Promise<Neo4jRecord[]> {
    const session = this.driver.session({
      database: this.defaultDatabase,
    });

    try {
      const result = await session.run(cypher);
      return result.records;
    } finally {
      await session.close();
    }
  }

  /**
   * Format Neo4j records as text for the LLM
   */
  formatRecordsAsText(records: Neo4jRecord[]): string {
    if (records.length === 0) {
      return "No results found.";
    }

    return records.map((record) => {
      const obj: Record<string, any> = {};
      record.keys.forEach((key: any) => {
        obj[key] = this.formatNeo4jValue(record.get(key));
      });
      return JSON.stringify(obj);
    }).join("\n");
  }

  /**
   * Format Neo4j values (nodes, relationships, etc.) for text representation
   */
  private formatNeo4jValue(value: any): any {
    if (value === null || value === undefined) {
      return null;
    }

    // Handle Neo4j Node objects
    if (value.labels && value.properties) {
      return {
        type: "node",
        labels: value.labels,
        properties: { ...value.properties },
      };
    }

    // Handle Neo4j Relationship objects
    if (value.type && value.properties) {
      return {
        type: "relationship",
        relationshipType: value.type,
        properties: { ...value.properties },
      };
    }

    // Handle Neo4j Path objects
    if (value.segments) {
      return {
        type: "path",
        segments: value.segments.map((seg: any) => ({
          start: this.formatNeo4jValue(seg.start),
          relationship: this.formatNeo4jValue(seg.relationship),
          end: this.formatNeo4jValue(seg.end),
        })),
      };
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item) => this.formatNeo4jValue(item));
    }

    // Handle primitive types and regular objects
    return value;
  }

  /**
   * Generate the final answer using the LLM based on the question and query results
   */
  async generateAnswer(question: string, cypher: string, context: string): Promise<string> {
    const promptValue = await this.qaPrompt.format({
      question,
      cypher,
      context,
    });
    
    const response = await this.llm.invoke(promptValue);
    return response.toString();
  }

  /**
   * Run the chain on the specified input
   */
  async _call(values: ChainValues): Promise<ChainValues> {
    const question = values[this.inputKey];
    
    // Step 1: Generate Cypher query
    const cypher = await this.generateCypherQuery(question);
    
    // Step 2: Execute query against Neo4j
    const records = await this.executeCypher(cypher);
    
    // Step 3: Format results
    const context = this.formatRecordsAsText(records.slice(0, this.topK));
    
    // Step 4: If returnDirect is true, return the formatted results directly
    if (this.returnDirect) {
      return { [this.outputKey]: context };
    }
    
    // Step 5: Generate answer using LLM
    const answer = await this.generateAnswer(question, cypher, context);
    
    return { [this.outputKey]: answer };
  }

  /**
   * Static method to create a chain with default configurations
   */
  static fromLLM(
    llm: BaseLanguageModel,
    driver: Driver,
    options: Omit<GraphCypherQAChainInput, "llm" | "driver"> = {}
  ): GraphCypherQAChain {
    return new GraphCypherQAChain({
      llm,
      driver,
      ...options,
    });
  }
}