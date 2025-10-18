// Copyright 2025 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import { Component } from 'react';
import ReactMarkdown from 'react-markdown';
import { Card } from 'antd';

interface AnalysisReportProps {
  analysisResult: string;
  markdownRef?: (ref: HTMLDivElement | null) => void;
  extraActionArea?: React.ReactNode;
}

export class AnalysisReportComponent extends Component<AnalysisReportProps> {
  render() {
    const { analysisResult, markdownRef, extraActionArea } = this.props;

    return (
      <div style={{ marginBottom: '24px', flex: 1 }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          marginBottom: '16px' 
        }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#262626', margin: 0 }}>
            Analysis Report
          </h3>
          {extraActionArea}
        </div>
        
        <Card
          bodyStyle={{
            padding: '16px'
          }}
        >
          <div
            ref={markdownRef}
            style={{
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
              maxWidth: '100%'
            }}
          >
            <ReactMarkdown
              components={{
                h3: ({ children }: any) => (
                  <h3 style={{ color: '#1890ff', fontSize: '16px', fontWeight: '600', marginBottom: '8px' }}>
                    {children}
                  </h3>
                ),
                a: ({ href, children }: any) => (
                  <a
                    href={href}
                    style={{ color: '#1890ff', textDecoration: 'underline' }}
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {analysisResult}
            </ReactMarkdown>
          </div>
        </Card>
      </div>
    );
  }
}

export default AnalysisReportComponent;