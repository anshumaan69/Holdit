import { ILLMProvider } from "./provider.interface.js";
import { MockLLMProvider } from "./mock.provider.js";
import { GeminiLLMProvider } from "./gemini.provider.js";
import { OpenAILLMProvider } from "./openai.provider.js";
import { config } from "../../config/index.js";

let providerInstance: ILLMProvider | null = null;

export function getLLMProvider(): ILLMProvider {
  if (!providerInstance) {
    switch (config.llm.provider) {
      case "gemini":
        providerInstance = new GeminiLLMProvider();
        break;
      case "openai":
        providerInstance = new OpenAILLMProvider();
        break;
      case "mock":
      default:
        providerInstance = new MockLLMProvider();
        break;
    }
    console.log(`🤖 LLM Provider initialized: ${providerInstance.name}`);
  }
  return providerInstance;
}

export * from "./types.js";
export * from "./provider.interface.js";
