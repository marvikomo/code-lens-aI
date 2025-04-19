import { CodeLensAI } from './index';
import * as path from 'path';



async function testAnalyze() {
    try {
        const codeLens = new CodeLensAI();
        
        // Get the absolute path to the directory you want to analyze
        const directoryToAnalyze = '/Users/ikponmwosaomorisiagbon/MySites/code-lens-aI/test-dir/test';
        
        console.log('Starting analysis of directory:', directoryToAnalyze);
        
        await codeLens.analyze(directoryToAnalyze, {
            ignoreDirs: ['node_modules', '.git'],
            ignoreFiles: ['package-lock.json']
        });
        
        console.log('Analysis completed successfully');
        
    } catch (error) {
        console.error('Error during analysis:', error);
    }
}

// Run the test
testAnalyze().catch(console.error);