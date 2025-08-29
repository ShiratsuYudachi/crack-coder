import React from 'react';

interface WorkflowState {
  currentStep: string;
  progress: number; // 0-100
  stepDetails: string;
  error?: string;
  extractedExamples?: number; // 提取到的例子数量
  parallelTasks?: Array<{
    id: number;
    status: 'pending' | 'running' | 'success' | 'failed';
    model: string;
    error?: string;
    testsPassed?: number;
    testsTotal?: number;
  }>;
  completed?: boolean; // 是否已完成
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
        
        {state.extractedExamples !== undefined && (
          <div className="examples-info">
            <span className="info-label">提取的测试例子:</span>
            <span className="info-value">{state.extractedExamples} 个</span>
          </div>
        )}

        {state.parallelTasks && state.parallelTasks.length > 0 && (
          <div className="parallel-tasks">
            <div className="tasks-label">并行任务状态:</div>
            <div className="tasks-grid">
              {state.parallelTasks.map(task => (
                <div key={task.id} className={`task-item task-${task.status}`}>
                  <div className="task-header">
                    <span className="task-model">{task.model}</span>
                    <span className={`task-status status-${task.status}`}>
                      {task.status === 'pending' ? '等待中' : 
                       task.status === 'running' ? '运行中' : 
                       task.status === 'success' ? '成功' : '失败'}
                    </span>
                  </div>
                  {(task.testsTotal ?? 0) > 0 && (
                    <div className="task-tests">
                      测试: {task.testsPassed || 0}/{task.testsTotal || 0}
                    </div>
                  )}
                  {task.error && (
                    <div className="task-error">{task.error}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        
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