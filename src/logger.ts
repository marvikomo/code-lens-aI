import * as fs from 'fs';
import * as path from 'path';

export class Logger {
    private readonly outputDir: string;

    constructor(outputDir: string = 'output') {
        this.outputDir = outputDir;
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
    }

    public writeResults(data: Map<string, any>): void {
        const timestamp = new Date().toISOString().split('T')[0];
        const outputFile = path.join(this.outputDir, `analysis_${timestamp}.json`);
        
        // Convert Map to a plain object
        const plainObject = Object.fromEntries(
            Array.from(data.entries()).map(([key, value]) => [
                key,
                {
                    path: value.path,
                    language: value.language,
                    functions: Array.from(value.functions.entries()),
                    calls: value.calls,
                    imports: value.imports
                }
            ])
        );
        
        fs.writeFileSync(
            outputFile,
            JSON.stringify(plainObject, null, 2)
        );
    }
}

export const logger = new Logger();
