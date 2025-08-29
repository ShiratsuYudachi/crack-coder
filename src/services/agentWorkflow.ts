import OpenAI from 'openai';
import { ClassifyAgent } from './agents/classifyAgent';
import { ExtractAgent, ExtractedProblem } from './agents/extractAgent';
import { VerifyAgent } from './agents/verifyAgent';
import { CodeAgent, CodeSolution } from './agents/codeAgent';

// Workflow状态和进度类型定义
export interface WorkflowState {
  currentStep: string;
  progress: number; // 0-100
  stepDetails: string;
  error?: string;
}

export interface WorkflowResult {
  success: boolean;
  data?: any;
  error?: string;
  selectedResult?: {
    index: number;
    reason: string;
  };
}

// Workflow状态更新回调
type StatusCallback = (state: WorkflowState) => void;

// Screenshot接口
interface Screenshot {
  id: number;
  preview: string;
  path: string;
}

// Agent Workflow主类
export class AgentWorkflow {
  private openai: OpenAI;
  private language: string;
  private onStatusUpdate: StatusCallback;
  private classifyAgent: ClassifyAgent;
  private extractAgent: ExtractAgent;
  private verifyAgent: VerifyAgent;
  private codeAgent: CodeAgent;

  constructor(openai: OpenAI, language: string, onStatusUpdate: StatusCallback) {
    this.openai = openai;
    this.language = language;
    this.onStatusUpdate = onStatusUpdate;
    
    // 初始化所有agents
    this.classifyAgent = new ClassifyAgent(openai);
    this.extractAgent = new ExtractAgent(openai);
    this.verifyAgent = new VerifyAgent(openai);
    this.codeAgent = new CodeAgent(openai, language);
  }

  // 主入口 - 只在pro模式下调用
  async executeProWorkflow(screenshots: Screenshot[]): Promise<WorkflowResult> {
    try {
      this.updateStatus('问题分类中...', 10, '正在分析问题类型');
      
      // Step 1: 问题分类
      const questionType = await this.classifyQuestion(screenshots);
      
      if (questionType === 'coding') {
        return await this.executeCodingWorkflow(screenshots);
      } else {
        return await this.executeGeneralWorkflow(screenshots);
      }
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || '工作流执行失败'
      };
    }
  }

  // 编程问题工作流
  private async executeCodingWorkflow(screenshots: Screenshot[]): Promise<WorkflowResult> {
    this.updateStatus('文本提取中...', 30, '从图片中提取题目文本和例子');
    
    // Step 2: 文本提取 (最多3次尝试)
    let extractedText: ExtractedProblem | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        extractedText = await this.extractAgent.extractProblemText(screenshots);
        
        this.updateStatus('验证提取结果...', 50, `第${attempt}次验证提取的文本内容`);
        
        // Step 3: 验证提取结果
        const isValid = await this.verifyAgent.verifyExtractedText(screenshots, extractedText);
        
        if (isValid) {
          break;
        } else if (attempt === 3) {
          throw new Error('文本提取验证失败，已达到最大重试次数');
        }
        
        this.updateStatus('重新提取文本...', 40 + attempt * 5, `第${attempt}次提取失败，正在重试`);
      } catch (error) {
        if (attempt === 3) throw error;
      }
    }

    if (!extractedText) {
      throw new Error('无法提取有效的问题文本');
    }

    this.updateStatus('生成代码解决方案...', 70, '并发调用3个模型生成解决方案');
    
    // Step 4: 并发生成3个解决方案
    const solutions = await this.codeAgent.generateCodeSolutions(extractedText);
    
    this.updateStatus('选择最佳解决方案...', 90, '根据成功率和优先级选择结果');
    
    // Step 5: 选择最佳解决方案
    const bestSolution = this.selectBestCodeSolution(solutions);
    
    this.updateStatus('完成', 100, '工作流执行完成');
    
    // 确保返回的数据包含responseType字段
    const resultData = {
      ...bestSolution.data,
      responseType: 'code' as const
    };
    
    return {
      success: true,
      data: resultData,
      selectedResult: {
        index: bestSolution.index,
        reason: bestSolution.reason
      }
    };
  }

  // 普通问题工作流 (保持现有行为)
  private async executeGeneralWorkflow(screenshots: Screenshot[]): Promise<WorkflowResult> {
    this.updateStatus('并发处理中...', 50, '同时调用3个模型处理普通问题');
    
    // 使用现有的逻辑，3次并发调用
    const models = ['openai/gpt-5-chat', 'openai/gpt-5-chat', 'openai/gpt-5-chat'];
    const results = await Promise.all(models.map(async (model, index) => {
      try {
        // 动态导入processScreenshots以避免循环依赖
        const { default: openaiService } = await import('./openai');
        const data = await openaiService.processScreenshots(screenshots, model);
        return { model, ok: true, data, index };
      } catch (e: any) {
        return { model, ok: false, error: e?.message || 'error', index };
      }
    }));
    
    this.updateStatus('完成', 100, '普通问题处理完成');
    
    return {
      success: true,
      data: { pro: true, results }
    };
  }

  // 问题分类 - 使用ClassifyAgent
  private async classifyQuestion(screenshots: Screenshot[]): Promise<'coding' | 'general'> {
    return await this.classifyAgent.classifyQuestion(screenshots);
  }

  // 选择最佳代码解决方案
  private selectBestCodeSolution(solutions: CodeSolution[]): { data: any; index: number; reason: string } {
    // 找到第一个成功的解决方案
    const successfulSolution = solutions.find(sol => sol.ok);
    
    if (successfulSolution && successfulSolution.data) {
      return {
        data: successfulSolution.data,
        index: successfulSolution.index,
        reason: `选择第${successfulSolution.index + 1}个解决方案：执行成功且ID最靠前`
      };
    }
    
    // 如果都失败了，返回一个默认的代码格式错误结果
    const firstSolution = solutions[0];
    return {
      data: {
        approach: '代码生成失败',
        code: `错误: ${firstSolution?.error || '所有解决方案都失败'}`,
        timeComplexity: 'N/A',
        spaceComplexity: 'N/A'
      },
      index: 0,
      reason: '所有解决方案都失败，返回错误信息'
    };
  }

  // 状态更新辅助方法
  private updateStatus(step: string, progress: number, details: string) {
    this.onStatusUpdate({
      currentStep: step,
      progress,
      stepDetails: details
    });
  }
}