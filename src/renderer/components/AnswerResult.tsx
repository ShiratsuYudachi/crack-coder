import React from 'react';

interface Props {
	approach: string;
	result: string;
}

const AnswerResult: React.FC<Props> = ({ result, approach }) => {
	return (
		<div className="result">
			<div className="solution-section">
				<h3>Answer</h3>
				<p>{result}</p>
			</div>
			<div className="solution-section">
				<h3>Approach</h3>
				<p>{approach}</p>
			</div>
		</div>
	);
};

export default AnswerResult;


