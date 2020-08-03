require('dotenv').config();

const getWebpackConfig = require('./webpack.config.js');
const {
	srcDir,
	buildDir,

	browserChrome,
	browserFirefox,

	modeDevelopment,
	modeProduction,

	manifestFile,

	assertBrowserIsSupported,
	assertBuildModeIsValid,
	configureTsCompilerForTests,
	getExtensionId,
} = require('./shared.config.js');

const distFileChrome = 'web-scrobbler-chrome.zip';
const distFileFirefox = 'web-scrobbler-firefox.zip';

const manifestPath = `${srcDir}/${manifestFile}`;

const filesToBump = [manifestPath, 'package.json', 'package-lock.json'];

const cssFilesToLint = [`${srcDir}/ui/**/*.css`];
const docFilesToLint = ['*.md', '.github/**/*.md'];
const htmlFilesToLint = [`${srcDir}/ui/**/*.html`];
const jsFilesToLint = ['*.js', '.grunt', `${srcDir}/**/*.js`, 'tests/**/*.js'];
const jsonFilesToLint = [`${srcDir}/**/*.json`, '*.json'];
const tsFilesToLint = [
	`${srcDir}/**/*.ts`,
	'tests/**/*.ts',

	// Ignore declaration files
	`!${srcDir}/types/*.d.ts`,
];
const vueFilesToLint = [`${srcDir}/ui/**/*.vue`];

const isCi = process.env.CI === 'true';

