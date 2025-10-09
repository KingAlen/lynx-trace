export interface TraceQuery {
  initProcessor(trace_url: string): Promise<void>;
  query(sql: string): Promise<Array<Record<string, any>>>;
  detroyProcessor(): Promise<void>;
}
