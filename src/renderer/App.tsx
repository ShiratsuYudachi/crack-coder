import React, { useState, useEffect } from 'react';
import './App.css';
import ConfigScreen from './ConfigScreen';
import CodeResult from './components/CodeResult';
import AnswerResult from './components/AnswerResult';
import RawResult from './components/RawResult';

interface Screenshot {
  id: number;
  preview: string;
  path: string;
}

type ResponseType = 'code' | 'answer' | 'raw';

interface CodeResponse {
  responseType: 'code';
  approach: string;
  code: string;
  timeComplexity: string;
  spaceComplexity: string;
  examples?: { input: string; output: string }[];
}

interface AnswerResponse {
  responseType: 'answer';
  approach: string;
  result: string;
}

interface RawResponse {
  responseType: 'raw';
  raw: string;
}

type AIResponse = CodeResponse | AnswerResponse | RawResponse;

interface Config {
  apiKey: string;
  language: string;
}

declare global {
  interface Window {
    electron: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      quit: () => void;
      takeScreenshot: () => Promise<void>;
      processScreenshots: () => Promise<void>;
      resetQueue: () => Promise<void>;
      getConfig: () => Promise<Config | null>;
      saveConfig: (config: Config) => Promise<boolean>;
      onProcessingComplete: (callback: (result: string) => void) => void;
      onScreenshotTaken: (callback: (data: Screenshot) => void) => void;
      onProcessingStarted: (callback: () => void) => void;
      onQueueReset: (callback: () => void) => void;
      onShowConfig: (callback: () => void) => void;
      onPageScroll: (callback: (direction: 'up' | 'down') => void) => void;
      onModelUpdated: (callback: (data: { index: number; name: string }) => void) => void;
      onProModeUpdated: (callback: (data: { enabled: boolean }) => void) => void;
      toggleProMode: () => void;
      pythonLoad: (code: string) => Promise<{ id: number; ok: boolean; error?: string }>;
      pythonRun: (input?: string) => Promise<{ id: number; ok: boolean; stdout?: string; stderr?: string; error?: string }>;
      generateBuggyVariant: (payload: { code: string; approach?: string; modelOverride?: string }) => Promise<any>;
    };
  }
}

