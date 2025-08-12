import { GraphCypherQAChain } from "@langchain/community/chains/graph_qa/cypher";
import { Neo4jGraph } from "@langchain/community/graphs/neo4j_graph";
import { ChatOpenAI } from "@langchain/openai";
import { Tool } from "@langchain/core/tools";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { StateGraph, MessagesAnnotation, Annotation } from "@langchain/langgraph";
import { ChatPromptTemplate, PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";

import { Config } from '../config';
import { Neo4jClient } from "../db/neo4j-client";
import { z } from "zod";
import { END, START } from "@langchain/langgraph";
import { InMemoryCache } from "@langchain/core/caches"

const graph = new Neo4jGraph({
        url: Config.neo4j.uri,
        username: Config.neo4j.username,
        password: Config.neo4j.password,
        database: "neo4j"
      });
  
  const neo4jClient = new Neo4jClient(
      Config.neo4j.uri,
      Config.neo4j.username,
      Config.neo4j.password
    );

  
  async function summarizeAgent() {


      await neo4jClient.initialize();

      console.log("Connecting to Neo4j...");
      const schema = await neo4jClient.getSchema();

       const GraphState = Annotation.Root({
        ...MessagesAnnotation.spec,  // Supports ALL message types (HumanMessage, AIMessage, ToolMessage, SystemMessage)
      
        // ADD your custom properties
        topic: Annotation<string>,
        queriesAsked: Annotation<string[]>,
        functions: Annotation<any[]>,
        isComplete: Annotation<boolean>,
        iterationCount: Annotation<number>,
        pendingDependencies: Annotation<string[]>,
        resolvedDependencies: Annotation<Record<string, any>>,
        codeStructure: Annotation<any>,
        currentPhase: Annotation<'initial' | 'analysis' | 'synthesis' | 'complete'>
      });


      const queryGraph = tool(
          async ({ query }) => {
          let res = await neo4jClient.query(query)
          console.log("query res", res)
          return JSON.stringify(res);
        }, {
          name: "search",
          description: `Execute Cypher queries against the Neo4j database.

              Here is the SCHEMA: ${JSON.stringify(schema)}


              Use this schema information to write accurate Cypher queries. Focus on:
              - Using correct node labels and relationship types
              - Referencing valid properties
              - Following Neo4j syntax patterns

              Examples for this schema:
              - Find Function nodes: MATCH (f:Function) WHERE f.name = 'test' RETURN f
              - Get relationships: MATCH (f:Function)-[r]-(connected) WHERE f.name = 'test' RETURN type(r), connected
              - Explore patterns: MATCH (f:Function {name: 'test'})-[:CALLS]->(other:Function) RETURN other.name`,
              
          schema: z.object({
              query: z.string().describe("The query to use in your search."),
            }),
          });
    
     async function extractTopFunctions(state: typeof GraphState.State) {
  
        try {
          const query = `
           MATCH (f:Function)<-[:REFERS_TO]-(c:Call)
            WITH f, count(c) AS callCount
            ORDER BY callCount DESC
            LIMIT 10
            OPTIONAL MATCH (f)-[:DEFINED_IN]->(definedMod:Module)
            OPTIONAL MATCH (exportingMod:Module)-[:EXPORTS]->(exp:Export)-[:EXPORTS_ENTITY]->(f)
            OPTIONAL MATCH (cls:Class)-[:HAS_METHOD]->(f)
            OPTIONAL MATCH (f)-[:CALLS]->(co:Call)-[:REFERS_TO]->(calleeF:Function)
            OPTIONAL MATCH (callerF:Function)-[:CALLS]->(ci:Call)-[:REFERS_TO]->(f)
          RETURN
            f.id                  AS functionId,
            f.name                AS functionName,
            f.fullName            AS fullyQualifiedName,
            f.sourceCode          AS sourceCode,
            callCount,
            definedMod { .id, .name, .path }                                           AS definingModule,
            collect(DISTINCT exportingMod { .id, .name, .path })                        AS exportingModules,
            collect(DISTINCT cls { .id, .name })                                        AS implementingClasses,
            collect(DISTINCT calleeF { id: calleeF.id, name: calleeF.name, fullName: calleeF.fullName }) AS calledFunctions,
            collect(DISTINCT callerF { id: callerF.id, name: callerF.name, fullName: callerF.fullName }) AS callingFunctions
          `;


          let res = await neo4jClient.query(query)
 

         return {
          functions: res
         }
        
        
      }catch(error) {
        console.log("error", error)
      }

    }


  async function processBatch(state: typeof GraphState.State) {
      // if (state.functions.length > 0) {
      //   return state;
      // }
    

  
    
     
  }








}

summarizeAgent();

  //  const tools = [new TavilySearchResults({ maxResults: 3, apiKey: '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' })];

  //   const toolNode = new ToolNode(tools);

    //model.bindTools(tools);

// let model = new ChatOpenAI({
//       modelName: "gpt-4",
//       temperature: 0,
//       apiKey: Config.openaiApiKey
//     }).bindTools(tools);

    //model.bindTools(tools);

async function analyse() {

      await neo4jClient.initialize();

   console.log("Connecting to Neo4j...");
   const schema = await neo4jClient.getSchema();
   console.log("schema", schema)

   return

    const queryGraph = tool(
      async ({ query }) => {
       let res = await neo4jClient.query(query)
       console.log("query res", res)
       return JSON.stringify(res);
    }, {
      name: "search",
       description: `Execute Cypher queries against the Neo4j database.

          Here is the SCHEMA: ${JSON.stringify(schema)}


          Use this schema information to write accurate Cypher queries. Focus on:
          - Using correct node labels and relationship types
          - Referencing valid properties
          - Following Neo4j syntax patterns

          Examples for this schema:
          - Find Function nodes: MATCH (f:Function) WHERE f.name = 'test' RETURN f
          - Get relationships: MATCH (f:Function)-[r]-(connected) WHERE f.name = 'test' RETURN type(r), connected
          - Explore patterns: MATCH (f:Function {name: 'test'})-[:CALLS]->(other:Function) RETURN other.name`,
          
       schema: z.object({
          query: z.string().describe("The query to use in your search."),
        }),
       });

  //   const prompt = ChatPromptTemplate.fromTemplate(
  //   `Execute Cypher queries against the Neo4j database.

  //         Here is the SCHEMA: ${JSON.stringify(schema)}


  //         Use this schema information to write accurate Cypher queries. Focus on:
  //         - Using correct node labels and relationship types
  //         - Referencing valid properties
  //         - Following Neo4j syntax patterns

  //         Examples for this schema:
  //         - Find Function nodes: MATCH (f:Function) WHERE f.name = 'test' RETURN f
  //         - Get relationships: MATCH (f:Function)-[r]-(connected) WHERE f.name = 'test' RETURN type(r), connected
  //         - Explore patterns: MATCH (f:Function {name: 'test'})-[:CALLS]->(other:Function) RETURN other.name`,
  // );

      const GraphState = Annotation.Root({
      ...MessagesAnnotation.spec,  // Supports ALL message types (HumanMessage, AIMessage, ToolMessage, SystemMessage)
      
      // ADD your custom properties
      topic: Annotation<string>,
      queriesAsked: Annotation<string[]>,
      allResults: Annotation<any[]>,
      isComplete: Annotation<boolean>,
      iterationCount: Annotation<number>,
      pendingDependencies: Annotation<string[]>,
      resolvedDependencies: Annotation<Record<string, any>>,
      codeStructure: Annotation<any>,
      currentPhase: Annotation<'initial' | 'analysis' | 'synthesis' | 'complete'>
    });

    const model = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0,
      cache: new InMemoryCache(),
      apiKey: Config.openaiApiKey
    }).bindTools([queryGraph]);

     const toolNode = new ToolNode([queryGraph]);
    
      // const chain = prompt.pipe(model);

    //   const topicPrompt = PromptTemplate.fromTemplate(`
    //   Given this database schema context:
    //   {schema}
      
    //   Extract the main topic/subject from this query: "{query}"
      
    //   Identify the primary code element, method, function, class, or concept being asked about.
    //   Use the schema context to understand what entities exist in the codebase.
    //   Return only the main topic name without additional explanation:
    // `);
    
    // const topicChain = RunnableSequence.from([
    //   topicPrompt,
    //   model,
    //   new StringOutputParser()
    // ]);
    
    // return topicChain.invoke({ 
    //   query,
    //   schema: schema.substring(0, 1000) // Limit schema length to avoid token limits
    // });


    // Define the function that calls the model
    async function callModel(state:  typeof GraphState.State) {
      const systemMessage = new SystemMessage(`You are a codebase analysis assistant with access to a Neo4j database containing code structure information.

        When users ask about specific functions, methods, classes, or code elements, you MUST use the cypher_query tool to search the database.

        For example, if asked about "derivedMethod", you should:
        1. Use the cypher_query tool to find the function
        2. Use additional queries to explore its relationships
        3. Analyze the results to provide comprehensive information

        DO NOT provide generic programming answers - always search the database first for specific code elements.`);

        const messages = [systemMessage, ...state.messages];
          const response = await model.invoke(messages);
          console.log("response zone", response)
          // We return a list, because this will get added to the existing list
          return { messages: [response] };
    }

    function shouldContinue(state: typeof GraphState.State): string {
       const { messages } = state;
        const lastMessage = messages[messages.length - 1];
       console.log("last message", lastMessage)
        // If the LLM makes a tool call, then we route to the "tools" node
        if ("tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls.length) {
         console.log("---DECISION: RETRIEVE---");
         return "tools";
       }
        // Otherwise, we stop (reply to the user) using the special "__end__" node
        return "__end__";
      }

      function shouldCheckIfSufficientOrFollowUpBaseOnSchema(state: typeof GraphState.State) {
  
       }


     const workflow = new StateGraph(GraphState)
      .addNode("agent", callModel)
      .addEdge("__start__", "agent") // __start__ is a special name for the entrypoint
      .addNode("tools", toolNode)
      .addEdge("tools", "agent")
      .addConditionalEdges("agent", shouldContinue);

   
      // Finally, we compile it into a LangChain Runnable.
        const app = workflow.compile();

        // Use the agent
        const res = await app.invoke({
          messages: [new HumanMessage("describe the code structure of derivedMethod")],
        });

        console.log("res", res)

        console.log("SECOND PHASE ========================>")

         const res1 = await app.invoke({
          messages: [...res.messages, new HumanMessage("is the implementation of derivedMethod correct?")],
        });

             console.log("second res", res1)


}


