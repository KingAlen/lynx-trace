import {TraceQuery} from '../tools/trace_query';

/**
 * Model provider configuration. For official model providers such as OpenAI and Anthropic,
 * the base_url is optional. api_version is required for Azure.
 */
export interface ModelProvider {
  api_key: string;
  provider: string;
  base_url?: string | null;
  api_version?: string | null;
}

/**
 * Model configuration.
 */
export interface ModelConfig {
  model: string;
  model_provider: ModelProvider;
  parallel_tool_calls: boolean;
  max_retries: number;
  max_tokens?: number | null; // Legacy max_tokens parameter, optional
  candidate_count?: number | null; // Gemini specific field
  stop_sequences?: string[] | null;
  max_completion_tokens?: number | null; // Azure OpenAI specific field
}

/**
 * Base class for agent configurations.
 */
export interface AgentConfig {
  max_steps: number;
  model: ModelConfig;
  tools: string[];

  trace_processor?: TraceQuery;
}
