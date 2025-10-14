import OpenAI from 'openai';
import {Tool, ToolCall, ToolResult} from '../../tools/base';
import {ModelConfig} from '../config';
import {BaseLLMClient} from './base_client';
import {LLMMessage, LLMResponse, LLMUsage} from './llm_basics';
import {retryWith} from './retry_utils';

export class OpenAIClient extends BaseLLMClient {
  /**
   * OpenAI client wrapper with tool schema generation.
   */
  private client: OpenAI;
  private messageHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
    [];

  constructor(modelConfig: ModelConfig) {
    super(modelConfig);

    this.client = new OpenAI({
      apiKey: this.api_key,
      baseURL: this.base_url,
      dangerouslyAllowBrowser: true,
    });
  }

  set_chat_history(messages: LLMMessage[]): void {
    /**
     * Set the chat history.
     */
    this.messageHistory = this.parseMessages(messages);
  }

  private async _createOpenAIResponse(
    apiCallInput: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    modelConfig: ModelConfig,
    toolSchemas: OpenAI.Chat.Completions.ChatCompletionTool[] | null,
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    /**
     * Create a response using OpenAI API. This method will be decorated with retry logic.
     */
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      messages: apiCallInput,
      model: modelConfig.model,
      tools: toolSchemas || undefined,
      max_tokens: modelConfig.max_tokens || undefined,
    };

    return await this.client.chat.completions.create(params);
  }

  async chat(
    messages: LLMMessage[],
    modelConfig: ModelConfig,
    tools: Tool[] | null = null,
    reuseHistory: boolean = true,
  ): Promise<LLMResponse> {
    /**
     * Send chat messages to OpenAI with optional tool support.
     */
    const openaiMessages = this.parseMessages(messages);

    let toolSchemas: OpenAI.Chat.Completions.ChatCompletionTool[] | null = null;
    if (tools) {
      toolSchemas = tools.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.get_name(),
          description: tool.get_description(),
          parameters: tool.get_input_schema(),
          strict: true,
        },
      }));
    }

    const apiCallInput: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      [];
    if (reuseHistory) {
      apiCallInput.push(...this.messageHistory);
    }
    apiCallInput.push(...openaiMessages);

    // Apply retry decorator to the API call
    const retryDecorator = retryWith(
      this._createOpenAIResponse.bind(this),
      modelConfig.max_retries || 3,
    );
    const response = await retryDecorator(
      apiCallInput,
      modelConfig,
      toolSchemas,
    );

    let content = '';
    const toolCalls: ToolCall[] = [];

    const choice = response.choices[0];
    if (choice.message.content) {
      content = choice.message.content;
    }

    if (choice.message.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        toolCalls.push({
          call_id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments
            ? JSON.parse(toolCall.function.arguments)
            : {},
          id: toolCall.id,
        });
      }

      // Add tool calls to message history
      this.messageHistory.push({
        role: 'assistant',
        content: content,
        tool_calls: choice.message.tool_calls,
      });
    } else if (content) {
      this.messageHistory.push({
        role: 'assistant',
        content: content,
      });
    }

    let usage: LLMUsage | null = null;
    if (response.usage) {
      usage = new LLMUsage(
        response.usage.prompt_tokens || 0,
        response.usage.completion_tokens || 0,
        0, // cache_creation_input_tokens
        0, // cache_read_input_tokens
        0, // reasoning_tokens
      );
    }

    const llmResponse: LLMResponse = {
      content,
      usage,
      model: response.model,
      finish_reason: choice.finish_reason,
      // @ts-ignore
      reasoning_content: choice.message.reasoning_content || '',
      tool_calls: toolCalls.length > 0 ? toolCalls : null,
    };

    return llmResponse;
  }

  private parseMessages(
    messages: LLMMessage[],
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    /**
     * Parse the messages to OpenAI format.
     */
    const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      [];
    for (const msg of messages) {
      if (msg.tool_result) {
        openaiMessages.push(this.parseToolCallResult(msg.tool_result));
      } else if (msg.tool_call) {
        openaiMessages.push(this.parseToolCall(msg.tool_call));
      } else {
        if (!msg.content) {
          throw new Error('Message content is required');
        }
        if (msg.role === 'system') {
          openaiMessages.push({role: 'system', content: msg.content});
        } else if (msg.role === 'user') {
          openaiMessages.push({role: 'user', content: msg.content});
        } else if (msg.role === 'assistant') {
          openaiMessages.push({role: 'assistant', content: msg.content});
        } else {
          throw new Error(`Invalid message role: ${msg.role}`);
        }
      }
    }
    return openaiMessages;
  }

  private parseToolCall(
    toolCall: ToolCall,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam {
    /**
     * Parse the tool call from the LLM response.
     */
    return {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: toolCall.call_id,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments || {}),
          },
        },
      ],
    };
  }

  private parseToolCallResult(
    toolCallResult: ToolResult,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam {
    /**
     * Parse the tool call result from the LLM response to tool message format.
     */
    let resultContent = '';
    if (toolCallResult.result !== null && toolCallResult.result !== undefined) {
      resultContent += String(toolCallResult.result);
    }
    if (toolCallResult.error) {
      resultContent += `\nError: ${toolCallResult.error}`;
    }
    resultContent = resultContent.trim();

    return {
      role: 'tool',
      content: resultContent,
      tool_call_id: toolCallResult.call_id,
    };
  }
}