analyse();













// Custom state annotation that extends MessagesAnnotation with our specific fields
// const GraphState = Annotation.Root({
//   ...MessagesAnnotation.spec,
//   topic: Annotation<string>,
//   queriesAsked: Annotation<string[]>,
//   allResults: Annotation<any[]>,
//   isComplete: Annotation<boolean>,
//   iterationCount: Annotation<number>,
//   pendingDependencies: Annotation<string[]>, // Track what we still need to investigate
//   resolvedDependencies: Annotation<Record<string, any>>, // Track what we've already found
//   codeStructure: Annotation<any> // Store parsed code structure
// });

// class Neo4jQueryTool extends Tool {
//   name = "neo4j_query";
//   description = "Query the Neo4j database with natural language to get information about code structure, methods, and their implementations";
  
//   private chain: GraphCypherQAChain;
  
//   constructor(chain: GraphCypherQAChain) {
//     super();
//     this.chain = chain;
//   }

//   async _call(input: string): Promise<string> {
//     try {
//       const result = await this.chain.invoke({
//         query: input
//       });
//       return JSON.stringify({
//         answer: result.result,
//         generatedCypher: result.intermediateSteps?.query,
//         databaseResults: result.intermediateSteps?.context
//       }, null, 2);
//     } catch (error) {
//       return `Error querying Neo4j: ${error.message}`;
//     }
//   }
// }

