import OpenAI from 'openai';

interface Screenshot {
  id: number;
  preview: string;
  path: string;
}

export interface ExtractedProblem {
  title: string;
  description: string;
  examples: Array<{
    input: string;
    output: string;
    explanation?: string;
  }>;
  constraints?: string[];
  followUp?: string;
}

export class ExtractAgent {
  private openai: OpenAI;

  constructor(openai: OpenAI) {
    this.openai = openai;
  }

  async extractProblemText(screenshots: Screenshot[]): Promise<ExtractedProblem> {
    try {
      // 准备图片数据
      const imageContents = screenshots.map(screenshot => ({
        type: "image_url" as const,
        image_url: {
          url: screenshot.preview
        }
      }));

      const response = await this.openai.chat.completions.create({
        model: "openai/gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `请仔细分析这些截图中的编程题目，提取以下信息并以JSON格式返回：

{
  "title": "题目标题",
  "description": "题目描述的完整文本，保持原文格式和要求",
  "examples": [
    {
      "input": "输入示例的具体内容",
      "output": "预期输出的具体内容",
      "explanation": "解释说明（如果有的话）"
    }
  ],
  "constraints": ["约束条件1", "约束条件2"],
  "followUp": "进阶问题或follow-up问题（如果有的话）"
}

请注意：
1. 准确提取所有输入输出示例，保持格式
2. 完整保留题目描述的所有要求和细节
3. 提取所有约束条件（时间复杂度、空间复杂度、数据范围等）
4. 如果有多个example，都要包含
5. 保持数字、特殊符号的准确性
6. 如果截图中有代码框架或函数签名，也包含在描述中

只返回JSON，不要任何其他文本。`
              },
              ...imageContents
            ]
          }
        ],
        max_tokens: 2000,
        temperature: 0,
        response_format: { type: "json_object" }
      });

      const content = response.choices[0]?.message?.content?.trim();
      
      if (!content) {
        throw new Error('未能提取到题目内容');
      }

      try {
        const extracted = JSON.parse(content);
        
        // 验证必要字段
        if (!extracted.title || !extracted.description) {
          throw new Error('提取的内容缺少必要字段');
        }
        
        // 确保examples是数组
        if (!Array.isArray(extracted.examples)) {
          extracted.examples = [];
        }
        
        return extracted as ExtractedProblem;
      } catch (parseError) {
        console.error('JSON解析失败，原始内容:', content);
        throw new Error(`提取内容格式错误，无法解析JSON。原始内容: ${content.substring(0, 200)}...`);
      }
    } catch (error: any) {
      console.error('文本提取失败:', error);
      throw new Error(`文本提取失败: ${error.message}`);
    }
  }
}