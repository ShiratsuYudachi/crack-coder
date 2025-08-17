import React from 'react';

interface Props {
	approach: string;
	code: string;
	timeComplexity: string;
	spaceComplexity: string;
}

const CodeResult: React.FC<Props> = ({ approach, code, timeComplexity, spaceComplexity }) => {
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
			<div className="solution-section">
				<h3>Complexity</h3>
				<p>Time: {timeComplexity}</p>
				<p>Space: {spaceComplexity}</p>
			</div>
		</div>
	);
};

export default CodeResult;