// class Neo4jIterativeAgent {
//   private graph: Neo4jGraph;
//   private model: ChatOpenAI;
//   private chain: GraphCypherQAChain;
//   private neo4jTool: Neo4jQueryTool;
//   private workflow: any;

//   constructor() {
//     this.model = new ChatOpenAI({
//       modelName: "gpt-4",
//       temperature: 0,
//       apiKey: Config.openaiApiKey
//     });
//   }

//   async initialize() {
//     try {
//       // Create the Neo4jGraph instance
//       this.graph = new Neo4jGraph({
//         url: Config.neo4j.uri,
//         username: Config.neo4j.username,
//         password: Config.neo4j.password,
//         database: "neo4j"
//       });

//       console.log("Connecting to Neo4j...");
//       await this.graph.refreshSchema();
//       const schema = this.graph.getSchema();
//       console.log("✅ Connected to Neo4j successfully");
      
//       // Show a condensed version of the schema for debugging
//       const schemaLines = schema.split('\n').slice(0, 10);
//       console.log("Database Schema (first 10 lines):", schemaLines.join('\n'));
//       console.log("...(truncated)");

//       // Create the GraphCypherQAChain
//       this.chain = GraphCypherQAChain.fromLLM({
//         llm: this.model,
//         graph: this.graph,
//         returnDirect: false,
//         returnIntermediateSteps: true
//       });

//       // Create the Neo4j query tool
//       this.neo4jTool = new Neo4jQueryTool(this.chain);

//       // Setup the workflow
//       this.setupWorkflow();

//       return this.chain;
      
//       console.log("✅ Agent initialized successfully");
//     } catch (error) {
//       console.error("❌ Failed to initialize Neo4j connection:", error);
//       throw new Error(`Neo4j initialization failed: ${error.message}. Please check your connection details in Config.`);
//     }
//   }

