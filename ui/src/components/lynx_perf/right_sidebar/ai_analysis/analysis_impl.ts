import {OverviewChart} from '../../../../lynx_agent/utils/interface/overview_chart';
import {QueryResult, SqlValue} from '../../../../trace_processor/query_result';
import {VerboseLogger} from '../../../../lynx_agent/utils/interface/verbose_logger';
import {TraceQuery} from '../../../../lynx_agent/tools/trace_query';
import {AppImpl} from '../../../../core/app_impl';
import {TraceAssistantPanel} from '../assistant_panel';
import {OverviewTraceResult} from '../../../../lynx_agent/utils/overview_trace';
import {llmState} from '../../../../lynx_perf/llm_state';

export class TraceProcessorImpl implements TraceQuery {
  async initProcessor(_trace_url: string) {
    // in web page, we do not need to init trace processor
  }

  async detroyProcessor() {
    // in web page, we do not need to detroy trace processor
  }

  async query(sql: string): Promise<Array<Record<string, SqlValue>>> {
    const engine = AppImpl.instance.trace?.engine;
    if (!engine) {
      return [];
    }
    const result = await engine.query(sql);
    return this.resultToArray(result);
  }

  resultToArray(result: QueryResult): Array<Record<string, SqlValue>> {
    const columns = result.columns();
    const rows: Array<Record<string, SqlValue>> = [];
    for (const it = result.iter({}); it.valid(); it.next()) {
      if (rows.length > 5000) {
        throw new Error(
          'Query returned too many results, max 5000 rows. Results should be aggregates rather than raw data.',
        );
      }

      const row: {[key: string]: SqlValue} = {};
      for (const name of columns) {
        let value = it.get(name);
        if (typeof value === 'bigint') {
          value = Number(value);
        }
        row[name] = value;
      }
      rows.push(row);
    }
    return rows;
  }
}

export class VerboseLoggerImpl implements VerboseLogger {
  private panelInstance?: TraceAssistantPanel;
  private stepContent: Record<string, string[]> = {};

  constructor(panelInstance?: TraceAssistantPanel) {
    this.panelInstance = panelInstance;
  }

  debug(message: string): void {
    console.debug('debug: ' + message);
  }
  info(message: string): void {
    console.info('info: ' + message);
  }
  warning(message: string): void {
    console.warn('warning: ' + message);
  }
  error(message: string): void {
    console.error('error: ' + message);
  }
  verbose_debug(message: string): void {
    console.debug('verbose_debug: ' + message);
  }
  get_log_file_path(): string | undefined {
    // in web page, we do not need to log file path
    return undefined;
  }

  getAllStepContent(): Record<string, string[]> {
    return this.stepContent;
  }

  updateStepStatus(
    stepId: string,
    title: string,
    status: 'wait' | 'process' | 'finish' | 'error',
    content: string,
  ): void {
    if (this.panelInstance) {
      this.panelInstance.updateStepStatus(stepId, title, status, content);
    }
    this.stepContent[stepId] = this.stepContent[stepId] || [];
    if (content) {
      this.stepContent[stepId].push(content);
    }
  }
}

export class OverviewChartImpl implements OverviewChart {
  async generateCharts(traceResult: OverviewTraceResult): Promise<string[]> {
    return (
      (await llmState.state.reportExtraAction?.generateCharts(traceResult)) ||
      []
    );
  }
}
