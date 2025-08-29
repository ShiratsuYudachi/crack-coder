import OpenAI from 'openai';

interface Screenshot {
  id: number;
  preview: string;
  path: string;
}

export class ClassifyAgent {
  private openai: OpenAI;

  constructor(openai: OpenAI) {
    this.openai = openai;
  }

  async classifyQuestion(screenshots: Screenshot[]): Promise<'coding' | 'general'> {
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
                text: `请分析这些截图内容，判断这是什么类型的问题。

请只回复以下两个选项之一：
- "coding" - 如果这是编程/算法题，包含代码实现需求，有输入输出示例，需要写代码解决
- "general" - 如果这是其他类型的问题，比如概念解释、理论问题、一般性问答等

请仔细观察是否有：
1. 函数签名/方法定义
2. 输入输出示例 
3. 约束条件
4. 算法或数据结构相关内容
5. 要求实现某个功能的代码

如果有以上特征，回复 "coding"，否则回复 "general"。

只回复一个单词，不要任何解释。`
              },
              ...imageContents
            ]
          }
        ],
        max_tokens: 10,
        temperature: 0
      });

      const result = response.choices[0]?.message?.content?.trim().toLowerCase();
      
      if (result === 'coding') {
        return 'coding';
      } else if (result === 'general') {
        return 'general';
      } else {
        // 如果返回的不是预期的结果，默认按照编程题处理
        console.warn('问题分类返回了意外结果:', result, '默认按编程题处理');
        return 'coding';
      }
    } catch (error) {
      console.error('问题分类失败:', error);
      // 发生错误时默认按编程题处理，因为编程题的处理流程更完整
      return 'coding';
    }
  }
}