//   setupWorkflow() {
//     // Define the workflow nodes
//     const workflow = new StateGraph(GraphState)
//       .addNode("initialQuery", this.initialQuery.bind(this))
//       .addNode("parseCodeStructure", this.parseCodeStructure.bind(this))
//       .addNode("identifyDependencies", this.identifyDependencies.bind(this))
//       .addNode("investigateDependency", this.investigateDependency.bind(this))
//       .addNode("evaluateCompleteness", this.evaluateCompleteness.bind(this))
//       .addNode("synthesizeFinal", this.synthesizeFinal.bind(this))
      
//       // Define the flow
//       .addEdge("__start__", "initialQuery")
//       .addEdge("initialQuery", "parseCodeStructure")
//       .addEdge("parseCodeStructure", "identifyDependencies")
//       .addConditionalEdges(
//         "identifyDependencies",
//         this.shouldInvestigateDependency.bind(this),
//         {
//           investigate: "investigateDependency",
//           evaluate: "evaluateCompleteness"
//         }
//       )
//       .addEdge("investigateDependency", "identifyDependencies") // Loop back to check for more dependencies
//       .addConditionalEdges(
//         "evaluateCompleteness",
//         this.shouldContinue.bind(this),
//         {
//           synthesize: "synthesizeFinal",
//           __end__: "__end__"
//         }
//       );

//     this.workflow = workflow.compile();
//   }

//   // Helper function to extract string content from message
//   private getMessageContent(message: any): string {
//     if (typeof message.content === 'string') {
//       return message.content;
//     } else if (Array.isArray(message.content)) {
//       // Handle complex content by extracting text parts
//       return message.content
//         .filter((part: any) => part.type === 'text')
//         .map((part: any) => part.text)
//         .join(' ');
//     }
//     return String(message.content);
//   }

//   // Helper function to safely parse JSON results
//   private safeParseResult(result: string): any {
//     try {
//       return JSON.parse(result);
//     } catch (error) {
//       console.log("Failed to parse JSON result:", result);
//       // Return a structured error object if parsing fails
//       return {
//         answer: result,
//         generatedCypher: null,
//         databaseResults: null,
//         isError: true
//       };
//     }
//   }

//   // Initial query node
//   async initialQuery(state: typeof GraphState.State) {
//     console.log("🔍 Executing initial query...");
    
//     const lastMessage = state.messages[state.messages.length - 1];
//     const query = this.getMessageContent(lastMessage);
    
//     // Extract topic from the query
//     const topic = await this.extractTopic(query);
    
//     // Generate a more specific query to find the actual method implementation
//     const specificQuery = `Find the implementation/definition of the method "${topic}" including its code body, variables, method calls, and return statement`;
    
//     console.log(`Specific query: ${specificQuery}`);
    
//     // Execute the query
//     const result = await this.neo4jTool._call(specificQuery);
//     const parsedResult = this.safeParseResult(result);
    
//     // Check if there was an error
//     if (parsedResult.isError) {
//       console.error("Neo4j query error:", parsedResult.answer);
//       return {
//         messages: [
//           ...state.messages,
//           new AIMessage(`Error executing query: ${parsedResult.answer}`)
//         ],
//         topic,
//         queriesAsked: [specificQuery],
//         allResults: [parsedResult],
//         iterationCount: 1,
//         pendingDependencies: [],
//         resolvedDependencies: {},
//         codeStructure: null,
//         isComplete: true // Stop on error
//       };
//     }
    
//     console.log("Initial query result:", parsedResult.answer);
//     console.log("Generated Cypher:", parsedResult.generatedCypher);
    
//     return {
//       messages: [
//         ...state.messages,
//         new AIMessage(`Initial query result: ${parsedResult.answer}`)
//       ],
//       topic,
//       queriesAsked: [specificQuery],
//       allResults: [parsedResult],
//       iterationCount: 1,
//       pendingDependencies: [],
//       resolvedDependencies: {},
//       codeStructure: null
//     };
//   }

//   // Evaluate if we have complete information
//   async evaluateCompleteness(state: typeof GraphState.State) {
//     console.log("🧠 Evaluating information completeness...");
    
//     const { resolvedDependencies, allResults, topic } = state;
//     const allInfo = allResults.map(r => r.answer).join('\n\n');
//     const dependencyInfo = Object.entries(resolvedDependencies)
//       .map(([dep, info]: [string, any]) => `${dep}: ${info.result}`)
//       .join('\n');
    
//     const evaluationPrompt = PromptTemplate.fromTemplate(`
//       Analyze if we have complete information about "{topic}".
      
//       Main information:
//       {all_info}
      
//       Dependency information resolved:
//       {dependency_info}
      
//       For a complete understanding, we need:
//       1. What the main topic does/is
//       2. All dependencies resolved (what they are and what they return)
//       3. The complete data flow and return structure
//       4. No missing links in the dependency chain
      
