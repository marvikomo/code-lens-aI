import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import { ChatMistralAI } from '@langchain/mistralai'

export class LLMModels {
  public readonly mistral?: ChatMistralAI
  public readonly gpt?: ChatOpenAI
  public readonly google?: ChatGoogleGenerativeAI

  constructor() {
    if (process.env.MISTRAL_API_KEY) {
      this.mistral = new ChatMistralAI({
        model: 'mistral-large-latest',
        apiKey: process.env.MISTRAL_API_KEY,
        temperature: 0.7,
      })
    }

    if (process.env.OPENAI_API_KEY) {
      this.gpt = new ChatOpenAI({
        modelName: 'gpt-4o-mini',
        openAIApiKey: process.env.OPENAI_API_KEY,
        temperature: 0,
      })
    }

    if (process.env.GOOGLE_API_KEY) {
      this.google = new ChatGoogleGenerativeAI({
        model: 'gemini-2.0-flash',
        temperature: 0.2,
        apiKey: process.env.GOOGLE_API_KEY,
      })
    }
  }
}