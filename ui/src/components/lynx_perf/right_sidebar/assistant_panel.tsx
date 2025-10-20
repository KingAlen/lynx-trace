// Copyright 2025 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import { Component } from 'react';
import { Button, Modal, Form, Input, Select, message } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
const { Option } = Select;
import {AnalysisProcess} from './ai_analysis/analysis_process';
import {AnalysisReportComponent} from './ai_analysis/analysis_report';
import { AppImpl } from '../../../core/app_impl';
import { generateMarkdownDoc } from '../../../lynx_agent/utils/markdown_doc';
import AIAnalysis from '../../../plugins/lynx.AIAnalysis';
import { AgentConfig } from '../../../lynx_agent/utils/config';
import { trace_analysis_impl } from '../../../lynx_agent/trace_analysis_impl';
import { AnalysisReport, AnalysisStep, llmState } from '../../../lynx_perf/llm_state';
import { ReportLanguage } from '../../../lynx_agent/utils/interface/language';
import { Router } from '../../../core/router';
import {TraceProcessorImpl, VerboseLoggerImpl, OverviewChartImpl } from './ai_analysis/analysis_impl';
import { STR } from '../../../trace_processor/query_result';


export interface TraceAssistantPanelState {
  status: 'initial' | 'analyzing' | 'completed';
  analysisResult: string;
  extraActionArea?: React.ReactNode;
  extraActionProperties: Record<string, string>;
  showSettingsModal: boolean;
  analysisSteps: AnalysisStep[];
  llmConfig: {
    baseUrl: string;
    apiKey: string;
    modelName: string;
    modelProvider: string;
    customPrompt: string;
  };
  validationError: string;
  isValidationPassed: boolean;
}


