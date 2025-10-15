import {Tool} from '../../tools/base';
import {ModelConfig} from '../config';
import {BaseLLMClient} from './base_client';
import {LLMMessage, LLMResponse} from './llm_basics';

enum LLMProvider {
  // Supported LLM providers.
  OPENAI = 'openai',
  //   ANTHROPIC = 'anthropic',
  DOUBAO = 'doubao',
  GOOGLE = 'google',
  DEEPSEEK = 'deepseek',
}

/**
 * Supported LLM providers.
 */
export class LLMClient {
  public provider: LLMProvider;
  //   private modelConfig: ModelConfig;
  private client: BaseLLMClient;

  constructor(modelConfig: ModelConfig) {
    this.provider = modelConfig.model_provider.provider as LLMProvider;
    // this.modelConfig = modelConfig;

    switch (this.provider) {
      case LLMProvider.OPENAI:
      case LLMProvider.DEEPSEEK:
        const {OpenAIClient} = require('./openai_client');
        this.client = new OpenAIClient(modelConfig);
        break;

      //   case LLMProvider.ANTHROPIC:
      //     const { AnthropicClient } = require('./anthropic_client');
      //     this.client = new AnthropicClient(modelConfig);
      //     break;

      // case LLMProvider.DOUBAO:
      //   const {DoubaoClient} = require('./doubao_client');
      //   this.client = new DoubaoClient(modelConfig);
      //   break;

      case LLMProvider.GOOGLE:
        const {GoogleClient} = require('./google_client');
        this.client = new GoogleClient(modelConfig);
        break;

      default:
        const {DoubaoClient} = require('./doubao_client');
        this.client = new DoubaoClient(modelConfig);
        break;
    }
  }

  setChatHistory(messages: LLMMessage[]): void {
    this.client.set_chat_history(messages);
  }

  chat(
    messages: LLMMessage[],
    modelConfig: ModelConfig,
    tools?: Tool[] | null,
    reuseHistory: boolean = true,
  ): Promise<LLMResponse> {
    return this.client.chat(messages, modelConfig, tools, reuseHistory);
  }
}