//       Based on the information above, is our understanding COMPLETE or INCOMPLETE?
      
//       Answer with only: COMPLETE or INCOMPLETE
//     `);
    
//     const evaluationChain = RunnableSequence.from([
//       evaluationPrompt,
//       this.model,
//       new StringOutputParser()
//     ]);
    
//     const evaluation = await evaluationChain.invoke({
//       topic: topic || "the requested topic",
//       all_info: allInfo,
//       dependency_info: dependencyInfo
//     });
    
//     console.log("Evaluation result:", evaluation);
    
//     const isComplete = evaluation.trim().startsWith("COMPLETE");
    
//     return {
//       ...state,
//       isComplete,
//       messages: [
//         ...state.messages,
//         new SystemMessage(`Evaluation: ${evaluation}`)
//       ]
//     };
//   }

//   // Parse code structure from the initial result
//   async parseCodeStructure(state: typeof GraphState.State) {
//     console.log("🔍 Parsing code structure...");
    
//     const latestResult = state.allResults[state.allResults.length - 1];
//     const codeInfo = latestResult.answer;
    
//     // Check if we actually got code implementation
//     if (!codeInfo.includes('{') && !codeInfo.includes('=') && !codeInfo.includes('return')) {
//       console.log("No actual code implementation found, trying alternative query");
      
//       // Try a more specific query for method body/implementation
//       const implementationQuery = `Show me the complete source code and implementation of ${state.topic} method including all variables, assignments, method calls, and return statements`;
      
//       const result = await this.neo4jTool._call(implementationQuery);
//       const parsedResult = this.safeParseResult(result);
      
//       if (!parsedResult.isError) {
//         // Update state with the new result
//         state.allResults.push(parsedResult);
//         state.queriesAsked.push(implementationQuery);
//         console.log("Found implementation:", parsedResult.answer);
//       }
//     }
    
//     // Get the latest (hopefully code) result
//     const latestCodeResult = state.allResults[state.allResults.length - 1];
//     const actualCodeInfo = latestCodeResult.answer;
    
//     const parsePrompt = PromptTemplate.fromTemplate(`
//       Analyze this code information and extract the actual code structure:
      
//       {code_info}
      
//       Look for and identify:
//       1. Variable declarations (let, const, var) and their assignments
//       2. Method/function calls (object.method(), function())
//       3. Return statements
//       4. Import statements or references
      
//       Extract ONLY from actual code, not from descriptions or explanations.
      
//       Return a JSON structure with:
//       {{
//         "variables": [{{ "name": "variableName", "assignedFrom": "what it's assigned to" }}],  
//         "methodCalls": [{{ "object": "ObjectName", "method": "methodName", "fullCall": "full method call" }}],
//         "returnValue": "what is returned",
//         "dependencies": ["actual code dependencies like variable names, object names"]
//       }}
      
//       If no actual code is found, return empty arrays.
      
//       JSON:
//     `);
    
//     const parseChain = RunnableSequence.from([
//       parsePrompt,
//       this.model,
//       new StringOutputParser()
//     ]);
    
//     const structureResponse = await parseChain.invoke({
//       code_info: actualCodeInfo
//     });
    
//     let codeStructure;
//     try {
//       // Try to parse the JSON response
//       const jsonMatch = structureResponse.match(/\{[\s\S]*\}/);
//       codeStructure = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
//     } catch (error) {
//       console.log("Failed to parse structure JSON, using fallback");
//       codeStructure = { dependencies: [], variables: [], methodCalls: [], returnValue: null };
//     }
    
//     console.log("Parsed code structure:", JSON.stringify(codeStructure, null, 2));
    
//     return {
//       ...state,
//       codeStructure,
//       allResults: state.allResults, // Keep all results including any new ones
//       queriesAsked: state.queriesAsked, // Keep all queries including any new ones
//       messages: [
//         ...state.messages,
//         new SystemMessage(`Parsed code structure: ${JSON.stringify(codeStructure, null, 2)}`)
//       ]
//     };
//   }

//   // Identify dependencies that need investigation
//   async identifyDependencies(state: typeof GraphState.State) {
//     console.log("🎯 Identifying dependencies to investigate...");
    
//     const { codeStructure, resolvedDependencies } = state;
    
//     if (!codeStructure) {
//       return {
//         ...state,
//         pendingDependencies: []
//       };
//     }
    
//     // Collect all potential dependencies
//     const allDependencies = [
//       ...(codeStructure.dependencies || []),
//       ...(codeStructure.variables || []).map((v: any) => v.assignedFrom).filter(Boolean),
//       ...(codeStructure.methodCalls || []).map((m: any) => `${m.object}.${m.method}`).filter(Boolean)
//     ];
    
