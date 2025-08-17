import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

let openai: OpenAI | null = null;
let language = process.env.LANGUAGE || "Python";
let modelName = process.env.OPENROUTER_MODEL || process.env.MODEL || "openai/gpt-5-chat";
let baseUrl = process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1';

interface Config {
  apiKey: string;
  language: string;
  model?: string;
  baseURL?: string;
}

function updateConfig(config: Config) {
  if (!config.apiKey) {
    throw new Error('OpenAI API key is required');
  }
  
  try {
    openai = new OpenAI({
      apiKey: config.apiKey.trim(),
      baseURL: config.baseURL?.trim() || baseUrl
    });
    language = config.language || 'Python';
    if (config.model && config.model.trim()) {
      modelName = config.model.trim();
    }
    if (config.baseURL && config.baseURL.trim()) {
      baseUrl = config.baseURL.trim();
    }
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
      apiKey: (process.env.OPENAI_API_KEY || '').trim(),
      language: process.env.LANGUAGE || 'Python',
      model: process.env.OPENROUTER_MODEL || process.env.MODEL,
      baseURL: process.env.OPENAI_BASE_URL
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
  examples?: { input: string; output: string }[];
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

export async function processScreenshots(screenshots: { path: string }[], overrideModel?: string): Promise<AIResponse> {
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
                      "spaceComplexity": "Big-O with reasoning",
                      "examples": [{"input": "...", "output": "..."}]  // Include ONLY IF explicit example input AND output are provided in the question; otherwise omit this field entirely.
                    }
                  - If the question does NOT require writing code, return responseType:"answer" with fields: {
                      "responseType": "answer",
                      "approach": "Explain the solving process in Chinese",
                      "result": "A concise final answer in the SAME language as the question; for multiple choice, output only the correct option"
                    }
                  Hard requirements:
                  - Always output ONLY a single JSON object, no markdown, no backticks.
                  - "approach" MUST always be in Chinese.
                  - For responseType:"answer", "result" MUST be the same language as the question.
                  - For responseType:"code": If the problem statement includes explicit example input AND output, extract them into an array field named "examples" with objects of shape {"input": string, "output": string}; include multiple pairs if present.
                  - If no explicit example input/output are present, DO NOT include the "examples" field at all (do not include null/empty).`
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

    // Get response from OpenAI-compatible API (via OpenRouter)
    const response = await openai.chat.completions.create({
      model: (overrideModel && overrideModel.trim()) || modelName,
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

export interface BuggyVariantResponse {
  responseType: 'buggyVariant';
  intent: 'introduce_mistakes';
  mistakeSummary: string;
  edits: { description: string; rationale: string }[]; // exactly two entries preferred
  buggyCode: string;
}

export async function generateBuggyVariant(params: { code: string; approach?: string; language?: string; modelOverride?: string }): Promise<BuggyVariantResponse> {
  if (!openai) {
    throw new Error('OpenAI client not initialized. Please configure API key first.');
  }
  const { code, approach, language: langOverride, modelOverride } = params;
  const lang = langOverride || language || 'Python';

  const system = [
    'You will receive a correct solution code. Your task is to intentionally introduce exactly two subtle mistakes to create a buggy version.',
    '- These mistakes should be realistic careless mistakes: missing an edge case, wrong boundary condition, off-by-one, or mishandled input.',
    '- The buggy version MUST remain largely similar to the original (same structure and algorithm spirit).',
    '- Return STRICT JSON only with the following fields:',
    '  {',
    '    "responseType": "buggyVariant",',
    '    "intent": "introduce_mistakes",',
    '    "mistakeSummary": "<In Chinese: summarize what you changed and why it causes errors>",',
    '    "edits": [',
    '      { "description": "<In Chinese: what changed>", "rationale": "<In Chinese: why this leads to wrong output>" },',
    '      { "description": "<In Chinese>", "rationale": "<In Chinese>" }',
    '    ],',
    '    "buggyCode": "<complete code with the two mistakes>"',
    '  }',
    '- Do NOT include any extra fields. Do NOT include markdown or backticks.',
    '- Keep the programming language as: ' + lang
  ].join('\n');

  const user = [
    'Original approach (may be empty):',
    approach ? approach : '(none)',
    '',
    'Original correct code:',
    code
  ].join('\n');

  const response = await openai.chat.completions.create({
    model: (modelOverride && modelOverride.trim()) || modelName,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0.7,
    max_tokens: 1600,
    response_format: { type: 'json_object' }
  });

  const content = response.choices[0].message.content || '';
  try {
    const parsed = JSON.parse(content);
    if (parsed && parsed.responseType === 'buggyVariant') {
      return parsed as BuggyVariantResponse;
    }
    return {
      responseType: 'buggyVariant',
      intent: 'introduce_mistakes',
      mistakeSummary: 'Raw content returned (unexpected shape).',
      edits: [{ description: 'N/A', rationale: content }],
      buggyCode: code
    };
  } catch {
    return {
      responseType: 'buggyVariant',
      intent: 'introduce_mistakes',
      mistakeSummary: 'Non-JSON content returned.',
      edits: [{ description: 'N/A', rationale: content }],
      buggyCode: code
    };
  }
}

export function setModel(model: string) {
  if (typeof model === 'string' && model.trim().length > 0) {
    modelName = model.trim();
  }
}

export default {
  processScreenshots,
  updateConfig,
  setModel,
  generateBuggyVariant
};
