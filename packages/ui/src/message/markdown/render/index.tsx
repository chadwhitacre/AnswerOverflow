/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable-next-line @typescript-eslint/no-unsafe-argument */

import memoize from 'memoizee';
import * as R from 'ramda';
import baseRules from './ast';
import { astToString, flattenAst, recurse } from './util';
import SimpleMarkdown, { defaultRules } from 'simple-markdown';
import { Code } from 'bright';
import Link from '../../../ui/link';

function parserFor(rules: SimpleMarkdown.ReactRules, returnAst?: boolean) {
	const parser = SimpleMarkdown.parserFor(rules);
	const renderer = SimpleMarkdown.outputFor(rules, 'react');
	return memoize(
		(input = '', inline = true, state = {}, transform = null) => {
			if (!inline) {
				input += '\n\n';
			}

			const parse = R.pipe.apply(
				// @ts-ignore
				this,
				// @ts-ignore
				[parser, flattenAst, transform, !returnAst && renderer].filter(Boolean),
			);
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			try {
				return parse(input, { inline, ...state });
			} catch {
				console.error('Failed to parse markdown', input);
				return input;
			}
		},
		{
			normalizer: (...args) => JSON.stringify(args),
		},
	);
}

function createRules(rule: { [key: string]: any }) {
	const {
		paragraph,
		url,
		link,
		codeBlock,
		inlineCode,
		blockQuote,
		spoiler,
		command,
	} = rule;

	return {
		...rule,
		heading: {
			...defaultRules.heading,
			match: (source: any, state: any) => {
				const prevCaptureStr =
					state.prevCapture === null ? '' : state.prevCapture[0];
				// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
				const isStartOfLineCapture = /(?:^|\n)( *)$/.exec(prevCaptureStr);

				if (isStartOfLineCapture) {
					// eslint-disable-next-line @typescript-eslint/restrict-plus-operands
					source = isStartOfLineCapture[1] + source;
					// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
					return /^(#{1,3})\s(.+)/.exec(source);
				}

				return null;
			},
			react(
				node: {
					level: number;
					content: string;
				},
				parse: (source: string, state: any) => any,
				state: {
					key: string;
				},
			) {
				return (
					// eslint-disable-next-line tailwindcss/no-custom-classname
					<span className={`heading-${node.level} block`} key={state.key}>
						{parse(node.content, state)}
					</span>
				);
			},
		},
		s: {
			order: rule.u.order,
			match: SimpleMarkdown.inlineRegex(/^~~([\s\S]+?)~~(?!_)/),
			parse: rule.u.parse,
			react: (
				node: {
					content: string;
				},
				recurseOutput: (node: any, state: any) => any,
				state: any,
			) => <s key={state.key}>{recurseOutput(node.content, state)}</s>,
		},
		paragraph: {
			...paragraph,
			react: (
				node: {
					content: string;
				},
				recurseOutput: (node: any, state: any) => any,
				state: any,
			) => {
				return (
					<span key={state.key} className={'block'}>
						{recurseOutput(node.content, state)}
					</span>
				);
			},
		},
		url: {
			...url,
			match: SimpleMarkdown.inlineRegex(
				/^((https?|steam):\/\/[^\s<]+[^<.,:;"')\]\s])/,
			),
		},
		link: {
			...link,
			react(
				node: {
					content: string;
					target: string;
					title: string;
				},
				recurseOutput: (node: any, state: any) => any,
				state: any,
			) {
				const url = SimpleMarkdown.sanitizeUrl(node.target) ?? '';
				const content = astToString(node.content);
				const masked = url !== content;

				return (
					<Link
						title={masked ? `${node.title || content}\n\n(${url})` : url}
						href={SimpleMarkdown.sanitizeUrl(node.target) ?? ''}
						target="_blank"
						rel="nofollow noreferrer"
						key={state.key}
					>
						{recurseOutput(node.content, state)}
					</Link>
				);
			},
		},
		inlineCode: {
			...inlineCode,
			react: (
				node: {
					content: string;
					target: string;
					title: string;
				},
				recurseOutput: (node: any, state: any) => any,
				state: any,
			) => (
				<code className={'bg-neutral-100 dark:bg-neutral-700'} key={state.key}>
					{recurse(node, recurseOutput, state)}
				</code>
			),
		},
		codeBlock: {
			...codeBlock,
			react: (
				node: {
					content: string;
					target: string;
					title: string;
					lang: string | undefined;
				},
				recurseOutput: (node: any, state: any) => any,
				state: any,
			) => (
				<Code
					key={state.key}
					lang={node.lang?.toLowerCase()}
					className={'overflow-x-scroll'}
					theme={{
						light: 'github-light',
						dark: 'github-dark',
					}}
				>
					{recurse(node, recurseOutput, state)}
				</Code>
			),
		},
		blockQuote: {
			...blockQuote,
			react: (
				node: {
					content: string;
					target: string;
					title: string;
					lang: string | undefined;
				},
				recurseOutput: (node: any, state: any) => any,
				state: any,
			) => (
				// TODO: Style
				<blockquote key={state.key}>
					{recurse(node, recurseOutput, state)}
				</blockquote>
			),
		},
		spoiler: {
			...spoiler,
			react: (
				node: {
					content: string;
					target: string;
					title: string;
					lang: string | undefined;
				},
				recurseOutput: (node: any, state: any) => any,
				state: any,
				// TODO: Style
			) => <span key={state.key}>{recurse(node, recurseOutput, state)}</span>,
		},
		command: {
			...command,
			react: ({ name }: { name: string }) => '/' + name,
		},
	};
}
// @ts-ignore
export const parse = parserFor(createRules(baseRules)) as (
	str: string,
) => React.ReactNode;
