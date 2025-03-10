import sade from 'sade';
import colors from 'kleur';
import { relative } from 'path';
import * as ports from 'port-authority';
import { load_config } from './core/config/index.js';
import { networkInterfaces, release } from 'os';
import { coalesce_to_error } from './utils/error.js';
import { logger } from './core/utils.js';

/** @param {unknown} e */
function handle_error(e) {
	const error = coalesce_to_error(e);

	if (error.name === 'SyntaxError') throw error;

	console.error(colors.bold().red(`> ${error.message}`));
	if (error.stack) {
		console.error(colors.gray(error.stack.split('\n').slice(1).join('\n')));
	}

	process.exit(1);
}

/**
 * @param {number} port
 * @param {boolean} https
 */
async function launch(port, https) {
	const { exec } = await import('child_process');
	let cmd = 'open';
	if (process.platform == 'win32') {
		cmd = 'start';
	} else if (process.platform == 'linux') {
		if (/microsoft/i.test(release())) {
			cmd = 'cmd.exe /c start';
		} else {
			cmd = 'xdg-open';
		}
	}
	exec(`${cmd} ${https ? 'https' : 'http'}://localhost:${port}`);
}

const prog = sade('svelte-kit').version('__VERSION__');

prog
	.command('dev')
	.describe('Start a development server')
	.option('-p, --port', 'Port')
	.option('-o, --open', 'Open a browser tab')
	.option('--host', 'Host (only use this on trusted networks)')
	.option('--https', 'Use self-signed HTTPS certificate')
	.option('-H', 'no longer supported, use --https instead') // TODO remove for 1.0
	.action(async ({ port, host, https, open, H }) => {
		try {
			if (H) throw new Error('-H is no longer supported — use --https instead');

			process.env.NODE_ENV = process.env.NODE_ENV || 'development';
			const config = await load_config();

			const { dev } = await import('./core/dev/index.js');

			const cwd = process.cwd();

			const { address_info, server_config } = await dev({
				cwd,
				port,
				host,
				https,
				config
			});

			welcome({
				port: address_info.port,
				host: address_info.address,
				https: !!(https || server_config.https),
				open: open || !!server_config.open,
				loose: server_config.fs.strict === false,
				allow: server_config.fs.allow,
				cwd
			});
		} catch (error) {
			handle_error(error);
		}
	});

prog
	.command('build')
	.describe('Create a production build of your app')
	.option('--verbose', 'Log more stuff', false)
	.action(async ({ verbose }) => {
		try {
			process.env.NODE_ENV = process.env.NODE_ENV || 'production';
			const config = await load_config();

			const log = logger({ verbose });

			const { build } = await import('./core/build/index.js');
			const { build_data, prerendered } = await build(config, { log });

			console.log(
				`\nRun ${colors.bold().cyan('npm run preview')} to preview your production build locally.`
			);

			if (config.kit.adapter) {
				const { adapt } = await import('./core/adapt/index.js');
				await adapt(config, build_data, prerendered, { log });

				// this is necessary to close any open db connections, etc
				process.exit(0);
			}

			console.log(colors.bold().yellow('\nNo adapter specified'));

			// prettier-ignore
			console.log(
				`See ${colors.bold().cyan('https://kit.svelte.dev/docs/adapters')} to learn how to configure your app to run on the platform of your choosing`
			);
		} catch (error) {
			handle_error(error);
		}
	});

prog
	.command('preview')
	.describe('Serve an already-built app')
	.option('-p, --port', 'Port', 3000)
	.option('-o, --open', 'Open a browser tab', false)
	.option('--host', 'Host (only use this on trusted networks)', 'localhost')
	.option('--https', 'Use self-signed HTTPS certificate', false)
	.option('-H', 'no longer supported, use --https instead') // TODO remove for 1.0
	.action(async ({ port, host, https, open, H }) => {
		try {
			if (H) throw new Error('-H is no longer supported — use --https instead');

			await check_port(port);

			process.env.NODE_ENV = process.env.NODE_ENV || 'production';
			const config = await load_config();

			const { preview } = await import('./core/preview/index.js');

			await preview({ port, host, config, https });

			welcome({ port, host, https, open });
		} catch (error) {
			handle_error(error);
		}
	});

prog
	.command('package')
	.describe('Create a package')
	.option('-d, --dir', 'Destination directory', 'package')
	.action(async () => {
		try {
			const config = await load_config();

			const { make_package } = await import('./packaging/index.js');

			await make_package(config);
		} catch (error) {
			handle_error(error);
		}
	});

prog
	.command('sync')
	.describe('Synchronise generated files')
	.action(async () => {
		try {
			const config = await load_config();
			const sync = await import('./core/sync/sync.js');
			sync.all(config);
		} catch (error) {
			handle_error(error);
		}
	});

prog.parse(process.argv, { unknown: (arg) => `Unknown option: ${arg}` });

/** @param {number} port */
async function check_port(port) {
	if (await ports.check(port)) {
		return;
	}
	console.error(colors.bold().red(`Port ${port} is occupied`));
	const n = await ports.blame(port);
	if (n) {
		// prettier-ignore
		console.error(
			`Terminate process ${colors.bold(n)} or specify a different port with ${colors.bold('--port')}\n`
		);
	} else {
		// prettier-ignore
		console.error(
			`Terminate the process occupying the port or specify a different port with ${colors.bold('--port')}\n`
		);
	}
	process.exit(1);
}

/**
 * @param {{
 *   open: boolean;
 *   host: string;
 *   https: boolean;
 *   port: number;
 *   loose?: boolean;
 *   allow?: string[];
 *   cwd?: string;
 * }} param0
 */
function welcome({ port, host, https, open, loose, allow, cwd }) {
	if (open) launch(port, https);

	console.log(colors.bold().cyan(`\n  SvelteKit v${'__VERSION__'}\n`));

	const protocol = https ? 'https:' : 'http:';
	const exposed = typeof host !== 'undefined' && host !== 'localhost' && host !== '127.0.0.1';

	Object.values(networkInterfaces()).forEach((interfaces) => {
		if (!interfaces) return;
		interfaces.forEach((details) => {
			if (details.family !== 'IPv4') return;

			// prettier-ignore
			if (details.internal) {
				console.log(`  ${colors.gray('local:  ')} ${protocol}//${colors.bold(`localhost:${port}`)}`);
			} else {
				if (details.mac === '00:00:00:00:00:00') return;

				if (exposed) {
					console.log(`  ${colors.gray('network:')} ${protocol}//${colors.bold(`${details.address}:${port}`)}`);
					if (loose) {
						console.log(`\n  ${colors.yellow('Serving with vite.server.fs.strict: false. Note that all files on your machine will be accessible to anyone on your network.')}`);
					} else if (allow?.length && cwd) {
						console.log(`\n  ${colors.yellow('Note that all files in the following directories will be accessible to anyone on your network: ' + allow.map(a => relative(cwd, a)).join(', '))}`);
					}
				} else {
					console.log(`  ${colors.gray('network: not exposed')}`);
				}
			}
		});
	});

	if (!exposed) {
		console.log('\n  Use --host to expose server to other devices on this network');
	}

	console.log('\n');
}
