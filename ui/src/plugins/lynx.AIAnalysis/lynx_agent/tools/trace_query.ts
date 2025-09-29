export interface TraceQuery {
  initProcessor(trace_url: string): Promise<void>;
  query(sql: string): Promise<string>;
  detroyProcessor(): Promise<void>;
}