export class TraceAssistantPanel extends Component<{}, TraceAssistantPanelState> {
  private markdownRef: HTMLDivElement | null = null;
  private markdownClick: (e: MouseEvent) => void;
  private isEventListenerAdded = false;
  private verboseLogger: VerboseLoggerImpl;
  constructor(props: {}) {
    super(props);
    this.state = {
      status: 'initial',
      analysisResult: '',
      extraActionArea: undefined,
      extraActionProperties: {},
      showSettingsModal: false,
      analysisSteps: [
      ],
      llmConfig: {
        baseUrl: '',
        apiKey: '',
        modelName: '',
        modelProvider: '',
        customPrompt: ''
      },
      validationError: '',
      isValidationPassed: false
    };
    this.markdownClick = this.handleMarkdownClick.bind(this);
    this.verboseLogger = new VerboseLoggerImpl(this);
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
      this.showSettings();
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

  private isCurrentPageLink(href: string) {
    try {
      const currentUrl = new URL(window.location.href);
      const targetUrl = new URL(href);
      return currentUrl.host == targetUrl.host && currentUrl.pathname == targetUrl.pathname;
    } catch (error) {
      return false;
    }
  }

  private getSliceIdFromUrl(href: string) {
    try {
      const router = Router.parseUrl(href);
      return router.args.sliceId ?? null;
    } catch (error) {
      return null;
    }
  };

  private handleMarkdownClick(e: MouseEvent) {
    if (e.target && e.target instanceof HTMLElement && e.target.tagName === 'A') {
      const href = e.target.getAttribute('href');

      if (href && this.isCurrentPageLink(href)) {
        const sliceId = this.getSliceIdFromUrl(href);
        if (sliceId) {
          e.preventDefault();
          AppImpl.instance.trace?.selection.selectSqlEvent('slice', parseInt(sliceId), {
            scrollToSelection: true,
          });
        }
      }
    }
  };

  componentDidUpdate(_prevProps: {}, prevState: TraceAssistantPanelState) {
    if (
      this.state.status === 'completed' &&
      this.markdownRef &&
      !this.isEventListenerAdded // 确保只添加一次
    ) {
      this.markdownRef.addEventListener('click', this.markdownClick);
      this.isEventListenerAdded = true;
      console.log('Markdown click event listener added'); // 调试用
    }

    // 当状态从 completed 变为其他状态时，移除事件监听器
    if (
      prevState.status === 'completed' &&
      this.state.status !== 'completed' &&
      this.isEventListenerAdded
    ) {
      this.removeMarkdownClickListener();
    }
  }

  private removeMarkdownClickListener() {
    if (this.markdownRef && this.isEventListenerAdded) {
      this.markdownRef.removeEventListener('click', this.markdownClick);
      this.isEventListenerAdded = false;
      console.log('Markdown click event listener removed'); // 调试用
    }
  }

  componentWillUnmount() {
    this.removeMarkdownClickListener();
  }

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
    const reportLanguage: ReportLanguage = {
      localLanguage: () => llmState.state.reportLanguage,
    }
    return await trace_analysis_impl(window.location.href, new TraceProcessorImpl(), config, this.verboseLogger, new OverviewChartImpl(), reportLanguage);
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
        this.verboseLogger.updateStepStatus('generate-report', 'Generate report', 'process', "Begin to generate final report");
        const finalResult = generateMarkdownDoc(result);
        const extraActionArea = await llmState.state.reportExtraAction?.render(result, this.verboseLogger.getAllStepContent(), {});
        this.verboseLogger.updateStepStatus('generate-report', 'Generate report', 'finish', "Final report generated");
        
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


  showSettings = () => {
    this.setState({
      showSettingsModal: true,
      llmConfig: {
        baseUrl: AIAnalysis.baseUrlSetting.get() || '',
        apiKey: AIAnalysis.APIKeySetting.get() || '',
        modelName: AIAnalysis.modelNameSetting.get() || '',
        modelProvider: AIAnalysis.modelProviderSetting.get() || '',
        customPrompt: AIAnalysis.customPromptSetting.get() || ''
      }
    });
  };

  hideSettings = () => {
    this.setState({ showSettingsModal: false });
  };

  saveSettings = async () => {
    const { llmConfig } = this.state;
    AIAnalysis.baseUrlSetting.set(llmConfig.baseUrl);
    AIAnalysis.APIKeySetting.set(llmConfig.apiKey);
    AIAnalysis.modelNameSetting.set(llmConfig.modelName);
    AIAnalysis.modelProviderSetting.set(llmConfig.modelProvider);
    AIAnalysis.customPromptSetting.set(llmConfig.customPrompt);
    
    message.success('Save Settings Successfully');
    this.hideSettings();
    
    await this.performValidation();
  };

  updateLLMConfig = (field: string, value: string) => {
    this.setState({
      llmConfig: {
        ...this.state.llmConfig,
        [field]: value
      }
    });
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
    const { status, showSettingsModal, llmConfig } = this.state;

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
            
            <div style={{ position: 'absolute', top: '16px', right: '16px' }}>
              <Button
                type="text"
                icon={<SettingOutlined />}
                onClick={this.showSettings}
                style={{ 
                  fontSize: '14px',
                  color: '#8c8c8c'
                }}
              >
                Settings
              </Button>
            </div>
            
            <Modal
              title="LLM Configuration"
              open={showSettingsModal}
              onOk={this.saveSettings}
              onCancel={this.hideSettings}
              width={600}
              okText="Save"
              cancelText="Cancel"
            >
              <Form layout="vertical" style={{ marginTop: '16px' }}>
                <Form.Item label="Model Provider">
                  <Select
                    value={llmConfig.modelProvider || undefined}
                    onChange={(value) => this.updateLLMConfig('modelProvider', value)}
                    placeholder="Select model provider"
                  >
                    <Option value="doubao">Doubao</Option>
                    <Option value="deepseek">Deepseek</Option>
                    <Option value="openai">OpenAI</Option>
                    <Option value="gemini">Google Gemini</Option>
                  </Select>
                </Form.Item>
                
                <Form.Item label="Model Name">
                  <Input
                    value={llmConfig.modelName}
                    onChange={(e) => this.updateLLMConfig('modelName', e.target.value)}
                    placeholder="e.g., seed-1.6, gpt-5, gemini-2.5-pro"
                  />
                </Form.Item>
                
                <Form.Item label="API Key">
                  <Input.Password
                    value={llmConfig.apiKey}
                    onChange={(e) => this.updateLLMConfig('apiKey', e.target.value)}
                    placeholder="Enter your API key"
                  />
                </Form.Item>
                
                <Form.Item label="Base URL (Optional)">
                  <Input
                    value={llmConfig.baseUrl}
                    onChange={(e) => this.updateLLMConfig('baseUrl', e.target.value)}
                    placeholder="e.g., https://ark.cn-beijing.volces.com/api/v3"
                  />
                </Form.Item>
                
                <Form.Item label="Custom Prompt (Optional)">
                  <Input.TextArea
                    value={llmConfig.customPrompt}
                    onChange={(e) => this.updateLLMConfig('customPrompt', e.target.value)}
                    placeholder="Enter your custom analysis prompt to provide the AI with additional context about the current Trace, such as custom trace events and descriptions."
                    rows={5}
                  />
                </Form.Item>
              </Form>
            </Modal>
          </div>
        );

      case 'analyzing':
        return (
           <div style={{ height: '100%', overflowY: 'auto', padding: '16px' }}>
               <AnalysisProcess steps={this.state.analysisSteps} />
           </div>
        )
      case 'completed':
        return (
          <div style={{ height: '100%', overflowY: 'auto', padding: '16px' }}>
            <div style={{ marginBottom: '24px' }}>
              <AnalysisProcess steps={this.state.analysisSteps} />
            </div>
            
            {/* Report */}
            <div style={{ marginBottom: '24px' }}>
              <AnalysisReportComponent 
                analysisResult={this.state.analysisResult}
                extraActionArea={this.state.extraActionArea}
                markdownRef={(ref) => { this.markdownRef = ref; }}
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
