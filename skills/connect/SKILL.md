---
name: connect
description: Show how to connect the official Supabase and Vercel MCP servers in read-only mode, so /secure-hobby:audit --live can check the deployed configuration. Prints commands for the user to run; changes nothing itself.
argument-hint: [supabase|vercel]
disable-model-invocation: true
---

# Connect trusted MCP servers (read-only)

Read `${CLAUDE_PLUGIN_ROOT}/trusted-mcp.json` and show the user the setup for `$ARGUMENTS` (or for both servers if no argument was given). **Do not run these commands yourself.** Adding an MCP server changes the user's configuration, so the user runs them.

Explain in two lines why this is safe: both servers are the providers' official ones, Supabase is scoped to one project in `read_only` mode, and during an audit the secure-hobby guard additionally allows only the tools listed in `trusted-mcp.json` and catalog-only SQL.

## Supabase (official, hosted, OAuth)
Ask for the project ref (Dashboard → Project Settings → General → Reference ID), then give:
```bash
claude mcp add --transport http supabase "https://mcp.supabase.com/mcp?read_only=true&project_ref=<project-ref>"
```
Then: run `/mcp` in Claude Code, choose **supabase**, and sign in in the browser.

Alternative (local, pinned version; uses a personal access token with an expiry, created at supabase.com/dashboard/account/tokens):
```bash
claude mcp add supabase -e SUPABASE_ACCESS_TOKEN=<token> -- npx -y @supabase/mcp-server-supabase@0.13.0 --read-only --project-ref=<project-ref>
```
Recommend the hosted option: no local package to install, and no long-lived token on disk.

## Vercel (official, hosted, OAuth)
```bash
claude mcp add --transport http vercel https://mcp.vercel.com
```
Then `/mcp` → **vercel** → sign in.

## Rules
- The server names must be exactly `supabase` and `vercel`. For another name, add it to that server's `names` in `trusted-mcp.json`.
- Never connect a production database with a write-capable token for an audit.
- Afterwards: `/secure-hobby:audit <path> --live`.