//     // Filter out already resolved dependencies
//     const pendingDependencies = allDependencies.filter(dep => 
//       dep && !resolvedDependencies[dep] && dep !== state.topic
//     );
    
//     console.log("All dependencies found:", allDependencies);
//     console.log("Pending dependencies:", pendingDependencies);
//     console.log("Already resolved:", Object.keys(resolvedDependencies));
    
//     return {
//       ...state,
//       pendingDependencies,
//       messages: [
//         ...state.messages,
//         new SystemMessage(`Identified ${pendingDependencies.length} pending dependencies: ${pendingDependencies.join(', ')}`)
//       ]
//     };
//   }

//   // Investigate a specific dependency
//   async investigateDependency(state: typeof GraphState.State) {
//     console.log("🔎 Investigating dependency...");
    
//     const { pendingDependencies, resolvedDependencies } = state;
    
//     if (!pendingDependencies || pendingDependencies.length === 0) {
//       return state;
//     }
    
//     // Take the first pending dependency
//     const currentDependency = pendingDependencies[0];
//     console.log(`Investigating: ${currentDependency}`);
    
//     // Remove this dependency from pending list (declare early)
//     const remainingPendingDependencies = pendingDependencies.slice(1);
    
//     // Generate a specific query for this dependency
//     const dependencyQuery = await this.generateDependencyQuery(currentDependency, state.codeStructure);
//     console.log(`Generated query: ${dependencyQuery}`);
    
//     // Execute the query
//     const result = await this.neo4jTool._call(dependencyQuery);
//     const parsedResult = this.safeParseResult(result);
    
//     // Check if there was an error
//     if (parsedResult.isError) {
//       console.error(`Error investigating ${currentDependency}:`, parsedResult.answer);
//       // Mark this dependency as resolved with error info
//       const newResolvedDependencies = {
//         ...resolvedDependencies,
//         [currentDependency]: {
//           query: dependencyQuery,
//           result: `Error: ${parsedResult.answer}`,
//           cypher: null,
//           isError: true
//         }
//       };
      
//       return {
//         ...state,
//         messages: [
//           ...state.messages,
//           new AIMessage(`Error investigating "${currentDependency}": ${parsedResult.answer}`)
//         ],
//         queriesAsked: [...state.queriesAsked, dependencyQuery],
//         allResults: [...state.allResults, parsedResult],
//         pendingDependencies: remainingPendingDependencies,
//         resolvedDependencies: newResolvedDependencies,
//         iterationCount: state.iterationCount + 1
//       };
//     }
    
//     console.log(`Result for ${currentDependency}:`, parsedResult.answer);
    
//     // Update resolved dependencies
//     const newResolvedDependencies = {
//       ...resolvedDependencies,
//       [currentDependency]: {
//         query: dependencyQuery,
//         result: parsedResult.answer,
//         cypher: parsedResult.generatedCypher
//       }
//     };
    
//     return {
//       ...state,
//       messages: [
//         ...state.messages,
//         new AIMessage(`Dependency investigation result for "${currentDependency}": ${parsedResult.answer}`)
//       ],
//       queriesAsked: [...state.queriesAsked, dependencyQuery],
//       allResults: [...state.allResults, parsedResult],
//       pendingDependencies: remainingPendingDependencies,
//       resolvedDependencies: newResolvedDependencies,
//       iterationCount: state.iterationCount + 1
//     };
//   }

//   // Generate specific query for a dependency
//   async generateDependencyQuery(dependency: string, codeStructure: any): Promise<string> {
//     // Get the actual database schema to generate valid queries
//     const schema = this.graph.getSchema();
    
//     const queryPrompt = PromptTemplate.fromTemplate(`
//       Generate a natural language query to investigate this code dependency: "{dependency}"
      
//       Database schema context (use this to understand what nodes and properties exist):
//       {schema}
      
//       Code context:
//       {context}
      
//       The dependency "{dependency}" could be:
//       - A variable that references another object/value
//       - A method call on an object (like EnhancedApiService.create)
//       - An imported module or class
//       - A property or field
      
//       Generate a natural language query (NOT Cypher) that asks about:
//       1. What is "{dependency}"?
//       2. What does it return or contain?
//       3. Where is it defined or implemented?
      
//       Focus on finding the actual implementation/definition, not general descriptions.
      
//       Natural language query:
//     `);
    
//     const queryChain = RunnableSequence.from([
//       queryPrompt,
//       this.model,
//       new StringOutputParser()
//     ]);
    
//     return queryChain.invoke({
//       dependency,
//       context: JSON.stringify(codeStructure, null, 2),
//       schema: schema.substring(0, 2000) // Limit schema length
//     });
//   }

