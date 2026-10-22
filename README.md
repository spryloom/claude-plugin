# Spryloom for Claude

The plugin is in [`share/`](share/): a skill and Spryloom's hosted connector
(`https://app.spryloom.com/mcp`) for building an app or page with Claude and
sharing it with your team, behind sign-in. Nothing in it runs on your computer. See
[share/README.md](share/README.md).

Install it in Claude Code:

```
/plugin marketplace add spryloom/claude-plugin
/plugin install spryloom@spryloom
```

In Claude.ai, add `https://app.spryloom.com/mcp` as a custom connector under
**Settings → Connectors**.

For apps with a database, scheduled jobs or email, see
[spryloom.com/docs](https://spryloom.com/docs). Spryloom's main repository is
[spryloom/spryloom](https://github.com/spryloom/spryloom).
