import React from 'react';

interface Props {
	approach: string;
	code: string;
	timeComplexity: string;
	spaceComplexity: string;
	tests?: { input: string; expected: string; actual?: string; ok?: boolean; error?: string }[];
	buggy?: {
		pending?: boolean;
		mistakeSummary?: string;
		edits?: { description: string; rationale: string }[];
		buggyCode?: string;
		error?: string;
	};
}

const CodeResult: React.FC<Props> = ({ approach, code, timeComplexity, spaceComplexity, tests, buggy }) => {
	const lines = code.split('\n');
	return (
		<div className="result">
			{tests && tests.length > 0 && (
				<div className="solution-section">
					<h3>Examples Test</h3>
					<div>
						{tests.map((t, i) => (
							<div key={i} style={{ marginBottom: 8 }}>
								<div>
									<span style={{ fontWeight: 600 }}>
										{typeof t.ok === 'undefined' ? 'PENDING' : t.ok ? 'PASS' : 'FAIL'}
									</span>
									{t.error ? ` - ${t.error}` : ''}
								</div>
								<div><code>input:</code> {t.input}</div>
								<div><code>expected:</code> {t.expected}</div>
								<div><code>actual:</code> {typeof t.actual === 'undefined' ? '(pending...)' : t.actual}</div>
							</div>
						))}
					</div>
				</div>
			)}
			<div className="solution-section">
				<h3>Approach</h3>
				<p>{approach}</p>
			</div>
			<div className="solution-section">
				<h3>Solution</h3>
				<pre>
					<code>
						{lines.map((line, idx) => (
							<div key={idx} className="code-line">
								<span className="line-number">{idx + 1}</span>
								<span className="code-text">{line}</span>
							</div>
						))}
					</code>
				</pre>
			</div>
			{buggy && (
				<div className="solution-section">
					<h3>Buggy Variant</h3>
					{buggy.pending ? (
						<div>Generating buggy variant... (pending)</div>
					) : buggy.error ? (
						<div style={{ color: 'red' }}>Error: {buggy.error}</div>
					) : (
						<>
							{buggy.mistakeSummary && <p>{buggy.mistakeSummary}</p>}
							{buggy.edits && buggy.edits.length > 0 && (
								<div style={{ marginBottom: 8 }}>
									{buggy.edits.map((e, i) => (
										<div key={i} style={{ marginBottom: 4 }}>
											<div><strong>Change:</strong> {e.description}</div>
											<div><strong>Why:</strong> {e.rationale}</div>
										</div>
									))}
								</div>
							)}
							{buggy.buggyCode && (
								<pre><code>{buggy.buggyCode}</code></pre>
							)}
						</>
					)}
				</div>
			)}
			<div className="solution-section">
				<h3>Complexity</h3>
				<p>Time: {timeComplexity}</p>
				<p>Space: {spaceComplexity}</p>
			</div>
		</div>
	);
};

export default CodeResult;


