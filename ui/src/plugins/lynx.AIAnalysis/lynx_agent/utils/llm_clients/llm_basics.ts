import {ToolCall, ToolResult} from '../../tools/base';

export interface LLMMessage {
  role: string;
  content?: string | null;
  tool_call?: ToolCall | null;
  tool_result?: ToolResult | null;
}

export class LLMUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  reasoning_tokens: number;

  constructor(
    input_tokens: number,
    output_tokens: number,
    cache_creation_input_tokens: number = 0,
    cache_read_input_tokens: number = 0,
    reasoning_tokens: number = 0,
  ) {
    this.input_tokens = input_tokens;
    this.output_tokens = output_tokens;
    this.cache_creation_input_tokens = cache_creation_input_tokens;
    this.cache_read_input_tokens = cache_read_input_tokens;
    this.reasoning_tokens = reasoning_tokens;
  }

  add(other: LLMUsage): LLMUsage {
    return new LLMUsage(
      this.input_tokens + other.input_tokens,
      this.output_tokens + other.output_tokens,
      this.cache_creation_input_tokens + other.cache_creation_input_tokens,
      this.cache_read_input_tokens + other.cache_read_input_tokens,
      this.reasoning_tokens + other.reasoning_tokens,
    );
  }

  toString(): string {
    return `LLMUsage(input_tokens=${this.input_tokens}, output_tokens=${this.output_tokens}, cache_creation_input_tokens=${this.cache_creation_input_tokens}, cache_read_input_tokens=${this.cache_read_input_tokens}, reasoning_tokens=${this.reasoning_tokens})`;
  }
}

export interface LLMResponse {
  content: string;
  usage?: LLMUsage | null;
  model?: string | null;
  finish_reason?: string | null;
  reasoning_content?: string | null;
  tool_calls?: ToolCall[] | null;
}
