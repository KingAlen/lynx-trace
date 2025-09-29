import {Tool} from '../../tools/base';
import {ModelConfig} from '../config';
import {BaseLLMClient} from './base_client';
import {LLMMessage, LLMResponse} from './llm_basics';

enum LLMProvider {
  // Supported LLM providers.
  //   OPENAI = 'openai',
  //   ANTHROPIC = 'anthropic',
  DOUBAO = 'doubao',
  //   GOOGLE = 'google',
}

/**
 * 支持多个提供商的主要LLM客户端
 */
export class LLMClient {
  public provider: LLMProvider;
  //   private modelConfig: ModelConfig;
  private client: BaseLLMClient;

  constructor(modelConfig: ModelConfig) {
    this.provider = modelConfig.model_provider.provider as LLMProvider;
    // this.modelConfig = modelConfig;

    switch (this.provider) {
      //   case LLMProvider.OPENAI:
      //     // 动态导入OpenAI客户端
      //     const { OpenAIClient } = require('./openai_client');
      //     this.client = new OpenAIClient(modelConfig);
      //     break;

      //   case LLMProvider.ANTHROPIC:
      //     // 动态导入Anthropic客户端
      //     const { AnthropicClient } = require('./anthropic_client');
      //     this.client = new AnthropicClient(modelConfig);
      //     break;

      case LLMProvider.DOUBAO:
        // 动态导入豆包客户端
        const {DoubaoClient} = require('./doubao_client');
        this.client = new DoubaoClient(modelConfig);
        break;

      //   case LLMProvider.GOOGLE:
      //     // 动态导入Google客户端
      //     const { GoogleClient } = require('./google_client');
      //     this.client = new GoogleClient(modelConfig);
      //     break;

      default:
        throw new Error(`Unsupported provider: ${this.provider}`);
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
