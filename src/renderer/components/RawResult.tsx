import React from 'react';

interface Props {
	raw: string;
}

const RawResult: React.FC<Props> = ({ raw }) => {
	return (
		<div className="result">
			<div className="solution-section">
				<h3>Raw Response</h3>
				<pre>
					<code>{raw}</code>
				</pre>
				<div className="hint">(Press fn + ↵ to retry)</div>
			</div>
		</div>
	);
};

export default RawResult;


