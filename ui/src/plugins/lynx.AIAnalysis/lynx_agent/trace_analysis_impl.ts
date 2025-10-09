import {Agent} from './agent/agent';
import {TraceQuery} from './tools/trace_query';
import {VerboseLogger} from './utils/cli/verbose_logger';
import {AgentConfig} from './utils/config';
import {overviewTraceImpl, OverviewTraceResult} from './utils/overview_trace';

export interface TraceAnalysisResult {
  stage_one_results: string[];
  overview_trace_chart_urls: string[];
  timing_flags: string[];
  bundle_url: string;
}

export async function trace_analysis_impl(
  trace_url: string,
  trace_processor: TraceQuery,
  agent_config: AgentConfig,
  verboseLogger: VerboseLogger,
): Promise<TraceAnalysisResult[]> {
  try {
    await trace_processor.initProcessor(trace_url);
    const overviewTrace = await overviewTraceImpl(trace_processor);
    const task_results: Promise<TraceAnalysisResult>[] = [];
    for (const item of overviewTrace) {
      task_results.push(
        lynxview_trace_analysis(
          item,
          trace_processor,
          agent_config,
          verboseLogger,
        ),
      );
    }
    return await Promise.all(task_results);
  } finally {
    await trace_processor.detroyProcessor();
  }
}

async function lynxview_trace_analysis(
  item: OverviewTraceResult,
  trace_processor: TraceQuery,
  agent_config: AgentConfig,
  verboseLogger: VerboseLogger,
): Promise<TraceAnalysisResult> {
  const stage_one_results: Promise<string>[] = [];
  if (item.timing_flags_crop.length > 0) {
    for (const pipline of item.timing_flags_crop) {
      const agent = new Agent(
        'pipeline_analyze_agent',
        agent_config,
        trace_processor,
        verboseLogger,
      );
      stage_one_results.push(
        agent.run('待分析的 Trace: ' + JSON.stringify(pipline)),
      );
    }
  }
  const timing_flags_all = item.timing_flags_all.map(
    (item) => item.timing_flags,
  );
  const stage_one_results_str = await Promise.all(stage_one_results);
  const bundle_url = item.bundle_url;
  return {
    stage_one_results: stage_one_results_str,
    overview_trace_chart_urls: [],
    timing_flags: timing_flags_all,
    bundle_url: bundle_url,
  };
}
