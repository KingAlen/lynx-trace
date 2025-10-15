export interface TraceAnalysisResult {
  stage_one_results: string[];
  overview_trace_chart_urls: string[];
  timing_flags: string[];
  bundle_url: string;
}


export interface TraceAnalysisRequest {
  trace_url: string;
  chat_id: string;
  email: string | undefined;
  union_id: string | undefined;
  overview: boolean;
  message_id: string;
  verbose: boolean;
  evaluate: boolean;
  prompt: string | undefined;
}