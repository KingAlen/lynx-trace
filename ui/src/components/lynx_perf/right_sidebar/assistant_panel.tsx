// Copyright 2025 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import { Component } from 'react';
import { Button } from 'antd';
import {AnalysisProcess} from './ai_analysis/analysis_process';
import {AnalysisReportComponent} from './ai_analysis/analysis_report';
import {SettingsButton} from './ai_analysis/settings_button';
import { AppImpl } from '../../../core/app_impl';
import { generateMarkdownDoc } from '../../../lynx_agent/utils/markdown_doc';
import AIAnalysis from '../../../plugins/lynx.AIAnalysis';
import { AgentConfig } from '../../../lynx_agent/utils/config';
import { trace_analysis_impl } from '../../../lynx_agent/trace_analysis_impl';
import { AnalysisReport, AnalysisStep, llmState } from '../../../lynx_perf/llm_state';
import { ReportLanguage } from '../../../lynx_agent/utils/interface/language';
import {TraceProcessorImpl, VerboseLoggerImpl, OverviewChartImpl } from './ai_analysis/analysis_impl';
import { STR } from '../../../trace_processor/query_result';


export interface TraceAssistantPanelState {
  status: 'initial' | 'analyzing' | 'completed';
  analysisResult: string;
  extraActionArea?: React.ReactNode;
  extraActionProperties: Record<string, string>;
  analysisSteps: AnalysisStep[];
  validationError: string;
  isValidationPassed: boolean;
}


export class TraceAssistantPanel extends Component<{}, TraceAssistantPanelState> {
  private verboseLogger: VerboseLoggerImpl;
  private reportLanguage: ReportLanguage;
  constructor(props: {}) {
    super(props);
    this.state = {
      status: 'initial',
      analysisResult: '',
      extraActionArea: undefined,
      extraActionProperties: {},
      analysisSteps: [],
      validationError: '',
      isValidationPassed: false
    };
    this.verboseLogger = new VerboseLoggerImpl(this);
    this.reportLanguage = {
      isChineseLanguage: () => navigator.language.startsWith('zh')
    }
  }

  async componentDidMount() {
    await this.performValidation();
    await this.restorePrevReportStatus();
  }

  performValidation = async () => {
    const isLynxVersionValid = await this.validateLynxVersion();
    if (!isLynxVersionValid) {
      this.setState({
        validationError: 'Use Lynx SDK version 3.4 or above to enable AI analysis.',
        isValidationPassed: false
      });
      return;
    }

    const isLLMConfigValid = this.validateLLMConfig();
    if (!isLLMConfigValid) {
      this.setState({
        validationError: 'Add LLM configuration in Settings to enable AI analysis.',
        isValidationPassed: false
      });
      return;
    }

    this.setState({
      validationError: '',
      isValidationPassed: true
    });
  };

  restorePrevReportStatus = async () => {
    const prevAnalysisResult = await llmState.state.reportExtraAction?.getHistoryAnalysisReport();

    if (prevAnalysisResult && this.state.status == 'initial') {
      console.log('prevAnalysisResult', JSON.stringify(prevAnalysisResult));
      const extraActionArea = await llmState.state.reportExtraAction?.render(undefined, undefined, prevAnalysisResult.extraActionProperties);
      this.setState({
        ...this.state,
        status: 'completed',
        analysisResult: prevAnalysisResult.analysisResult,
        analysisSteps: prevAnalysisResult.analysisSteps,
        extraActionArea: extraActionArea,
        extraActionProperties: prevAnalysisResult.extraActionProperties,
      });
    } else {
      console.log('empty  prevAnalysisResult');
    }
  };

  saveCurrentReportStatus = async () => {
    const { analysisResult, analysisSteps, extraActionProperties } = this.state;
    const report: AnalysisReport = {
      analysisResult,
      analysisSteps,
      extraActionProperties,
    };
    await llmState.state.reportExtraAction?.saveHistoryAnalysisReport(report);
  };

