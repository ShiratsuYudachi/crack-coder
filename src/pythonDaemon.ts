import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';

interface PythonResponse {
  id: number;
  ok: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export class PythonDaemon {
  private process: ChildProcessWithoutNullStreams | null = null;
  private scriptPath: string | null = null;
  private nextId = 1;
  private lineBuffer = '';
  private pending: Map<number, (value: PythonResponse) => void> = new Map();
  private pythonCmd: string = process.env.PYTHON_PATH || 'python3';
  private lastStderr: string = '';

  async start(): Promise<void> {
    if (this.process) return;
    await this.ensureScript();

    const spawned = await this.trySpawn(this.pythonCmd);
    if (!spawned) {
      const fallback = this.pythonCmd === 'python3' ? 'python' : 'python3';
      const spawnedFallback = await this.trySpawn(fallback);
      if (!spawnedFallback) {
        throw new Error('Failed to start python interpreter (tried python3 and python)');
      } else {
        this.pythonCmd = fallback;
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.process) return;
    try {
      this.process.kill();
    } catch {}
    this.process = null;
  }

  async load(code: string): Promise<PythonResponse> {
    await this.start();
    return this.send({ cmd: 'load', code });
  }

  async run(input?: string): Promise<PythonResponse> {
    await this.start();
    return this.send({ cmd: 'run', input: input || '' });
  }

  private handleStdout(text: string) {
    this.lineBuffer += text;
    let idx: number;
    while ((idx = this.lineBuffer.indexOf('\n')) !== -1) {
      const line = this.lineBuffer.slice(0, idx).trim();
      this.lineBuffer = this.lineBuffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as PythonResponse;
        if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
          const resolve = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          resolve(msg);
        }
      } catch {
        // ignore non-JSON lines
      }
    }
  }

  private send(payload: any): Promise<PythonResponse> {
    if (!this.process || !this.process.stdin.writable) {
      return Promise.resolve({ id: -1, ok: false, error: 'python daemon not running' });
    }
    const id = this.nextId++;
    const body = JSON.stringify({ id, ...payload }) + '\n';
    return new Promise<PythonResponse>((resolve) => {
      this.pending.set(id, resolve);
      this.process!.stdin.write(body, 'utf8');
    });
  }

  private async ensureScript() {
    if (this.scriptPath) return;
    const dir = app.getPath('userData');
    const p = path.join(dir, 'python_daemon.py');
    const content = this.getPythonScript();
    await fs.writeFile(p, content, { encoding: 'utf8' });
    this.scriptPath = p;
  }

  private getPythonScript(): string {
    return [
      'import sys, json, io, contextlib, traceback',
      '',
      'loaded_code = None',
      '',
      'def respond(obj):',
      '    sys.stdout.write(json.dumps(obj) + "\\n")',
      '    sys.stdout.flush()',
      '',
      'for line in sys.stdin:',
      '    line = line.strip()',
      '    if not line:',
      '        continue',
      '    try:',
      '        msg = json.loads(line)',
      '        mid = msg.get("id", -1)',
      '        cmd = msg.get("cmd")',
      '        if cmd == "load":',
      '            loaded_code = msg.get("code", "")',
      '            respond({"id": mid, "ok": True})',
      '        elif cmd == "run":',
      '            if not loaded_code:',
      '                respond({"id": mid, "ok": False, "error": "no code loaded"})',
      '                continue',
      '            raw_input = msg.get("input", "")',
      '            # Smart input processing: handle different formats',
      '            if isinstance(raw_input, list):',
      '                # Multi-line input as array: ["line1", "line2", ...]',
      '                inp = "\\n".join(raw_input)',
      '            elif isinstance(raw_input, str):',
      '                # String input: check for escaped newlines',
      '                if "\\\\n" in raw_input:',
      '                    # Convert escaped newlines to actual newlines',
      '                    inp = raw_input.replace("\\\\n", "\\n").replace("\\\\t", "\\t").replace("\\\\r", "\\r")',
      '                else:',
      '                    # Already clean string input',
      '                    inp = raw_input',
      '            else:',
      '                inp = str(raw_input)',
      '            ns = {"__name__": "__main__"}',
      '            out_io = io.StringIO()',
      '            err_io = io.StringIO()',
      '            try:',
      '                with contextlib.redirect_stdout(out_io), contextlib.redirect_stderr(err_io):',
      '                    import builtins, types',
      '                    import sys as _sys, io as _io',
      '                    _sys.stdin = _io.StringIO(inp)',
      '                    exec(loaded_code, ns, ns)',
      '                respond({"id": mid, "ok": True, "stdout": out_io.getvalue(), "stderr": err_io.getvalue()})',
      '            except Exception:',
      '                tb = traceback.format_exc()',
      '                respond({"id": mid, "ok": False, "error": tb, "stdout": out_io.getvalue(), "stderr": err_io.getvalue()})',
      '        else:',
      '            respond({"id": mid, "ok": False, "error": "unknown cmd"})',
      '    except Exception:',
      '        tb = traceback.format_exc()',
      '        try:',
      '            respond({"id": -1, "ok": False, "error": tb})',
      '        except Exception:',
      '            pass',
      ''
    ].join('\n');
  }

  private async trySpawn(cmd: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const cp = spawn(cmd, ['-u', this.scriptPath as string], { stdio: ['pipe', 'pipe', 'pipe'] });

      const resolveFalse = () => {
        if (resolved) return;
        resolved = true;
        try { cp.removeAllListeners(); } catch {}
        resolve(false);
      };

      cp.once('error', (_err) => {
        resolveFalse();
      });
      cp.once('spawn', () => {
        if (resolved) return;
        resolved = true;
        this.attachProcess(cp);
        resolve(true);
      });
      // In some cases process can exit too fast; treat as failure
      cp.once('exit', () => {
        resolveFalse();
      });
    });
  }

  private attachProcess(cp: ChildProcessWithoutNullStreams) {
    this.process = cp;
    this.lastStderr = '';
    cp.stdout.on('data', (chunk: Buffer) => {
      this.handleStdout(chunk.toString('utf8'));
    });
    cp.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      this.lastStderr = (this.lastStderr + text).slice(-4000);
      this.handleStdout(text);
    });
    cp.on('exit', (code, signal) => {
      this.process = null;
      const msg = `python daemon exited (code=${code}, signal=${signal})\n${this.lastStderr || ''}`;
      for (const [, resolve] of this.pending) {
        resolve({ id: -1, ok: false, error: msg });
      }
      this.pending.clear();
    });
  }
}

const singleton = new PythonDaemon();
export default singleton;


