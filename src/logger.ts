import * as fs from 'fs';
import * as path from 'path';

export enum LogLevel {
    DEBUG = 'DEBUG',
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR'
}

export class Logger {
    private logStream: fs.WriteStream;
    private readonly logDir: string;
    private currentLogFile: string;

    constructor(logDir: string = 'logs') {
        this.logDir = logDir;
        this.setupLogDirectory();
        this.setupNewLogFile();
    }

    private setupLogDirectory(): void {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    private setupNewLogFile(): void {
        const timestamp = new Date().toISOString().split('T')[0];
        this.currentLogFile = path.join(this.logDir, `analysis_${timestamp}.log`);
        
        // Close existing stream if it exists
        if (this.logStream) {
            this.logStream.end();
        }

        // Create new write stream in append mode
        this.logStream = fs.createWriteStream(this.currentLogFile, { flags: 'a' });
    }

    private formatMessage(level: LogLevel, message: string, meta?: any): string {
        const timestamp = new Date().toISOString();
        const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
        return `[${timestamp}] ${level.padEnd(5)} | ${message}${metaStr}\n`;
    }

    private write(level: LogLevel, message: string, meta?: any): void {
        const formattedMessage = this.formatMessage(level, message, meta);
        
        // Write to file
        this.logStream.write(formattedMessage);

        // Also log to console for development
        if (process.env.NODE_ENV !== 'production') {
            console.log(formattedMessage.trim());
        }
    }

    public debug(message: string, meta?: any): void {
        this.write(LogLevel.DEBUG, message, meta);
    }

    public info(message: string, meta?: any): void {
        this.write(LogLevel.INFO, message, meta);
    }

    public warn(message: string, meta?: any): void {
        this.write(LogLevel.WARN, message, meta);
    }

    public error(message: string, meta?: any): void {
        this.write(LogLevel.ERROR, message, meta);
    }


    public close(): void {
        if (this.logStream) {
            this.logStream.end();
        }
    }
}

// Export singleton instance
export const logger = new Logger();