  private getLLMConfig = () => {
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
    const config: AgentConfig = {
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
    return await trace_analysis_impl(window.location.href, new TraceProcessorImpl(), config, this.verboseLogger, new OverviewChartImpl(), this.reportLanguage);
  }

  updateStepStatus = (stepId: string, title: string, status: 'wait' | 'process' | 'finish' | 'error', content: string) => {
    this.setState(prevState => {
      const existingStepIndex = prevState.analysisSteps.findIndex(step => 
        step.id === stepId || step.title.toLowerCase().includes(stepId.toLowerCase())
      );
      
      if (existingStepIndex !== -1) {
        // update current step
        const updatedSteps = [...prevState.analysisSteps];
        updatedSteps[existingStepIndex] = {
          ...updatedSteps[existingStepIndex],
          status,
          details: content ? [...updatedSteps[existingStepIndex].details, content] : updatedSteps[existingStepIndex].details
        };
        return { analysisSteps: updatedSteps };
      } else {
        // add new step
        const newStep: AnalysisStep = {
          id: stepId,
          title: title,
          status: status,
          details: content ? [content] : [],
          collapsed: false
        };
        return { analysisSteps: [...prevState.analysisSteps, newStep] };
      }
    });
  };

  private triggerTraceAIAnalysis = async () => {
    this.setState({
      status: 'analyzing',
    });
    try {
      const result = await this.traceAnalysis();
      if (result.length <= 0) {
        throw new Error('Analysis failed, llm ouput is empty');
      } else {
        this.verboseLogger.updateStepStatus('generate-report', 'Generate report', 'process', "");
        const finalResult = generateMarkdownDoc(result, this.reportLanguage);
        const extraActionArea = await llmState.state.reportExtraAction?.render(result, this.verboseLogger.getAllStepContent(), {});
        this.verboseLogger.updateStepStatus('generate-report', 'Generate report', 'finish', "");
        
        this.setState({
          status: 'completed',
          analysisResult: finalResult,
          extraActionArea: extraActionArea,
          extraActionProperties: llmState.state.reportExtraAction?.getActionProperties() || {}
        }, async () => {
          await llmState.state.reportExtraAction?.saveHistoryAnalysisReport({
            analysisResult: this.state.analysisResult,
            extraActionProperties: this.state.extraActionProperties,
            analysisSteps: this.state.analysisSteps,
          });
        });
      }
    } catch (error) {
      console.error('AI analysis request failed:', error);
      this.setState({
        status: 'completed',
        analysisResult: 'Analysis failed, please try again later.',
        extraActionArea: undefined
      });
    }
  };

  validateLynxVersion = async (): Promise<boolean> => {
     const engine = AppImpl.instance.trace?.engine;
    if (!engine) {
      return true;
    }
    const result = await engine.query(`select args.display_value from slice join args on args.arg_set_id=slice.arg_set_id where slice.name='LynxEngineVersion' and args.key='debug.version'`);
    const version = result.numRows() > 0 ? result.firstRow({display_value: STR}).display_value : '';
    return version >= '3.4';
  };

  validateLLMConfig = (): boolean => {
    const config = this.getLLMConfig();
    return !!(config.apiKey && config.modelName && config.modelProvider);
  };

  startAnalysis = async () => {
    this.triggerTraceAIAnalysis();
  };

  restartAnalysis = () => {
    this.resetToInitial();
    this.triggerTraceAIAnalysis();
  };

  resetToInitial = () => {
    this.setState({
      status: 'initial',
      analysisResult: '',
      extraActionArea: undefined,
      extraActionProperties: {},
      analysisSteps: []
    });
  };

  renderContent = () => {
    const { status } = this.state;

    switch (status) {
      case 'initial':
        return (
          <div style={{ 
            padding: '24px', 
            textAlign: 'center',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            backgroundColor: '#fafafa'
          }}>
            <div style={{ marginBottom: '32px' }}>
              <h2 style={{ 
                fontSize: '24px', 
                fontWeight: '600', 
                color: '#262626',
                marginBottom: '16px'
              }}>
                AI Trace Analysis
              </h2>
              <p style={{ 
                fontSize: '14px', 
                color: '#8c8c8c',
                lineHeight: '1.5'
              }}>
                Analyze your trace with AI to identify performance bottlenecks and optimization opportunities
              </p>
            </div>
            
            <div style={{ marginBottom: '24px' }}>
              <Button
                type="primary"
                size="large"
                onClick={this.startAnalysis}
                disabled={!this.state.isValidationPassed}
                style={{ 
                  height: '48px',
                  fontSize: '16px',
                  fontWeight: '500',
                  borderRadius: '6px',
                  minWidth: '160px'
                }}
              >
                Start Analysis
              </Button>
              
              {this.state.validationError && (
                <div style={{
                  marginTop: '12px',
                  color: '#ff4d4f',
                  fontSize: '14px',
                  textAlign: 'center'
                }}>
                  {this.state.validationError}
                </div>
              )}
            </div>
            
            <SettingsButton onValidationComplete={this.performValidation} />
          </div>
        );

      case 'analyzing':
        return (
           <div style={{ height: '100%', overflowY: 'auto', padding: '16px', position: 'relative' }}>
               <div style={{ marginTop: '24px' }}>
                  <AnalysisProcess steps={this.state.analysisSteps} />
               </div>
               <SettingsButton onValidationComplete={this.performValidation} />
           </div>
        )
      case 'completed':
        return (
          <div style={{ height: '100%', overflowY: 'auto', padding: '16px', position: 'relative' }}>
            <div style={{ marginBottom: '24px', marginTop: '24px' }}>
              <AnalysisProcess steps={this.state.analysisSteps} />
            </div>
            
            {/* Report */}
            <div style={{ marginBottom: '24px' }}>
              <AnalysisReportComponent 
                analysisResult={this.state.analysisResult}
                extraActionArea={this.state.extraActionArea}
                status={this.state.status}
              />
            </div>
            
            {/* Operation Area */}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'center', 
              gap: '16px',
              paddingTop: '16px',
              borderTop: '1px solid #f0f0f0'
            }}>
              <Button 
                type="primary"
                size="large"
                onClick={this.restartAnalysis}
                style={{
                  minWidth: '120px',
                  height: '40px',
                  fontSize: '14px'
                }}
              >
                Analyze Again
              </Button>
              <Button 
                size="large"
                onClick={this.resetToInitial}
                style={{
                  minWidth: '120px',
                  height: '40px',
                  fontSize: '14px'
                }}
              >
                Reset
              </Button>
            </div>
            <SettingsButton onValidationComplete={this.performValidation} />
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