//   // Decision function for dependency investigation
//   shouldInvestigateDependency(state: typeof GraphState.State) {
//     const { pendingDependencies, iterationCount } = state;
    
//     // Stop if we've reached max iterations
//     if (iterationCount >= 10) {
//       console.log("Max iterations reached");
//       return "evaluate";
//     }
    
//     // Continue if there are pending dependencies
//     if (pendingDependencies && pendingDependencies.length > 0) {
//       console.log(`${pendingDependencies.length} dependencies pending investigation`);
//       return "investigate";
//     }
    
//     // No more dependencies to investigate
//     console.log("All dependencies investigated, moving to evaluation");
//     return "evaluate";
//   }

//   // Synthesize final comprehensive answer
//   async synthesizeFinal(state: typeof GraphState.State) {
//     console.log("📋 Synthesizing final comprehensive answer...");
    
//     const { allResults, resolvedDependencies, topic, codeStructure } = state;
    
//     const mainInfo = allResults.map((r, i) => 
//       `Query ${i + 1}: ${state.queriesAsked[i]}\nResult: ${r.answer}`
//     ).join('\n\n---\n\n');
    
//     const dependencyInfo = Object.entries(resolvedDependencies)
//       .map(([dep, info]: [string, any]) => 
//         `**${dep}**:\n${info.result}`
//       ).join('\n\n');
    
//     const synthesisPrompt = PromptTemplate.fromTemplate(`
//       Create a comprehensive analysis of "{topic}" based on all gathered information.
      
//       Main Information:
//       {main_info}
      
//       Dependency Analysis:
//       {dependency_info}
      
//       Code Structure:
//       {code_structure}
      
//       Provide a complete explanation with:
      
//       ## Overview
//       What is {topic} and what does it do?
      
//       ## Implementation Details  
//       How does it work internally? What are the key steps?
      
//       ## Dependencies
//       What external components does it depend on and what do they provide?
      
//       ## Data Flow & Return Structure
//       Trace the complete data flow from input to output. What exactly does it return and what is the structure?
      
//       ## Complete Data Structure
//       Based on all the dependency analysis, provide the exact data structure that {topic} returns.
//     `);
    
//     const synthesisChain = RunnableSequence.from([
//       synthesisPrompt,
//       this.model,  
//       new StringOutputParser()
//     ]);
    
//     const finalAnswer = await synthesisChain.invoke({
//       topic: topic || "the requested topic",
//       main_info: mainInfo,
//       dependency_info: dependencyInfo,
//       code_structure: JSON.stringify(codeStructure, null, 2)
//     });
    
//     return {
//       ...state,
//       messages: [
//         ...state.messages,
//         new AIMessage(finalAnswer)
//       ]
//     };
//   }

//   // Decision function for workflow routing
//   shouldContinue(state: typeof GraphState.State) {
//     // Stop if we've reached max iterations
//     if (state.iterationCount >= 10) {
//       console.log("Max iterations reached, synthesizing final answer");
//       return "synthesize";
//     }
    
//     // Stop if information is complete
//     if (state.isComplete) {
//       console.log("Information is complete, synthesizing final answer");
//       return "synthesize";
//     }
    
//     // This shouldn't happen in the new flow, but just in case
//     console.log("Unexpected state, synthesizing final answer");
//     return "synthesize";
//   }

//   // Helper to extract topic from initial query
//   async extractTopic(query: string): Promise<string> {
//     // Get the current database schema for context
//     const schema = this.graph.getSchema();
    
//     const topicPrompt = PromptTemplate.fromTemplate(`
//       Given this database schema context:
//       {schema}
      
//       Extract the main topic/subject from this query: "{query}"
      
//       Identify the primary code element, method, function, class, or concept being asked about.
//       Use the schema context to understand what entities exist in the codebase.
//       Return only the main topic name without additional explanation:
//     `);
    
//     const topicChain = RunnableSequence.from([
//       topicPrompt,
//       this.model,
//       new StringOutputParser()
//     ]);
    
//     return topicChain.invoke({ 
//       query,
//       schema: schema.substring(0, 1000) // Limit schema length to avoid token limits
//     });
//   }

//   // Main execution method
//   async query(question: string) {
//     const initialState = {
//       messages: [new HumanMessage(question)],
//       topic: "",
//       queriesAsked: [],
//       allResults: [],
//       isComplete: false,
//       iterationCount: 0,
//       pendingDependencies: [],
//       resolvedDependencies: {},
//       codeStructure: null
//     };

//     console.log("🚀 Starting iterative Neo4j querying process...");
//     console.log("Initial question:", question);
    
//     const finalState = await this.workflow.invoke(initialState);
    
