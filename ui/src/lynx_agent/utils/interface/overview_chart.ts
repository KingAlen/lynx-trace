export interface OverviewChart {
  generateCharts(traceResult: any): Promise<string[]>;
}
