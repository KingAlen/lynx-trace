// Copyright 2025 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import {Component} from 'react';
import Markdown from 'react-markdown';
import {Button, Spin} from 'antd';
import { TraceQuery } from '../../../plugins/lynx.AIAnalysis/lynx_agent/tools/trace_query';
import { AppImpl } from '../../../core/app_impl';
import { generate_markdown_doc } from '../../../plugins/lynx.AIAnalysis/lynx_agent/utils/markdown_doc';
import AIAnalysis from '../../../plugins/lynx.AIAnalysis';
import { AgentConfig } from '../../../plugins/lynx.AIAnalysis/lynx_agent/utils/config';
import { QueryResult, SqlValue } from '../../../trace_processor/query_result';
import { VerboseLogger } from '../../../plugins/lynx.AIAnalysis/lynx_agent/utils/interface/verbose_logger';
import { trace_analysis_impl } from '../../../plugins/lynx.AIAnalysis/lynx_agent/trace_analysis_impl';
import { lynxPerfGlobals } from '../../../lynx_perf/lynx_perf_globals';
import { OverviewChart } from '../../../plugins/lynx.AIAnalysis/lynx_agent/utils/interface/overview_chart';


interface TraceAssistantPanelState {
  status: 'initial' | 'analyzing' | 'completed';
  analysisResult: string;
  traceUrl: string;
}

class TraceProcessorImpl implements TraceQuery {
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

class VerboseLoggerImpl implements VerboseLogger {
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
}

class OverviewChartImpl implements OverviewChart {
  async generateCharts(_traceResult: any): Promise<string[]> {
    return [];
  }
}

export class TraceAssistantPanel extends Component<{}, TraceAssistantPanelState> {
  constructor(props: {}) {
    super(props);
    this.state = {
      status: 'initial',
      analysisResult: '',
      traceUrl: window.location.href
    };
  }

   traceAnalysis = async () => {
     const config : AgentConfig = {
      max_steps: 20,
      model: {
        model: AIAnalysis.modelNameSetting.get(),
        model_provider: {
          api_key: AIAnalysis.APIKeySetting.get(),
          provider: AIAnalysis.modelProviderSetting.get(),
          base_url: AIAnalysis.baseUrlSetting.get(),
        },
        parallel_tool_calls: true,
        max_retries: 2,
      },
      tools: [],
    }
    return await trace_analysis_impl(window.location.href, new TraceProcessorImpl(), config, new VerboseLoggerImpl(), new OverviewChartImpl());
  }

  handleYesClick = async () => {
    this.setState({ status: 'analyzing' });
    try {
      const result = await this.traceAnalysis();
      if (result.length <= 0) {
        throw new Error('Analysis failed, llm ouput is empty');
      } else {
        const finalResult = generate_markdown_doc(result);
        this.setState({ 
          status: 'completed',
          analysisResult: finalResult
        });
      }
    } catch (error) {
      console.error('AI analysis request failed:', error);
      this.setState({ 
        status: 'completed',
        analysisResult: 'Analysis failed, please try again later.'
      });
    }
  };

  handleNoClick = () => {
    lynxPerfGlobals.closeRightSidebar();
  };

  renderContent = () => {
    const { status, analysisResult } = this.state;
    
    switch (status) {
      case 'initial':
        return (
          <div style={{ padding: '16px' }}>
            <p>Do you need to perform AI analysis on the current Trace?</p>
            <div style={{ marginTop: '12px' }}>
              <Button 
                type="primary" 
                onClick={this.handleYesClick}
                style={{ marginRight: '8px' }}
              >
                Yes
              </Button>
              <Button onClick={this.handleNoClick}>
                No
              </Button>
            </div>
          </div>
        );
      
      case 'analyzing':
        return (
          <div style={{ padding: '16px', textAlign: 'center' }}>
            <Spin size="large" />
            <p style={{ marginTop: '12px' }}>
              Analysis in progress, expected to complete in 3-5 minutes. The results will be displayed on the current page.
            </p>
          </div>
        );
      
      case 'completed':
         return (
           <div style={{
             maxHeight: '100vh',
             overflowY: 'auto',
             border: '1px solid #f0f0f0',
             borderRadius: '4px'
           }}>
             <div style={{ padding: '16px' }}>
               <Markdown 
                 components={{
                   h3: ({children}) => (
                     <h3 style={{
                       fontSize: '18px',
                       fontWeight: '700',
                     }}>
                       {children}
                     </h3>
                   )
                 }}
               >
                 {analysisResult}
               </Markdown>
             </div>
           </div>
         );
      
      default:
        return null;
    }
  };

  render() {
    return (
      <div style={{
        backgroundColor: '#F2F2F3',
        width: '100%',
        height: '100%',
      }}>
        {this.renderContent()}
      </div>
    );
  }
}
