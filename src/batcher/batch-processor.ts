export interface BatchProcessorOptions {
  /** Maximum number of concurrent batches to process */
  concurrency?: number
  /** Whether to stop processing on first error or continue with remaining batches */
  stopOnError?: boolean
  /** Callback function called for each completed batch */
  onBatchComplete?: (batchIndex: number, result: any) => void
  /** Callback function called when a batch fails */
  onBatchError?: (batchIndex: number, error: Error, batch: any) => void
  /** Callback function called with progress updates */
  onProgress?: (completed: number, total: number) => void
}

export interface BatchResult<T> {
  /** Results from successful batches */
  results: T[]
  /** Errors from failed batches (with batch index) */
  errors: Array<{ batchIndex: number; error: Error; batch: any }>
  /** Total number of batches processed */
  totalBatches: number
  /** Number of successful batches */
  successCount: number
  /** Number of failed batches */
  errorCount: number
  /** Total processing time in milliseconds */
  processingTime: number
}

/**
 * Generic parallel batch processor utility
 * Processes an array of batches in parallel with configurable concurrency
 */
export class ParallelBatchProcessor {
  /**
   * Process batches in parallel
   * @param batches Array of batches to process
   * @param processor Function that processes a single batch
   * @param options Processing options
   * @returns Promise with batch processing results
   */
  static async process<TBatch, TResult>(
    batches: TBatch[],
    processor: (batch: TBatch, batchIndex: number) => Promise<TResult>,
    options: BatchProcessorOptions = {}
  ): Promise<BatchResult<TResult>> {
    const startTime = Date.now()
    const {
      concurrency = 3,
      stopOnError = false,
      onBatchComplete,
      onBatchError,
      onProgress
    } = options

    if (batches.length === 0) {
      return {
        results: [],
        errors: [],
        totalBatches: 0,
        successCount: 0,
        errorCount: 0,
        processingTime: Date.now() - startTime
      }
    }

    console.log(`🚀 Starting parallel batch processing: ${batches.length} batches with concurrency ${concurrency}`)

    const results: TResult[] = new Array(batches.length)
    const errors: Array<{ batchIndex: number; error: Error; batch: TBatch }> = []
    let completed = 0
    let hasStoppedOnError = false

    // Create a semaphore to limit concurrency
    const semaphore = new Semaphore(concurrency)

    // Process each batch
    const batchPromises = batches.map(async (batch, index) => {
      // Wait for semaphore slot
      await semaphore.acquire()

      try {
        // Check if we should stop due to previous errors
        if (hasStoppedOnError) {
          semaphore.release()
          return
        }

        // Process the batch
        const result = await processor(batch, index)
        results[index] = result

        // Update progress
        completed++
        onProgress?.(completed, batches.length)
        onBatchComplete?.(index, result)

        console.log(`✅ Batch ${index + 1}/${batches.length} completed`)

      } catch (error) {
        const batchError = error instanceof Error ? error : new Error(String(error))
        errors.push({ batchIndex: index, error: batchError, batch })

        completed++
        onProgress?.(completed, batches.length)
        onBatchError?.(index, batchError, batch)

        console.error(`❌ Batch ${index + 1}/${batches.length} failed:`, batchError.message)

        // Stop processing if configured to do so
        if (stopOnError) {
          hasStoppedOnError = true
        }
      } finally {
        semaphore.release()
      }
    })

    // Wait for all batches to complete or fail
    await Promise.all(batchPromises)

    const processingTime = Date.now() - startTime
    const successCount = results.filter(r => r !== undefined).length
    const errorCount = errors.length

    console.log(`🎯 Batch processing complete: ${successCount} success, ${errorCount} errors in ${processingTime}ms`)

    return {
      results: results.filter(r => r !== undefined),
      errors,
      totalBatches: batches.length,
      successCount,
      errorCount,
      processingTime
    }
  }

  /**
   * Process items by first chunking them into batches, then processing in parallel
   * @param items Array of items to process
   * @param batchSize Size of each batch
   * @param processor Function that processes a single batch
   * @param options Processing options
   * @returns Promise with batch processing results
   */
  static async processInChunks<TItem, TResult>(
    items: TItem[],
    batchSize: number,
    processor: (batch: TItem[], batchIndex: number) => Promise<TResult>,
    options: BatchProcessorOptions = {}
  ): Promise<BatchResult<TResult>> {
    // Create batches from items
    const batches: TItem[][] = []
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize))
    }

    console.log(`📦 Created ${batches.length} batches of size ${batchSize} from ${items.length} items`)

    return this.process(batches, processor, options)
  }

  /**
   * Process items individually in parallel (each item is its own "batch")
   * @param items Array of items to process
   * @param processor Function that processes a single item
   * @param options Processing options
   * @returns Promise with processing results
   */
  static async processItems<TItem, TResult>(
    items: TItem[],
    processor: (item: TItem, itemIndex: number) => Promise<TResult>,
    options: BatchProcessorOptions = {}
  ): Promise<BatchResult<TResult>> {
    return this.process(items, processor, options)
  }
}

/**
 * Simple semaphore implementation for controlling concurrency
 */
class Semaphore {
  private permits: number
  private waiting: Array<() => void> = []

  constructor(permits: number) {
    this.permits = permits
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--
      return Promise.resolve()
    }

    return new Promise<void>((resolve) => {
      this.waiting.push(resolve)
    })
  }

  release(): void {
    this.permits++
    if (this.waiting.length > 0) {
      const next = this.waiting.shift()
      if (next) {
        this.permits--
        next()
      }
    }
  }
}

// Helper function for creating batches
export function createBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize))
  }
  return batches
}

// Helper function for retry logic
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      
      if (attempt === maxRetries) {
        throw lastError
      }

      console.warn(`Attempt ${attempt} failed, retrying in ${delayMs}ms...`, lastError.message)
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  throw lastError!
}