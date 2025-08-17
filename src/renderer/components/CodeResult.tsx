import React from 'react';

interface Props {
	approach: string;
	code: string;
	timeComplexity: string;
	spaceComplexity: string;
	tests?: { input: string; expected: string; actual: string; ok: boolean; error?: string }[];
}

const CodeResult: React.FC<Props> = ({ approach, code, timeComplexity, spaceComplexity, tests }) => {
	const lines = code.split('\n');
	return (
		<div className="result">
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
								{line}
							</div>
						))}
					</code>
				</pre>
			</div>
			{tests && tests.length > 0 && (
				<div className="solution-section">
					<h3>Examples Test</h3>
					<div>
						{tests.map((t, i) => (
							<div key={i} style={{ marginBottom: 8 }}>
								<div>
									<span style={{ fontWeight: 600 }}>{t.ok ? 'PASS' : 'FAIL'}</span>
									{t.error ? ` - ${t.error}` : ''}
								</div>
								<div><code>input:</code> {t.input}</div>
								<div><code>expected:</code> {t.expected}</div>
								<div><code>actual:</code> {t.actual}</div>
							</div>
						))}
					</div>
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


