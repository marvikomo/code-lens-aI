import * as path from 'path';
import { Neo4jClient } from './db/neo4j-client';
import { CodeAnalyzer } from './analyser/analyser';
import { LanguageRegistry } from './languages/language-registry';
import { Config } from './config';

async function main() {
  try {
    console.log("config", Config)
    console.log('Starting code analysis...');
    
    // Initialize Neo4j client
    const neo4jClient = new Neo4jClient(
      Config.neo4j.uri,
      Config.neo4j.username,
      Config.neo4j.password
    );
    
    await neo4jClient.initialize();
    
    // Initialize language registry
    const languageRegistry = new LanguageRegistry();
    
    // Initialize and run analyzer
    const analyzer = new CodeAnalyzer(neo4jClient, languageRegistry);
    const directoryToAnalyze = '/Users/ikponmwosaomorisiagbon/MySites/code-lens-aI/test-dir/export';
    
    await analyzer.analyze(directoryToAnalyze, {
        ignoreDirs: ['node_modules', '.git'],
        ignoreFiles: ['package-lock.json']
    });
    
   
    
    await neo4jClient.close();
    console.log('Analysis complete!');
  } catch (error) {
    console.error('Error during analysis:', error);
    process.exit(1);
  }
}


  main().catch(console.error);