const App: React.FC = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<AIResponse | null>(null);
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string>('openai/gpt-5-chat');
  const [proMode, setProMode] = useState<boolean>(false);
  const [modelList, setModelList] = useState<string[]>([
    'openai/gpt-5-chat',
    'openai/o4-mini',
    'openai/o4-mini-high',
    'openai/o3'
  ]);
  const [exampleTests, setExampleTests] = useState<
    { input: string; expected: string; actual?: string; ok?: boolean; error?: string }[] | null
  >(null);
  const [buggyVariant, setBuggyVariant] = useState<
    | { pending: true }
    | { pending?: false; mistakeSummary?: string; edits?: { description: string; rationale: string }[]; buggyCode?: string; error?: string }
    | null
  >(null);

  useEffect(() => {
    const loadConfig = async () => {
      const savedConfig = await window.electron.getConfig();
      setConfig(savedConfig);
      if (!savedConfig) {
        setShowConfig(true);
      }
    };

    loadConfig();
  }, []);

  useEffect(() => {
    console.log('Setting up event listeners...');

    // Listen for show config events
    window.electron.onShowConfig(() => {
      setShowConfig(prev => !prev);
    });

    // Listen for processing started events
    window.electron.onProcessingStarted(() => {
      console.log('Processing started');
      setIsProcessing(true);
      setResult(null);
      setExampleTests(null);
      setBuggyVariant(null);
    });

    // Keyboard event listener
    const handleKeyDown = async (event: KeyboardEvent) => {
      console.log('Key pressed:', event.key);
      
      // Check if Cmd/Ctrl is pressed
      const isCmdOrCtrl = event.metaKey || event.ctrlKey;

      switch (event.key.toLowerCase()) {
        case '`':
          // toggle pro-mode when fn + backtick is pressed
          // Note: in browsers, Fn state isn't exposed; we rely on Karabiner to call backend normally.
          // Here we allow manual toggle for environments where Fn state is accessible.
          // This will not interfere if Karabiner is used exclusively.
          window.electron.toggleProMode();
          break;
        case 'h':
          console.log('Screenshot hotkey pressed');
          await handleTakeScreenshot();
          break;
        case 'enter':
          console.log('Process hotkey pressed');
          await handleProcess();
          break;
        case 'r':
          console.log('Reset hotkey pressed');
          await handleReset();
          break;
        case 'p':
          if (isCmdOrCtrl) {
            console.log('Toggle config hotkey pressed');
            setShowConfig(prev => !prev);
          }
          break;
        case 'b':
          if (isCmdOrCtrl) {
            console.log('Toggle visibility hotkey pressed');
            // Toggle visibility logic here
          }
          break;
        case 'q':
          if (isCmdOrCtrl) {
            console.log('Quit hotkey pressed');
            handleQuit();
          }
          break;
      }
    };

    // Add keyboard event listener
    window.addEventListener('keydown', handleKeyDown);

    // Listen for processing complete events
    window.electron.onProcessingComplete((resultStr) => {
      console.log('Processing complete. Result:', resultStr);
      try {
        const parsedResult = JSON.parse(resultStr) as AIResponse;
        setResult(parsedResult);

        if ((parsedResult as any).responseType === 'code') {
          const codeResult = parsedResult as CodeResponse;
          if (Array.isArray(codeResult.examples) && codeResult.examples.length > 0) {
            console.log('[Examples] Detected examples in AI response:', codeResult.examples);
            // Initialize as pending
            const initial = codeResult.examples.map(e => ({ input: e.input, expected: e.output }));
            setExampleTests(initial);

            // Load code into python daemon first
            (async () => {
              console.log('[Examples] Loading code into python daemon...');
              const loadRes = await window.electron.pythonLoad(codeResult.code);
              console.log('[Examples] pythonLoad result:', loadRes);
              if (!loadRes || !loadRes.ok) {
                const errMsg = loadRes?.error || 'pythonLoad failed';
                console.error('[Examples] pythonLoad error:', errMsg);
                setExampleTests(prev => (prev || []).map(t => ({ ...t, ok: false, error: errMsg })));
                return;
              }

              // Run all examples in parallel; update incrementally
              (codeResult.examples || []).forEach((ex, idx) => {
                console.log(`[Examples] Running example #${idx}:`, ex);
                window.electron.pythonRun(ex.input)
                  .then(runRes => {
                    console.log(`[Examples] Result for #${idx}:`, runRes);
                    setExampleTests(prev => {
                      if (!prev) return prev;
                      const next = prev.slice();
                      if (!runRes || !runRes.ok) {
                        next[idx] = {
                          ...next[idx],
                          actual: runRes?.stdout ?? '',
                          ok: false,
                          error: runRes?.error || 'pythonRun failed'
                        };
                      } else {
                        const actualOut = (runRes.stdout || '').replace(/\r\n/g, '\n');
                        const expectedOut = (ex.output || '').replace(/\r\n/g, '\n');
                        next[idx] = {
                          ...next[idx],
                          actual: actualOut,
                          ok: actualOut.trim() === expectedOut.trim()
                        };
                      }
                      // If all resolved and all ok, trigger buggy variant generation
                      const allResolved = next.every(t => typeof t.ok !== 'undefined');
                      const allOk = allResolved && next.every(t => t.ok);
                      if (allResolved && allOk) {
                        console.log('[Buggy] All examples passed. Generating buggy variant...');
                        setBuggyVariant({ pending: true });
                        (async () => {
                          try {
                            const resp = await (window.electron as any).generateBuggyVariant({ code: codeResult.code, approach: codeResult.approach });
                            console.log('[Buggy] Received buggy variant:', resp);
                            setBuggyVariant({
                              pending: false,
                              mistakeSummary: resp?.mistakeSummary,
                              edits: resp?.edits,
                              buggyCode: resp?.buggyCode
                            });
                          } catch (e: any) {
                            console.error('[Buggy] Error generating variant:', e);
                            setBuggyVariant({ pending: false, error: e?.message || 'buggy variant error' });
                          }
                        })();
                      }
                      return next;
                    });
                  })
                  .catch(err => {
                    console.error(`[Examples] Exception for #${idx}:`, err);
                    setExampleTests(prev => {
                      if (!prev) return prev;
                      const next = prev.slice();
                      next[idx] = { ...next[idx], ok: false, error: err?.message || 'run error' };
                      return next;
                    });
                  });
              });
            })();
          } else {
            console.log('[Examples] No examples provided by AI. Skipping example runs.');
            setExampleTests(null);
            setBuggyVariant(null);
          }
        } else {
          setExampleTests(null);
          setBuggyVariant(null);
        }
      } catch (error) {
        console.error('Error parsing result:', error);
      }
      setIsProcessing(false);
    });

    // Listen for new screenshots
    window.electron.onScreenshotTaken((screenshot) => {
      console.log('New screenshot taken:', screenshot);
      setScreenshots(prev => {
        const newScreenshots = [...prev, screenshot];
        console.log('Updated screenshots array:', newScreenshots);
        return newScreenshots;
      });
    });

    // Listen for queue reset
    window.electron.onQueueReset(() => {
      console.log('Queue reset triggered');
      setScreenshots([]);
      setResult(null);
    });

    // Listen for page scroll events from main (Option+Up/Down)
    window.electron.onPageScroll((direction) => {
      const viewportHeight = window.innerHeight;
      const scrollAmount = viewportHeight * 0.9;
      const delta = direction === 'up' ? -scrollAmount : scrollAmount;
      window.scrollBy({ top: delta, behavior: 'smooth' });
    });

    // Model update events
    window.electron.onModelUpdated(({ index, name }) => {
      setModelName(name);
    });
    window.electron.onProModeUpdated(({ enabled }) => {
      setProMode(enabled);
    });

    // Cleanup
    return () => {
      console.log('Cleaning up event listeners...');
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError(null);
      }, 5000); // Hide error after 5 seconds
      return () => clearTimeout(timer);
    }
  }, [error]);

  const handleTakeScreenshot = async () => {
    console.log('Taking screenshot, current count:', screenshots.length);
    if (screenshots.length >= 4) {
      console.log('Maximum screenshots reached');
      return;
    }
    try {
      await window.electron.takeScreenshot();
      console.log('Screenshot taken successfully');
    } catch (error) {
      console.error('Error taking screenshot:', error);
    }
  };

  const handleProcess = async () => {
    console.log('Starting processing. Current screenshots:', screenshots);
    if (screenshots.length === 0) {
      console.log('No screenshots to process');
      return;
    }
    setIsProcessing(true);
    setResult(null);
    setError(null);
    try {
      await window.electron.processScreenshots();
      console.log('Process request sent successfully');
    } catch (error: any) {
      console.error('Error processing screenshots:', error);
      setError(error?.message || 'Error processing screenshots');
      setIsProcessing(false);
    }
  };

  const handleReset = async () => {
    console.log('Resetting queue...');
    await window.electron.resetQueue();
  };

  const handleQuit = () => {
    console.log('Quitting application...');
    window.electron.quit();
  };

  const handleConfigSave = async (newConfig: Config) => {
    try {
      const success = await window.electron.saveConfig(newConfig);
      if (success) {
        setConfig(newConfig);
        setShowConfig(false);
        setError(null);
      } else {
        setError('Failed to save configuration');
      }
    } catch (error: any) {
      console.error('Error saving configuration:', error);
      setError(error?.message || 'Error saving configuration');
    }
  };

  // Log state changes
  useEffect(() => {
    console.log('State update:', {
      isProcessing,
      result,
      screenshotCount: screenshots.length
    });
  }, [isProcessing, result, screenshots]);

  useEffect(() => {
    console.log('[Buggy] State update:', buggyVariant);
  }, [buggyVariant]);

  const formatCode = (code: string) => {
    return code.split('\n').map((line, index) => (
      <div key={index} className="code-line">
        <span className="line-number">{index + 1}</span>
        {line}
      </div>
    ));
  };

  return (
    <div className="app">
      {error && (
        <div className="error-bar">
          <span>{error}</span>
          <button onClick={() => setError(null)}>&times;</button>
        </div>
      )}
      {showConfig && (
        <ConfigScreen
          onSave={handleConfigSave}
          initialConfig={config || undefined}
        />
      )}
      
      {/* Preview Row */}
      <div className="shortcuts-row">
        <div className="shortcut"><code>Model:</code> {modelName}</div>
        <div className="shortcut"><code>Pro:</code> {proMode ? 'On' : 'Off'}</div>
        <div className="shortcut"><code>fn + C</code> Screenshot</div>
        <div className="shortcut"><code>fn + ↵</code> Solution</div>
        <div className="shortcut"><code>fn + R</code> Reset</div>
        <div className="hover-shortcuts">
          <div className="hover-shortcuts-content">
            <div className="shortcut"><code>fn + 1/2/3/4</code> Switch Model</div>
            <div className="shortcut"><code>fn + `</code> Toggle Pro Mode</div>
            <div className="shortcut"><code>fn + P</code> Settings</div>
            <div className="shortcut"><code>fn + Q</code> Quit</div>
            <div className="shortcut"><code>fn + ⇧ + Arrow Keys</code> Move Around</div>
            <div className="shortcut"><code>fn + ↑/↓</code> Page</div>
            <div className="shortcut"><code>fn + H</code> Show/Hide</div>
          </div>
        </div>
      </div>
      <div className="preview-row">
        {screenshots.map(screenshot => (
          <div key={screenshot.id} className="preview-item">
            <img src={screenshot.preview} alt="Screenshot preview" />
          </div>
        ))}
      </div>

      {/* Status Row */}
      <div className="status-row">
        {isProcessing ? (
          <div className="processing">Processing... ({screenshots.length} screenshots)</div>
        ) : result ? (
          Array.isArray((result as any).results) && (result as any).pro ? (
            <div style={{ display: 'flex', gap: 12 }}>
              {(result as any).results.map((r: any, idx: number) => (
                <div key={idx} style={{ flex: 1, minWidth: 0 }}>
                  {r.ok ? (
                    r.data.responseType === 'code' ? (
                      <CodeResult
                        approach={r.data.approach}
                        code={r.data.code}
                        timeComplexity={r.data.timeComplexity}
                        spaceComplexity={r.data.spaceComplexity}
                        tests={exampleTests || undefined}
                        buggy={buggyVariant || undefined}
                      />
                    ) : r.data.responseType === 'answer' ? (
                      <AnswerResult result={r.data.result} approach={r.data.approach} />
                    ) : (
                      <RawResult raw={r.data.raw} />
                    )
                  ) : (
                    <RawResult raw={r.error || 'error'} />
                  )}
                </div>
              ))}
            </div>
          ) : result.responseType === 'code' ? (
            <CodeResult
              approach={result.approach}
              code={result.code}
              timeComplexity={result.timeComplexity}
              spaceComplexity={result.spaceComplexity}
              tests={exampleTests || undefined}
              buggy={buggyVariant || undefined}
            />
          ) : result.responseType === 'answer' ? (
            <AnswerResult result={result.result} approach={result.approach} />
          ) : (
            <RawResult raw={result.raw} />
          )
        ) : (
          <div className="empty-status">
            {screenshots.length > 0 
              ? `Press ⌘/Ctrl + ↵ to process ${screenshots.length} screenshot${screenshots.length > 1 ? 's' : ''}`
              : 'Press ⌘/Ctrl + H to take a screenshot'}
          </div>
        )}
      </div>
    </div>
  );
};

export default App; 