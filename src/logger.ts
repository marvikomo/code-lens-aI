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

    public writeResults(data: any): void {
        const timestamp = new Date().toISOString().split('T')[0];
        const outputFile = path.join(this.outputDir, `analysis_${timestamp}.json`);
        
        fs.writeFileSync(
            outputFile,
            JSON.stringify(data, null, 2)
        );
    }
}

export const logger = new Logger();