module.exports = (grunt) => {
	grunt.initConfig({
		manifest: grunt.file.readJSON(manifestPath),

		/**
		 * Configs of build tasks.
		 */

		clean: {
			build: buildDir,
			dist: [distFileChrome, distFileFirefox],
		},
		compress: {
			chrome: {
				options: {
					archive: distFileChrome,
					pretty: true,
				},
				expand: true,
				cwd: buildDir,
				src: '**/*',
			},
			firefox: {
				options: {
					archive: distFileFirefox,
					pretty: true,
				},
				expand: true,
				cwd: buildDir,
				src: '**/*',
			},
		},
		webpack: {
			chrome: () => getWebpackConfig(browserChrome),
			firefox: () => getWebpackConfig(browserFirefox),
		},

		/**
		 * Publish tasks.
		 */

		amo_upload: {
			issuer: process.env.AMO_ISSUER,
			secret: process.env.AMO_SECRET,
			id: getExtensionId(browserFirefox),
			version: '<%= manifest.version %>',
			src: distFileFirefox,
		},
		bump: {
			options: {
				files: filesToBump,
				updateConfigs: ['manifest'],
				commitFiles: filesToBump,
			},
		},
		publish_github_drafts: {
			owner: 'web-scrobbler',
			repo: 'web-scrobbler',
			token: process.env.GH_TOKEN,
			tag: 'v<%= manifest.version %>', // Add `v` prefix for tags
		},
		webstore_upload: {
			accounts: {
				default: {
					publish: true,
					client_id: process.env.CHROME_CLIENT_ID,
					client_secret: process.env.CHROME_CLIENT_SECRET,
					refresh_token: process.env.CHROME_REFRESH_TOKEN,
				},
			},
			extensions: {
				'web-scrobbler': {
					appID: getExtensionId(browserChrome),
					zip: distFileChrome,
				},
			},
		},

		/**
		 * Linter configs.
		 */

		eslint: {
			target: [jsFilesToLint, tsFilesToLint, vueFilesToLint],
			options: {
				fix: !isCi,
			},
		},
		htmlvalidate: {
			src: [htmlFilesToLint, vueFilesToLint],
		},
		jsonlint: {
			src: jsonFilesToLint,
		},
		lintspaces: {
			src: [
				jsFilesToLint,
				tsFilesToLint,
				jsonFilesToLint,
				cssFilesToLint,
				htmlFilesToLint,
				vueFilesToLint,
			],
			options: {
				editorconfig: '.editorconfig',
				ignores: ['js-comments'],
			},
		},
		remark: {
			options: {
				quiet: true,
				frail: true,
			},
			src: docFilesToLint,
		},
		stylelint: {
			all: [cssFilesToLint, vueFilesToLint],
		},

		/**
		 * Configs of other tasks.
		 */

		mochacli: {
			options: {
				require: [
					'ts-node/register',
					'tsconfig-paths/register',
					'source-map-support/register',
					'tests/helpers/set-stubs',
				],
				reporter: 'progress',
			},
			all: ['tests/**/*.spec.ts'],
		},
	});

	require('jit-grunt')(grunt, {
		mochacli: 'grunt-mocha-cli',
		htmlvalidate: 'grunt-html-validate',
	});
	grunt.loadTasks('.grunt');

	/**
	 * Some tasks take browser name as an argument.
	 * We support only Chrome and Firefox, which can be specified
	 * as 'chrome' and 'firefox' respectively:
	 *
	 *   Create a zipball for Chrome browser
	 *   > grunt dist:chrome
	 *
	 *   Build the extension for Firefox browser
	 *   > grunt build:firefox
	 */

	/**
	 * Copy source filed to build directory, preprocess them and
	 * set the extension icon according to specified browser.
	 *
	 * @param {String} browser Browser name
	 * @param {String} [mode=modeDevelopment] Build mode
	 */
	grunt.registerTask('build', (browser, mode = modeDevelopment) => {
		gruntAssertBrowserIsSupported(browser);
		gruntAssertBuildModeIsValid(mode);

		setBuildMode(mode);

		grunt.task.run(`webpack:${browser}`);
	});

	/**
	 * Build the extension and pack source files in a zipball.
	 *
	 * @param {String} browser Browser name
	 * @param {String} [mode=modeDevelopment] Build mode
	 */
	grunt.registerTask('dist', (browser, mode = modeDevelopment) => {
		gruntAssertBrowserIsSupported(browser);
		gruntAssertBuildModeIsValid(mode);

		grunt.task.run([
			'clean:build',
			`build:${browser}:${mode}`,
			`compress:${browser}`,
		]);
	});

	/**
	 * Publish the extension to the store.
	 *
	 * @param {String} browser Browser name
	 */
	grunt.registerTask('publish', (browser) => {
		gruntAssertBrowserIsSupported(browser);

		grunt.task.run([
			`dist:${browser}:${modeProduction}`,
			`upload:${browser}`,
			'clean:dist',
		]);
	});

	/**
	 * Release new version.
	 *
	 * For this project Travis CI is configured to publish the extension
	 * if new tag is pushed to the project repository.
	 *
	 * As a fallback, the extension can be released locally:
	 * > grunt release:%type%:local
	 *
	 * @param {String} versionType Release type supported by grunt-bump
	 * @param {String} releaseMode Release mode (local or empty)
	 */
	grunt.registerTask('release', (versionType, releaseMode) => {
		if (!versionType) {
			grunt.fail.fatal('You should specify release type!');
		}

		const releaseTasks = [`bump:${versionType}`];

		if (releaseMode) {
			if (releaseMode !== 'local') {
				grunt.fail.fatal(`Unknown release type: ${releaseMode}`);
			}

			const publishTasks = [
				'publish:chrome',
				'publish:firefox',
				'github_release',
			];
			releaseTasks.push(...publishTasks);
		}

		grunt.task.run(releaseTasks);
	});

	/**
	 * Upload new version.
	 *
	 * @param {String} browser Browser name
	 */
	grunt.registerTask('upload', (browser) => {
		switch (browser) {
			case browserChrome:
				grunt.task.run('webstore_upload');
				break;
			case browserFirefox:
				grunt.task.run('amo_upload');
				break;
		}
	});

	/**
	 * Run tests.
	 */
	grunt.registerTask('test', () => {
		configureTsCompilerForTests();

		grunt.task.run('mochacli');
	});

	/**
	 * Lint source code using linters specified below.
	 */
	grunt.registerTask('lint', [
		'eslint',
		'jsonlint',
		'lintspaces',
		'htmlvalidate',
		'stylelint',
		'remark',
		'unused_files',
	]);

	/**
	 * Throw an error if the extension doesn't support given browser.
	 *
	 * @param {String}  browser Browser name
	 */
	function gruntAssertBrowserIsSupported(browser) {
		try {
			assertBrowserIsSupported(browser);
		} catch (err) {
			grunt.fail.fatal(err.message);
		}
	}

	/**
	 * Throw an error if the extension doesn't support given browser.
	 * @param {String}  mode Mode
	 */
	function gruntAssertBuildModeIsValid(mode) {
		try {
			assertBuildModeIsValid(mode);
		} catch (err) {
			grunt.fail.fatal(err.message);
		}
	}

	function setBuildMode(mode) {
		process.env.NODE_ENV = mode;
	}
};