//     // Get the final answer
//     const finalMessage = finalState.messages[finalState.messages.length - 1];
//     const finalAnswer = this.getMessageContent(finalMessage);
    
//     return {
//       answer: finalAnswer,
//       totalQueries: finalState.queriesAsked.length,
//       allQueries: finalState.queriesAsked,
//       allResults: finalState.allResults,
//       resolvedDependencies: finalState.resolvedDependencies,
//       codeStructure: finalState.codeStructure
//     };
//   }
// }

// // Main execution function
// async function main() {
//   try {
//     console.log("🚀 Initializing Neo4j Iterative Agent...");
//     const agent = new Neo4jIterativeAgent();
//     let chain = await agent.initialize();
    
//     console.log("🔍 Starting query execution...");

//        const res = await chain.invoke({
//        query: "Find derivedMethod"
//      });
//           console.log("Generated Cypher:", res.intermediateSteps);

//      console.log("Answer:", res.result);



//     // const result = await agent.query(
//     //   "I want to understand what derivedMethod is and the complete data structure it returns"
//     // );
    
//     // console.log("\n" + "=".repeat(80));
//     // console.log("🎯 FINAL COMPREHENSIVE ANSWER");
//     // console.log("=".repeat(80));
//     // console.log(result.answer);
    
//     // console.log("\n" + "-".repeat(50));
//     // console.log(`📊 Summary: ${result.totalQueries} queries executed`);
//     // console.log("Queries asked:");
//     // result.allQueries.forEach((q, i) => {
//     //   console.log(`${i + 1}. ${q}`);
//     // });
    
//     // if (Object.keys(result.resolvedDependencies).length > 0) {
//     //   console.log("\n🔗 Dependencies resolved:");
//     //   Object.keys(result.resolvedDependencies).forEach(dep => {
//     //     console.log(`- ${dep}`);
//     //   });
//     // }
    
//   } catch (error) {
//     console.error("❌ Application error:", error);
    
//     // Provide helpful error messages based on common issues
//     if (error.message.includes('Neo4j')) {
//       console.error("\n💡 Troubleshooting tips:");
//       console.error("1. Make sure Neo4j is running on the specified port");
//       console.error("2. Check your connection details in Config");
//       console.error("3. Verify database credentials");
//       console.error("4. Ensure the database contains the expected data");
//     }
    
//     if (error.message.includes('OpenAI') || error.message.includes('API')) {
//       console.error("\n💡 Check your OpenAI API key in Config");
//     }
//   }
// }

// //main();

// // import { GraphCypherQAChain } from "@langchain/community/chains/graph_qa/cypher";
// // import { Neo4jGraph } from "@langchain/community/graphs/neo4j_graph";
// // import { createOpenAIFunctionsAgent, AgentExecutor } from "langchain/agents";
// // import { ChatOpenAI } from "@langchain/openai";
// // import neo4j, { Driver, Session, Result } from 'neo4j-driver';

// // import { Config } from '../config';

// // async function main() {
// //   try {
// //     // Neo4j connection details
// //     const url = "neo4j://localhost:7687";
// //     const username = "neo4j";
// //     const password = "your-password";
    
// //     // Create the Neo4jGraph instance
// //     const graph = new Neo4jGraph({
// //       url: Config.neo4j.uri,
// //       username: Config.neo4j.username,
// //       password: Config.neo4j.password,
// //       database: "neo4j"
// //     });

// //       await graph.refreshSchema();
// //     const schema = graph.getSchema();
// //     console.log("Database Schema:", schema);

// //     // Initialize the language model
// //     const model = new ChatOpenAI({
// //       modelName: "gpt-4", // or "gpt-3.5-turbo"
// //       temperature: 0,
// //       apiKey: Config.openaiApiKey
// //     });



// //     // Create the GraphCypherQAChain
// //     const chain = GraphCypherQAChain.fromLLM({
// //       llm: model,
// //       graph: graph,
// //       returnDirect: false,
// //       returnIntermediateSteps: true // Set to true to see generated Cypher queries
// //     });

// //     // Execute the chain
// //     console.log("Querying Neo4j...");
// //     const res = await chain.invoke({
// //       query: "I want to understand what derivedMethod and the data structure it returns"
// //     });

// //     console.log("Result:", res);
    
// //     // You can access different parts of the result
// //     if (res.result) {
// //       console.log("Answer:", res.result);
// //     }
    
// //     if (res.intermediateSteps) {
// //       console.log("Generated Cypher:", res.intermediateSteps);
// //       console.log("Database Results:", res.intermediateSteps.context);
// //     }

// //   } catch (error) {
// //     console.error("Application error:", error);
// //   }
// // }

// // main();