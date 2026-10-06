/**
 * The agent server, over stdio.
 *
 * A coding agent starts this as a child process and speaks the protocol on its
 * standard input and output. It is separate from the file that runs it so that
 * `spry mcp` and the `spryloom-mcp` binary are the same code: one install, and
 * the agent path and the terminal path cannot drift apart.
 *
 * It starts whether or not anybody is signed in. Somebody who installed it from
 * a plugin directory has never run `spry login`, and an agent shows nothing a
 * server prints before it starts, so a server that refused to start was a dead
 * end with its explanation out of sight (D111). Signed out, every tool says to
 * call `sign_in`, and that signs in from inside the agent.
 *
 * It will not take a token from its arguments. Anything on a command line is in
 * the process list. The token comes from the file the terminal already keeps,
 * with the same environment override the terminal honours.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Account } from './account.js';
import { createServer } from './server.js';
import { baseUrlFrom, tokenFor } from './session.js';
/**
 * Serve the agent tools on stdio.
 *
 * Returns once the transport is attached. The process then stays alive because
 * standard input is open, and ends when the agent closes it.
 */
export async function serveOverStdio(env = process.env, clientVersion) {
    const baseUrl = baseUrlFrom(env);
    const token = await tokenFor(baseUrl, env);
    const account = new Account({ baseUrl, token, env, clientVersion, reload: () => tokenFor(baseUrl, env) });
    const server = createServer({ account });
    await server.connect(new StdioServerTransport());
    return 'serving';
}
//# sourceMappingURL=stdio.js.map