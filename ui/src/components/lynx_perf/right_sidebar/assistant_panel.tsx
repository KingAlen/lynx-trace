// Copyright 2025 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import {Component} from 'react';
import Markdown from 'react-markdown';
import {Button, Spin, Collapse} from 'antd';
const { Panel } = Collapse;
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
import { llmState } from '../../../ai_analysis/llm_state';
import { ReportLanguage } from '../../../plugins/lynx.AIAnalysis/lynx_agent/utils/interface/language';


interface TraceAssistantPanelState {
  status: 'initial' | 'analyzing' | 'completed';
  analysisResult: string;
  traceUrl: string;
  middleStepContent: string[];
  isMiddleStepCollapsed: boolean;
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
  private panelInstance?: TraceAssistantPanel;

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

  llm_feedback(message: string): void {
    if (this.panelInstance) {
      this.panelInstance.addMiddleStepContent("==================\n" + message);
    }
  }
}

class OverviewChartImpl implements OverviewChart {
  async generateCharts(_traceResult: any): Promise<string[]> {
    return [];
  }
}

export class TraceAssistantPanel extends Component<{}, TraceAssistantPanelState> {
  private middleStepRef: HTMLDivElement | null = null;

  constructor(props: {}) {
    super(props);
    this.state = {
      status: 'initial',
      analysisResult: '',
      traceUrl: window.location.href,
      middleStepContent: [],
      isMiddleStepCollapsed: false
    };
  }

  componentDidUpdate(_prevProps: {}, prevState: TraceAssistantPanelState) {
    if (
      this.state.status === 'analyzing' &&
      this.state.middleStepContent.length > prevState.middleStepContent.length &&
      this.middleStepRef
    ) {
      this.middleStepRef.scrollTop = this.middleStepRef.scrollHeight;
    }
  }

  getLLMConfig = () => {
    const modelProvider = AIAnalysis.modelProviderSetting.get();
    const modelName = AIAnalysis.modelNameSetting.get();
    const apiKey = AIAnalysis.APIKeySetting.get();
    const baseUrl = AIAnalysis.baseUrlSetting.get();
    // if llm config is not set through settings page, use default config
    if (!modelProvider && !modelName && !apiKey && !baseUrl) {
      return llmState.state.config;
    }
    return {
      modelProvider,
      modelName,
      apiKey,
      baseUrl
    };
  }

   traceAnalysis = async () => {
    const llmConfig = this.getLLMConfig();
    const config : AgentConfig = {
      max_steps: 20,
      model: {
        model: llmConfig.modelName,
        model_provider: {
          api_key: llmConfig.apiKey,
          provider: llmConfig.modelProvider,
          base_url: llmConfig.baseUrl,
        },
        parallel_tool_calls: true,
        max_retries: 2,
      },
      tools: [],
    }
    const reportLanguage: ReportLanguage = {
      localLanguage: () => llmState.state.reportLanguage,
    }
    return await trace_analysis_impl(window.location.href, new TraceProcessorImpl(), config, new VerboseLoggerImpl(this), new OverviewChartImpl(), reportLanguage);
  }

  addMiddleStepContent = (message: string) => {
    this.setState(prevState => ({
      middleStepContent: [...prevState.middleStepContent, message]
    }));
  };

  toggleMiddleStepCollapse = () => {
    this.setState(prevState => ({
      isMiddleStepCollapsed: !prevState.isMiddleStepCollapsed
    }));
  };

  handleYesClick = async () => {
    this.setState({ 
      status: 'analyzing',
      middleStepContent: [],
      isMiddleStepCollapsed: false
    });
    try {
      const result = await this.traceAnalysis();
      if (result.length <= 0) {
        throw new Error('Analysis failed, llm ouput is empty');
      } else {
        const finalResult = generate_markdown_doc(result);
        this.setState({ 
          status: 'completed',
          analysisResult: finalResult,
          isMiddleStepCollapsed: true
        });
      }
    } catch (error) {
      console.error('AI analysis request failed:', error);
      this.setState({ 
        status: 'completed',
        analysisResult: 'Analysis failed, please try again later.',
        isMiddleStepCollapsed: true
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
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ textAlign: 'center', padding: '16px' }}>
              <Spin size="large" />
              <p style={{ marginTop: '12px' }}>
                Analysis in progress......
              </p>
            </div>
            {this.state.middleStepContent.length > 0 && (
               <div 
                 ref={(el) => { this.middleStepRef = el; }}
                 style={{
                   flex: 1,
                   overflowY: 'auto',
                   overflowX: 'hidden',
                   backgroundColor: '#fafafa',
                   fontSize: '12px',
                   padding: '8px',
                   fontFamily: 'monospace',
                   border: '1px solid #f0f0f0',
                   borderRadius: '4px',
                   wordWrap: 'break-word'
                 }}
               >
                 {this.state.middleStepContent.map((content, index) => (
                   <div key={index} style={{ marginBottom: '8px', whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
                     {content}
                   </div>
                 ))}
               </div>
             )}
          </div>
        );
      
      case 'completed':
         return (
           <div style={{ padding: '16px' }}>
             {this.state.middleStepContent.length > 0 && (
               <div style={{ marginBottom: '16px' }}>
                 <Collapse 
                   activeKey={this.state.isMiddleStepCollapsed ? [] : ['1']}
                   onChange={() => this.toggleMiddleStepCollapse()}
                 >
                   <Panel header="Analysis Process Details" key="1">
                     <div style={{
                       maxHeight: '300px',
                       overflowY: 'auto',
                       padding: '8px',
                       backgroundColor: '#fafafa',
                       fontSize: '12px',
                       fontFamily: 'monospace',
                       border: '1px solid #f0f0f0',
                       borderRadius: '4px'
                     }}>
                       {this.state.middleStepContent.map((content, index) => (
                         <div key={index} style={{ marginBottom: '8px', whiteSpace: 'pre-wrap' }}>
                           {content}
                         </div>
                       ))}
                     </div>
                   </Panel>
                 </Collapse>
               </div>
             )}
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
