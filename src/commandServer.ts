import http from 'http';
import { URL } from 'url';

type MoveDirection = 'left' | 'right' | 'up' | 'down';

interface CommandServerDeps {
	port: number;
	pageScroll: (direction: 'up' | 'down') => void;
	moveWindow: (direction: MoveDirection) => void;
	triggerScreenshot: () => Promise<void>;
	triggerProcess: () => Promise<void>;
	triggerReset: () => Promise<void>;
	toggleVisualHidden: () => void;
	toggleConfig: () => void;
}

export function installCommandServer(deps: CommandServerDeps) {
	const {
		port,
		pageScroll,
		moveWindow,
		triggerScreenshot,
		triggerProcess,
		triggerReset,
		toggleVisualHidden,
		toggleConfig
	} = deps;

	const server = http.createServer(async (req, res) => {
		try {
			if (!req.url) {
				res.statusCode = 400;
				return res.end('Bad Request');
			}
			const url = new URL(req.url, 'http://localhost');
			const pathname = url.pathname;

			switch (pathname) {
				case '/health':
					res.statusCode = 200;
					return res.end('ok');
				case '/screenshot':
					await triggerScreenshot();
					res.statusCode = 200;
					return res.end('ok');
				case '/process':
					await triggerProcess();
					res.statusCode = 200;
					return res.end('ok');
				case '/reset':
					await triggerReset();
					res.statusCode = 200;
					return res.end('ok');
				case '/toggle':
					toggleVisualHidden();
					res.statusCode = 200;
					return res.end('ok');
				case '/page-up':
					pageScroll('up');
					res.statusCode = 200;
					return res.end('ok');
				case '/page-down':
					pageScroll('down');
					res.statusCode = 200;
					return res.end('ok');
				case '/move':
				{
					const dir = url.searchParams.get('dir') as MoveDirection | null;
					if (!dir) {
						res.statusCode = 400;
						return res.end('missing dir');
					}
					moveWindow(dir);
					res.statusCode = 200;
					return res.end('ok');
				}
				case '/config':
					toggleConfig();
					res.statusCode = 200;
					return res.end('ok');
				default:
					res.statusCode = 404;
					return res.end('not found');
			}
 		} catch (err) {
 			res.statusCode = 500;
 			return res.end('error');
 		}
 	});

 	server.listen(port, '127.0.0.1');
 	return server;
}


