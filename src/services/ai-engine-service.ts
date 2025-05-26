import { ClassNodeService } from './class-node-service';
import { FunctionNodeService } from './function-node-service';
import { Neo4jClient } from '../db/neo4j-client';

export class AiEngineService {
  private classNodeService: ClassNodeService;
  private functionNodeService: FunctionNodeService;

  constructor(private dbClient: Neo4jClient, private openAIApiKey: string) {
    this.classNodeService = new ClassNodeService(dbClient);
    this.functionNodeService = new FunctionNodeService(dbClient);
  }

  /**
   * Main entrypoint: given a prompt, fetches relevant code context and calls the AI model.
   * @param prompt User's query
   * @param options Optional search parameters
   */
  async answerWithContext(prompt: string, options?: {
    className?: string;
    functionName?: string;
    filePath?: string;
    // Add more options as needed
  }): Promise<{ answer: string, context: any }> {
    // 1. Fetch code context from Neo4j
    let context: any = {};

    // Example: get relevant class (by name or filePath)
    if (options?.className || options?.filePath) {
      context.class = await this.classNodeService.searchClasses({
        name: options.className,
        filePath: options.filePath,
        limit: 1,
      });
    }

    // Example: get relevant function (by name or filePath)
    if (options?.functionName || options?.filePath) {
      // Extend here if you want to fetch function nodes as well
      // context.function = await this.functionNodeService.searchFunctions({
      //   name: options.functionName,
      //   filePath: options.filePath,
      //   limit: 1,
      // });
    }

    // You can expand this to include import nodes, module nodes, etc.

    // 2. Compose context string for LLM
    let contextString = '';
    if (context.class && context.class.length > 0) {
      contextString += `Relevant class:\n${JSON.stringify(context.class, null, 2)}\n`;
    }
    // if (context.function && context.function.length > 0) {
    //   contextString += `Relevant function:\n${JSON.stringify(context.function, null, 2)}\n`;
    // }

    // 3. Call LLM (OpenAI API as example)
    const systemPrompt = `
You are an expert AI code assistant. Use the following code context to answer the user's question as helpfully and precisely as possible.
---
${contextString}
---
User question: ${prompt}
`;

    const answer = await this.queryOpenAI(systemPrompt);

    return { answer, context };
  }

  /**
   * Calls OpenAI's completion API (or substitute this for your own LLM)
   */
  private async queryOpenAI(content: string): Promise<string> {
    // Uses OpenAI's Chat Completions endpoint (gpt-3.5-turbo)
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.openAIApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a helpful code assistant.' },
          { role: 'user', content }
        ],
        max_tokens: 512,
        temperature: 0.2,
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() ?? '';
  }
}