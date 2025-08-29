import React from 'react';

interface WorkflowState {
  currentStep: string;
  progress: number; // 0-100
  stepDetails: string;
  error?: string;
}

interface Props {
  state: WorkflowState | null;
  visible: boolean;
}

const WorkflowProgress: React.FC<Props> = ({ state, visible }) => {
  if (!visible || !state) {
    return null;
  }

  return (
    <div className="workflow-progress">
      <div className="workflow-header">
        <h3>Agent Workflow 进度</h3>
      </div>
      
      <div className="workflow-content">
        <div className="current-step">
          <span className="step-label">当前步骤:</span>
          <span className="step-name">{state.currentStep}</span>
        </div>
        
        <div className="progress-bar">
          <div 
            className="progress-fill" 
            style={{ width: `${state.progress}%` }}
          ></div>
          <span className="progress-text">{state.progress}%</span>
        </div>
        
        <div className="step-details">
          {state.stepDetails}
        </div>
        
        {state.error && (
          <div className="workflow-error">
            错误: {state.error}
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkflowProgress;