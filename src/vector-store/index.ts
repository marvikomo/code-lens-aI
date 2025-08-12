import { OpenAIEmbeddings } from '@langchain/openai'
import { MemoryVectorStore } from 'langchain/vectorstores/memory'
import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase'
import { createClient } from '@supabase/supabase-js'
import  { Document } from '@langchain/core/documents'
import { VectorStore } from '@langchain/core/vectorstores';

export interface CodeChunk {
  filePath: string;
  language: string;
  type: string;
  name: string;
  content: string;
  startLine: number;
  endLine: number;
  metadata: {
    imports?: string[];
    exports?: string[];
    dependencies?: string[];
    [key: string]: any;
  };
}

export class CodeVectorStore  {
  private config: {
    type: 'supabase' | 'memory' | 'faiss'
    openAIApiKey?: string
    supabase?: {
      url: string
      key: string
      tableName: string
      queryName?: string
    }
    faiss?: {
      indexPath: string
    }
  }

  private vectorStore: VectorStore | null = null;
  private embeddings: OpenAIEmbeddings;

   /**
   * 
   * @param config Configuration for the vector store
   */
   constructor(config: {
    type: 'supabase' | 'memory' | 'faiss';
    openAIApiKey?: string;
    supabase?: {
      url: string;
      key: string;
      tableName: string;
      queryName?: string;
    };
    faiss?: {
      indexPath: string;
    };
  }) {
    this.config = config;
    
    // Initialize embeddings
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: config.openAIApiKey || process.env.OPENAI_API_KEY
    }); 
  }


  /**
   * Index documents in the vector store
   * 
   * @param documents List of documents to index
   * @returns The initialized vector store
   */
  public async indexDocuments(documents: Document[]): Promise<VectorStore> {
    try {
      switch (this.config.type) {
        case 'supabase':
          return await this.indexInSupabase(documents);
        case 'faiss':
          return await this.indexInFaiss(documents);
        case 'memory':
        default:
          return await this.indexInMemory(documents);
      }
    } catch (error) {
      console.error(`Error indexing in ${this.config.type}:`, error);
      console.log('Falling back to memory store...');
      return await this.indexInMemory(documents);
    }
  }

   /**
   * Index documents in Supabase
   * 
   * @param documents List of documents to index
   * @returns Supabase vector store
   */
   private async indexInSupabase(documents: Document[]): Promise<VectorStore> {
    if (!this.config.supabase?.url || !this.config.supabase?.key) {
      throw new Error('Supabase URL or key missing');
    }
    
    // Initialize Supabase client
    const client = createClient(
      this.config.supabase.url,
      this.config.supabase.key
    );
    
    // Initialize SupabaseVectorStore
    this.vectorStore = await SupabaseVectorStore.fromDocuments(
      documents,
      this.embeddings,
      {
        client,
        tableName: this.config.supabase.tableName,
        queryName: this.config.supabase.queryName || 'match_documents'
      }
    );
    
    return this.vectorStore;
  }

  public createDocumentsFromChunks(chunks: CodeChunk[]): Document[] {
    return chunks.map((chunk) => {
      return new Document({
        pageContent: chunk.content,
        metadata: {
          filePath: chunk.filePath,
          language: chunk.language,
          type: chunk.type,
          name: chunk.name,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          ...chunk.metadata
        }
      });
    });
  }

   /**
   * Index documents in FAISS
   * 
   * @param documents List of documents to index
   * @returns FAISS vector store
   */
   private async indexInFaiss(documents: Document[]): Promise<VectorStore> {
    // This is a placeholder for FAISS implementation
    // You'll need to add the import at the top:
    // import { FaissStore } from '@langchain/community/vectorstores/faiss';
    
    throw new Error('FAISS not yet implemented');
    
    // Example implementation (uncomment and complete when needed):
    /*
    if (!this.config.faiss?.indexPath) {
      throw new Error('FAISS index path missing');
    }
    
    this.vectorStore = await FaissStore.fromDocuments(
      documents,
      this.embeddings
    );
    
    // Save the index
    await this.vectorStore.save(this.config.faiss.indexPath);
    
    return this.vectorStore;
    */
  }

    /**
   * Index documents in memory
   * 
   * @param documents List of documents to index
   * @returns Memory vector store
   */
    private async indexInMemory(documents: Document[]): Promise<VectorStore> {
        this.vectorStore = await MemoryVectorStore.fromDocuments(
          documents,
          this.embeddings
        );
        
        return this.vectorStore;
    }


       /**
   * Search for similar documents
   * 
   * @param query Search query
   * @param k Number of results to return
   * @returns List of document results with similarity scores
   */
  async search(query: string, k: number = 5): Promise<Array<Document>> {
    // if (!this.vectorStore) {
    //   throw new Error('Vector store not initialized. Call indexDocuments first.');
    // }
    await this.loadFromSupabase();
    
    return await this.vectorStore.similaritySearch(query, k);
  }
  

  /**
   * Search for similar documents with scores
   * 
   * @param query Search query
   * @param k Number of results to return
   * @returns List of document results with similarity scores
   */
  async searchWithScores(query: string, k: number = 5): Promise<Array<[Document, number]>> {
    if (!this.vectorStore) {
      throw new Error('Vector store not initialized. Call indexDocuments first.');
    }
    
    return await this.vectorStore.similaritySearchWithScore(query, k);
  }

  /**
   * Get the underlying vector store
   * 
   * @returns The vector store instance
   */
  getVectorStore(): VectorStore | null {
    return this.vectorStore;
  }

   /**
   * Load a previously saved vector store (for FAISS)
   * 
   * @param indexPath Path to the saved index
   * @returns The loaded vector store
   */
   async loadSavedIndex(indexPath?: string): Promise<VectorStore> {
    throw new Error('Loading saved indices not yet implemented');
    
    // Example implementation for FAISS (uncomment when needed):
    /*
    if (this.config.type !== 'faiss') {
      throw new Error('Loading saved indices only supported for FAISS');
    }
    
    const path = indexPath || this.config.faiss?.indexPath;
    if (!path) {
      throw new Error('Index path missing');
    }
    
    // Import FAISS store
    // import { FaissStore } from '@langchain/community/vectorstores/faiss';
    
    this.vectorStore = await FaissStore.load(
      path,
      this.embeddings
    );
    
    return this.vectorStore;
    */
  }

  private async loadFromSupabase(): Promise<VectorStore> {
    if (!this.config.supabase?.url || !this.config.supabase?.key) {
      throw new Error('Supabase URL or key missing');
    }
  
    const client = createClient(
      this.config.supabase.url,
      this.config.supabase.key
    );
  
    this.vectorStore = await SupabaseVectorStore.fromExistingIndex(
      this.embeddings,
      {
        client,
        tableName: this.config.supabase.tableName,
        queryName: this.config.supabase.queryName || 'match_documents'
      }
    );
  
    return this.vectorStore;
  }

 
}
