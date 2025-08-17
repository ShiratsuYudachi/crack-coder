import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

let openai: OpenAI | null = null;
let language = process.env.LANGUAGE || "Python";

interface Config {
  apiKey: string;
  language: string;
}

function updateConfig(config: Config) {
  if (!config.apiKey) {
    throw new Error('OpenAI API key is required');
  }
  
  try {
    openai = new OpenAI({
      apiKey: config.apiKey.trim(),
      baseURL: 'https://openrouter.ai/api/v1'
    });
    language = config.language || 'Python';
    // console.log('OpenAI client initialized with new config');
  } catch (error) {
    console.error('Error initializing OpenAI client:', error);
    throw error;
  }
}

// Initialize with environment variables if available
if (process.env.OPENAI_API_KEY) {
  try {
    updateConfig({
      apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY,
      language: process.env.LANGUAGE || 'Python'
    });
  } catch (error) {
    console.error('Error initializing OpenAI with environment variables:', error);
  }
}

type ResponseType = 'code' | 'answer' | 'raw';

export interface CodeResponse {
  responseType: 'code';
  approach: string;
  code: string;
  timeComplexity: string;
  spaceComplexity: string;
}

export interface AnswerResponse {
  responseType: 'answer';
  approach: string;
  result: string;
}

export interface RawResponse {
  responseType: 'raw';
  raw: string;
}

export type AIResponse = CodeResponse | AnswerResponse | RawResponse;

type MessageContent = 
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export async function processScreenshots(screenshots: { path: string }[]): Promise<AIResponse> {
  if (!openai) {
    throw new Error('OpenAI client not initialized. Please configure API key first. Click CTRL/CMD + P to open settings and set the API key.');
  }

  try {
    const messages = [
      {
        role: "system" as const,
        content: `You are an expert technical interview assistant.
                  You will receive one or more screenshots that contain either a coding question or a non-coding question.
                  You MUST always answer in valid JSON and ONLY JSON with no extra text.
                  The first field MUST be "responseType" with value either "code" or "answer".
                  If multiple questions are shown, answer first question only.
                  - If the question requires writing code, return responseType:"code" with fields: {
                      "responseType": "code",
                      "approach": "Explain the full solving process in Chinese",
                      "code": "Complete, runnable solution code",
                      "timeComplexity": "Big-O with reasoning",
                      "spaceComplexity": "Big-O with reasoning"
                    }
                  - If the question does NOT require writing code, return responseType:"answer" with fields: {
                      "responseType": "answer",
                      "approach": "Explain the solving process in Chinese",
                      "result": "A concise final answer in the SAME language as the question; for multiple choice, output only the correct option"
                    }
                  Hard requirements:
                  - Always output ONLY a single JSON object, no markdown, no backticks.
                  - "approach" MUST always be in Chinese.
                  - For responseType:"answer", "result" MUST be the same language as the question.`
      },
      {
        role: "user" as const,
        content: [
          { type: "text", text: "Here is a coding interview question. Please analyze and provide a solution." } as MessageContent
        ]
      }
    ];

    // Add screenshots as image URLs
    for (const screenshot of screenshots) {
      const base64Image = await fs.readFile(screenshot.path, { encoding: 'base64' });
      messages.push({
        role: "user" as const,
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${base64Image}`
            }
          } as MessageContent
        ]
      });
    }

    // Get response from OpenAI (via OpenRouter)
    const response = await openai.chat.completions.create({
      model: "openai/gpt-4o",
      messages: messages as any,
      max_tokens: 2000,
      temperature: 0.7,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content || '';
    try {
      const parsed = JSON.parse(content);
      if (parsed && (parsed.responseType === 'code' || parsed.responseType === 'answer')) {
        return parsed as AIResponse;
      }
      return { responseType: 'raw', raw: content } as RawResponse;
    } catch {
      return { responseType: 'raw', raw: content } as RawResponse;
    }
  } catch (error) {
    console.error('Error processing screenshots:', error);
    throw error;
  }
}

export default {
  processScreenshots,
  updateConfig
};
