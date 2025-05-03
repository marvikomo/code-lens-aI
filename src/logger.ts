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

    private deepConvertToObject(obj: any): any {
        if (obj instanceof Map) {
          const result: any = {}
          for (const [key, value] of obj.entries()) {
            result[key] = this.deepConvertToObject(value)
          }
          return result
        } else if (Array.isArray(obj)) {
          return obj.map(item => this.deepConvertToObject(item))
        } else if (typeof obj === 'object' && obj !== null) {
          const result: any = {}
          for (const [key, value] of Object.entries(obj)) {
            result[key] = this.deepConvertToObject(value)
          }
          return result
        }
        return obj
      }
    
      public writeResults(data: any, key?: string): void {
        const timestamp = key ?? Date.now().toString()
        const outputFile = path.join(this.outputDir, `analysis_${timestamp}.json`)
    
        const convertedData = this.deepConvertToObject(data)
    
        fs.writeFileSync(outputFile, JSON.stringify(convertedData, null, 2), 'utf8')
        console.log(`Results written to ${outputFile}`)
      }

      public writeApendResults(data: any, key?: string): void {
           
        const timestamp = key ?? Date.now().toString()
        const outputFile = path.join(this.outputDir, `analysis_${timestamp}.json`)
    
        const convertedData = this.deepConvertToObject(data)
    
        fs.appendFileSync(outputFile, JSON.stringify(convertedData, null, 2) + ',\n', 'utf8');
        console.log(`Results written to ${outputFile}`)
      }
}

export const logger = new Logger();
