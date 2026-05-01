import * as path from 'path'
import { Neo4jClient } from './db/neo4j-client'
import { CodeAnalyzer } from './analyser/analyser'
import { LanguageRegistry } from './languages/language-registry'
import { Config } from './config'


async function main() {
  try {
    console.log('config', Config)
    console.log('Starting code analysis...')

    // Initialize Neo4j client
    // const neo4jClient = new Neo4jClient(
    //   Config.neo4j.uri,
    //   Config.neo4j.username,
    //   Config.neo4j.password,
    // )

    // await neo4jClient.initialize()

    const neo4jConfig = {
      uri:  Config.neo4j.uri,
      username: Config.neo4j.username,
      password: Config.neo4j.password,
    }

    // Initialize language registry
    const languageRegistry = new LanguageRegistry()
    

    const analyzer = new CodeAnalyzer(neo4jConfig, languageRegistry)

    const directoryToAnalyze = path.resolve(
      process.argv[2] || Config.targetDirectory,
    )
    console.log(`Analyzing: ${directoryToAnalyze}`)

    await analyzer.analyze(directoryToAnalyze, {
      ignoreDirs: ['node_modules', '.git', 'dist', 'build'],
      ignoreFiles: ['package-lock.json'],
    })

   //await neo4jClient.close()
    console.log('Analysis complete!')
  } catch (error) {
    console.error('Error during analysis:', error)
    process.exit(1)
  }
}

main().catch(console.error)
