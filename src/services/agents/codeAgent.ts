import OpenAI from 'openai';
import { ExtractedProblem } from './extractAgent';

export interface CodeSolution {
  ok: boolean;
  data?: {
    approach: string;
    code: string;
    timeComplexity: string;
    spaceComplexity: string;
    tests?: Array<{
      input: string | string[];
      expected: string | string[];
      actual?: string;
      ok?: boolean;
      error?: string;
    }>;
  };
  error?: string;
  index: number;
}

export class CodeAgent {
  private openai: OpenAI;
  private language: string;
  private onProgress?: (tasks: Array<{id: number; status: 'pending' | 'running' | 'success' | 'failed'; model: string; error?: string; testsPassed?: number; testsTotal?: number;}>) => void;

  constructor(openai: OpenAI, language: string, onProgress?: (tasks: any) => void) {
    this.openai = openai;
    this.language = language;
    this.onProgress = onProgress;
  }

  async generateCodeSolutions(problemText: ExtractedProblem): Promise<CodeSolution[]> {
    const models = ['openai/gpt-5-chat', 'openai/gpt-5-chat', 'openai/gpt-5-chat'];
    
    // 初始化任务状态
    let tasks = models.map((model, index) => ({
      id: index,
      status: 'pending' as 'pending' | 'running' | 'success' | 'failed',
      model: `模型 ${index + 1}`,
      error: undefined as string | undefined,
      testsPassed: 0,
      testsTotal: problemText.examples ? problemText.examples.length : 0
    }));
    
    if (this.onProgress) {
      this.onProgress(tasks);
    }

    // 并发执行3次代码生成
    const solutions = await Promise.all(
      models.map(async (model, index) => {
        try {
          // 更新状态为运行中
          tasks[index].status = 'running';
          if (this.onProgress) {
            this.onProgress([...tasks]);
          }

          const solution = await this.generateSingleSolution(problemText, model);
          
          // 计算测试通过情况
          let testsPassed = 0;
          if (solution.tests) {
            testsPassed = solution.tests.filter((t: any) => t.ok === true).length;
          }

          // 更新状态为成功
          tasks[index].status = 'success';
          tasks[index].testsPassed = testsPassed;
          if (this.onProgress) {
            this.onProgress([...tasks]);
          }

          return {
            ok: true,
            data: solution,
            index
          };
        } catch (error: any) {
          // 更新状态为失败
          tasks[index].status = 'failed';
          tasks[index].error = error?.message || '代码生成失败';
          if (this.onProgress) {
            this.onProgress([...tasks]);
          }

          return {
            ok: false,
            error: error?.message || '代码生成失败',
            index
          };
        }
      })
    );

    return solutions;
  }

  private async generateSingleSolution(problemText: ExtractedProblem, model: string): Promise<any> {
    try {
      // 构建问题描述
      const problemDescription = this.formatProblemForLLM(problemText);

      const response = await this.openai.chat.completions.create({
        model: model,
        messages: [
          {
            role: "system",
            content: `You are an expert competitive programmer. You need to solve coding problems step by step.

Please provide:
1. Clear approach explanation
2. Clean, efficient code in ${this.language}
3. Time and space complexity analysis
4. Test the solution with provided examples if available

Format your response as JSON:
{
  "approach": "Step by step explanation of your approach",
  "code": "Your complete solution code",
  "timeComplexity": "Time complexity (e.g., O(n))",
  "spaceComplexity": "Space complexity (e.g., O(1))",
  "tests": [
    {
      "input": "test input",
      "expected": "expected output", 
      "actual": "your code output",
      "ok": true/false
    }
  ]
}

Make sure the code is syntactically correct and handles edge cases.`
          },
          {
            role: "user",
            content: problemDescription
          }
        ],
        max_tokens: 4000,
        temperature: 0.3,
        response_format: { type: "json_object" }
      });

      const content = response.choices[0]?.message?.content?.trim();
      
      if (!content) {
        throw new Error('未能生成解决方案');
      }

      try {
        const parsed = JSON.parse(content);
        
        // 验证必要字段
        if (!parsed.approach || !parsed.code || !parsed.timeComplexity || !parsed.spaceComplexity) {
          throw new Error('生成的解决方案缺少必要字段');
        }

        // 如果有examples，尝试运行测试
        if (problemText.examples && problemText.examples.length > 0) {
          parsed.tests = await this.runTests(parsed.code, problemText.examples);
        }
        
        return parsed;
      } catch (parseError) {
        console.error('代码生成JSON解析失败，原始内容:', content);
        throw new Error(`生成内容格式错误，无法解析JSON。原始内容: ${content.substring(0, 200)}...`);
      }
    } catch (error: any) {
      console.error('单次代码生成失败:', error);
      throw error;
    }
  }

  private formatProblemForLLM(problemText: ExtractedProblem): string {
    let formatted = `Problem: ${problemText.title}\n\n`;
    formatted += `Description:\n${problemText.description}\n\n`;
    
    if (problemText.examples && problemText.examples.length > 0) {
      formatted += `Examples:\n`;
      problemText.examples.forEach((example, index) => {
        formatted += `Example ${index + 1}:\n`;
        formatted += `Input: ${example.input}\n`;
        formatted += `Output: ${example.output}\n`;
        if (example.explanation) {
          formatted += `Explanation: ${example.explanation}\n`;
        }
        formatted += '\n';
      });
    }
    
    if (problemText.constraints && problemText.constraints.length > 0) {
      formatted += `Constraints:\n`;
      problemText.constraints.forEach(constraint => {
        formatted += `- ${constraint}\n`;
      });
      formatted += '\n';
    }
    
    if (problemText.followUp) {
      formatted += `Follow-up: ${problemText.followUp}\n`;
    }
    
    return formatted;
  }

  private async runTests(code: string, examples: any[]): Promise<any[]> {
    // 这里可以实现实际的代码执行测试
    // 目前简单地返回测试格式，实际执行可以后续集成Python daemon
    return examples.map((example, index) => ({
      input: example.input,
      expected: example.output,
      actual: undefined, // 实际执行结果
      ok: undefined // 测试是否通过
    }));
  }
}