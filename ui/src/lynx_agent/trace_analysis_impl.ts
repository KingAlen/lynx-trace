import {Agent} from './agent/agent';
import {TraceQuery} from './tools/trace_query';
import {VerboseLogger} from './utils/interface/verbose_logger';
import {AgentConfig} from './utils/config';
import {overviewTraceImpl, OverviewTraceResult} from './utils/overview_trace';
import {OverviewChart} from './utils/interface/overview_chart';
import {ReportLanguage} from './utils/interface/language';
import { TraceAnalysisResult } from './types/types';

export async function trace_analysis_impl(
  trace_url: string,
  trace_processor: TraceQuery,
  agent_config: AgentConfig,
  verboseLogger: VerboseLogger,
  overviewChart: OverviewChart,
  reportLanguage: ReportLanguage,
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
          overviewChart,
          reportLanguage,
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
  overviewChart: OverviewChart,
  reportLanguage: ReportLanguage,
): Promise<TraceAnalysisResult> {
  const stage_one_results: Promise<string>[] = [];
  if (item.timing_flags_crop.length > 0) {
    for (const pipline of item.timing_flags_crop) {
      const agent = new Agent(
        'pipeline_analyze_agent',
        agent_config,
        trace_processor,
        verboseLogger,
        reportLanguage.localLanguage(),
      );
      stage_one_results.push(
        agent.run('Overview trace events: ' + JSON.stringify(pipline)),
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
    overview_trace_chart_urls: await overviewChart.generateCharts(item),
    timing_flags: timing_flags_all,
    bundle_url: bundle_url,
  };
}
