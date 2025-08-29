import OpenAI from 'openai';
import { ExtractedProblem } from './extractAgent';

interface Screenshot {
  id: number;
  preview: string;
  path: string;
}

export class VerifyAgent {
  private openai: OpenAI;

  constructor(openai: OpenAI) {
    this.openai = openai;
  }

  async verifyExtractedText(screenshots: Screenshot[], extractedText: ExtractedProblem): Promise<boolean> {
    try {
      // 准备图片数据
      const imageContents = screenshots.map(screenshot => ({
        type: "image_url" as const,
        image_url: {
          url: screenshot.preview
        }
      }));

      // 格式化提取的内容用于比较
      const formattedExtraction = this.formatExtractionForComparison(extractedText);

      const response = await this.openai.chat.completions.create({
        model: "openai/gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `请验证以下提取的题目信息是否与截图中的内容一致。

提取的内容：
${formattedExtraction}

请仔细对比截图和提取的内容，检查：
1. 题目标题是否正确
2. 题目描述是否完整准确
3. 输入输出示例是否一致
4. 数字、符号是否准确
5. 约束条件是否正确
6. 是否遗漏了重要信息

如果提取的内容与截图完全一致且完整，请回复 "true"
如果有任何不一致、遗漏或错误，请回复 "false"

只回复 true 或 false，不要任何解释。`
              },
              ...imageContents
            ]
          }
        ],
        max_tokens: 10,
        temperature: 0
      });

      const result = response.choices[0]?.message?.content?.trim().toLowerCase();
      
      if (result === 'true') {
        return true;
      } else if (result === 'false') {
        return false;
      } else {
        // 如果返回的不是预期的结果，保守起见返回false
        console.warn('验证返回了意外结果:', result, '默认返回false');
        return false;
      }
    } catch (error) {
      console.error('验证失败:', error);
      // 发生错误时保守起见返回false，会触发重新提取
      return false;
    }
  }

  private formatExtractionForComparison(extracted: ExtractedProblem): string {
    let formatted = `标题: ${extracted.title}\n\n`;
    formatted += `描述: ${extracted.description}\n\n`;
    
    if (extracted.examples && extracted.examples.length > 0) {
      formatted += `示例:\n`;
      extracted.examples.forEach((example, index) => {
        formatted += `Example ${index + 1}:\n`;
        formatted += `输入: ${example.input}\n`;
        formatted += `输出: ${example.output}\n`;
        if (example.explanation) {
          formatted += `解释: ${example.explanation}\n`;
        }
        formatted += '\n';
      });
    }
    
    if (extracted.constraints && extracted.constraints.length > 0) {
      formatted += `约束条件:\n`;
      extracted.constraints.forEach(constraint => {
        formatted += `- ${constraint}\n`;
      });
      formatted += '\n';
    }
    
    if (extracted.followUp) {
      formatted += `进阶问题: ${extracted.followUp}\n`;
    }
    
    return formatted;
  }
}