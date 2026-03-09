# Cursor Cloud Agent — Architecture & Internals

> Reverse-engineered from a live Cursor Cloud Agent session running `claude-4.6-opus-high-thinking`.
> All findings are based on runtime inspection of `/exec-daemon/index.js` (15MB webpack bundle, 379K lines),
> process inspection, network analysis, and system introspection. Date: February 25, 2026.

---

## Table of Contents

1. [Infrastructure Overview](#1-infrastructure-overview)
2. [Process Architecture](#2-process-architecture)
3. [Exec Daemon Internals](#3-exec-daemon-internals)
4. [Tools Available to the Agent](#4-tools-available-to-the-agent)
5. [Protobuf Tool Registry (All 36 Tools)](#5-protobuf-tool-registry-all-36-tools)
6. [Subagent System](#6-subagent-system)
7. [Computer Use Subsystem](#7-computer-use-subsystem)
8. [Display & Desktop Stack](#8-display--desktop-stack)
9. [RPC Services](#9-rpc-services)
10. [Internal Package Map](#10-internal-package-map)
11. [Security & Sandboxing](#11-security--sandboxing)
12. [Telemetry & Tracing](#12-telemetry--tracing)
13. [MCP Integration](#13-mcp-integration)
14. [Cursor Rules & Skills](#14-cursor-rules--skills)

---

## 1. Infrastructure Overview

The Cloud Agent runs inside a **three-layer virtualization stack** on AWS:

```
AWS EC2 bare metal (us-east-2, Ohio)
  └─ Firecracker microVM (kernel 6.12.58+, custom build)
      └─ Docker container (Ubuntu 24.04 Noble)
           └─ Agent processes
```

### Hardware Allocation

| Resource | Value |
|----------|-------|
| **CPU** | 4x Intel Xeon @ 2.4GHz |
| **RAM** | 16 GB |
| **Disk** | 126 GB overlay filesystem |
| **Network** | Full internet access, private IP 172.30.0.2/24 |
| **Public IP** | AWS EC2 (e.g., `ec2-3-139-131-44.us-east-2.compute.amazonaws.com`) |
| **DNS** | 10.0.0.2 (Docker-managed) |
| **Kernel** | Linux 6.12.58+ (custom Firecracker build) |
| **Init** | `/pod-daemon` (static binary, not systemd) |

### Network Ports

| Port | Service | Process |
|------|---------|---------|
| 5901 | TigerVNC server (localhost only) | Xtigervnc |
| 26053 | Exec daemon HTTP API (ConnectRPC) | node (exec-daemon) |
| 26054 | PTY WebSocket server | node (exec-daemon) |
| 26058 | noVNC web proxy | python3 (websockify) |
| 26500 | Pod management gRPC | pod-daemon |
| 50052 | Internal service | pod-daemon |
| 2375 | Docker Engine API | dockerd |

---

## 2. Process Architecture

### PID 1: `/pod-daemon`

A static-linked ELF binary (Go or Rust) that serves as the container's init process. It replaces systemd and manages the lifecycle of all child processes. Exposes gRPC services on ports 26500 and 50052 for pod orchestration.

### Desktop Init: `/usr/local/share/desktop-init.sh`

A bash script called "AnyOS Desktop Environment Entrypoint" (Anysphere's custom desktop distro). It orchestrates startup in phases:

1. **D-Bus** — starts the system message bus
2. **VNC + XFCE + Docker** — launched in parallel:
   - TigerVNC server on `:1` (1920x1200 @ 96 DPI)
   - XFCE4 session (window manager, panel, desktop)
   - Docker daemon
3. **noVNC** — websocket proxy (port 26058 → VNC 5901)
4. **Plank** — macOS-style dock with Chrome, Thunar, Terminal

Configuration sourced from `/usr/local/share/anyos.conf`:
- Display: 1920x1200x24, 96 DPI
- GDK_SCALE=1, QT_SCALE_FACTOR=1
- Software rendering: `LIBGL_ALWAYS_SOFTWARE=1`, `GALLIUM_DRIVER=llvmpipe`
- Dock icon size: 48px, panel height: 28px

### Exec Daemon (PID 347)

The core agent service:
```
/exec-daemon/node /exec-daemon/index.js serve \
  --port 26053 \
  --pty-websocket-port 26054 \
  --auth-token <token> \
  --rg-path /exec-daemon/rg \
  --cloud-rules-enabled \
  --computer-use-enabled \
  --browser-enabled \
  --record-screen-enabled \
  --secret-redaction-enabled \
  --trace-endpoint https://api2.cursor.sh \
  --trace-auth-token <jwt> \
  --ghost-mode false
```

---

## 3. Exec Daemon Internals

### Bundle Structure

The exec daemon is a webpack-bundled Node.js application:

| File | Size | Purpose |
|------|------|---------|
| `index.js` | 15 MB (379K lines) | Main webpack bundle |
| `252.index.js` | 4 KB | Async chunk: OpenTelemetry machine-id (Windows) |
| `407.index.js` | 4 KB | Async chunk: OpenTelemetry machine-id (BSD) |
| `511.index.js` | 4 KB | Async chunk: OpenTelemetry machine-id (macOS) |
| `953.index.js` | 2 KB | Async chunk: OpenTelemetry machine-id (unsupported) |
| `980.index.js` | 2 KB | Async chunk: OpenTelemetry machine-id (Linux) |
| `node` | 123 MB | Bundled Node.js v22 binary |
| `rg` | 5.4 MB | Bundled ripgrep binary |
| `gh` | 55 MB | Bundled GitHub CLI binary |
| `cursorsandbox` | 4.5 MB | Static sandbox binary (stripped) |
| `pty.node` | 73 KB | Native PTY addon (node-pty) |
| `97f64a4d8eca9a2e35bb.mp4` | 63 KB | Bundled video asset |
| `package.json` | 173 B | `@anysphere/exec-daemon-runtime` metadata |
| `exec-daemon` | 327 B | Bash wrapper script |

### Source Module Map (from `./src/*.ts`)

| Module | Webpack Key | Purpose |
|--------|-------------|---------|
| `src/index.ts` | Entry point | CLI parsing (Commander.js), `runServer()` |
| `src/server.ts` | `startServer`, `startPtyHostWebSocketServer` | HTTP + WebSocket servers |
| `src/setup.ts` | `setupDaemon` | Initializes all services and tools |
| `src/git.ts` | `GitService` | Git operations, GitHub token refresh |
| `src/logger.ts` | `FilteredLoggerBackend` | Log level filtering (debug/info/warn/error) |
| `src/tracing.ts` | `initTracing`, `shutdownTracing` | OpenTelemetry setup |
| `src/artifactUploads.ts` | Artifact upload manager | Upload screenshots/videos to backend |
| `src/mcp-token-storage.ts` | MCP OAuth tokens | Ephemeral token storage for MCP OAuth |

### CLI Options (`serve` subcommand)

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-p, --port` | int | 8080 | HTTP server port |
| `--pty-websocket-port` | int | 8081 | PTY WebSocket port |
| `--auth-token` | string | **required** | Authentication token |
| `--log-level` | choice | "info" | debug/info/warn/error |
| `--rg-path` | string | "rg" | Path to ripgrep binary |
| `--browser-enabled` | bool | false | Enable browser automation |
| `--cursor-self-control-enabled` | bool | false | **Deprecated** — use CUA-based testing |
| `--mcp-config` | JSON | — | MCP server configuration |
| `--mcp-oauth-server-urls` | JSON | — | MCP servers using OAuth |
| `--http-mcp-tools-file` | path | — | HTTP MCP tool definitions file |
| `--cloud-rules-enabled` | bool | false | Enable cloud rules |
| `--computer-use-enabled` | bool | false | Enable computer use |
| `--secret-redaction-enabled` | bool | false | Enable secret scanning in output |
| `--chrome-executable-path` | path | — | Custom Chrome path |
| `--record-screen-enabled` | bool | false | Enable screen recording |
| `--generate-image-enabled` | bool | false | Enable AI image generation |
| `--sandbox-enabled` | bool | false | Enable sandbox enforcement |
| `--sandbox-helper-path` | path | — | Path to `cursorsandbox` binary |
| `--claude-md-enabled` | bool | true | Load claude.md / AGENTS.md |
| `--no-claude-md-enabled` | — | — | Disable claude.md loading |
| `--trace-endpoint` | URL | — | OpenTelemetry trace endpoint |
| `--trace-auth-token` | string | — | Trace authentication token |
| `--ghost-mode` | bool | true | Privacy mode (disables tracing) |
| `--trace-insecure` | bool | false | Skip SSL for trace endpoint |

---

## 4. Tools Available to the Agent

These are the 15 tools directly available in the agent's tool interface (what the model can call):

### 4.1 Shell

Execute terminal commands in a stateful bash session. Environment persists across calls.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | **yes** | The shell command to execute |
| `description` | string | no | 5-10 word description of what the command does |
| `working_directory` | string | no | Absolute path to execute in (defaults to cwd) |
| `timeout` | number | no | Timeout in ms (default 30000, max 600000) |
| `is_background` | boolean | no | Run command in background |

**Internal proto:** `agent.v1.ShellArgs` with additional fields: `tool_call_id`, `simple_commands` (deprecated), `has_input_redirect` (deprecated), `has_output_redirect` (deprecated), `parsing_result`, `requested_sandbox_policy`, `file_output_threshold_bytes`, `is_background`.

**Streaming:** Output streamed via `ShellToolCallDelta` (stdout + stderr deltas).

### 4.2 Glob

Search for files matching glob patterns. Fast across any codebase size.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `glob_pattern` | string | **yes** | Pattern (auto-prepends `**/` if not present) |
| `target_directory` | string | no | Directory to search in |

**Internal proto:** `agent.v1.GlobToolArgs` → `GlobToolResult` (success with file list, or error).

### 4.3 Grep

Ripgrep-powered search with full regex support.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pattern` | string (regex) | **yes** | Search pattern |
| `path` | string | no | File or directory to search |
| `glob` | string | no | File filter glob (e.g., `*.js`) |
| `type` | string | no | File type filter (e.g., `js`, `py`, `rust`) |
| `output_mode` | enum | no | `content` (default), `files_with_matches`, `count` |
| `-A` | number | no | Lines after each match |
| `-B` | number | no | Lines before each match |
| `-C` | number | no | Lines before and after each match |
| `-i` | boolean | no | Case insensitive search |
| `multiline` | boolean | no | Enable cross-line matching |
| `head_limit` | number | no | Limit output matches |
| `offset` | number | no | Skip first N entries |

**Internal proto:** `agent.v1.GrepArgs` with additional fields: `sort`, `sort_ascending`, `tool_call_id`, `sandbox_policy`.

### 4.4 Read

Read file contents. Supports text files, images (jpeg, png, gif, webp), and PDFs.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | **yes** | Absolute file path |
| `offset` | integer | no | Start line (1-indexed, negative = from end) |
| `limit` | integer | no | Number of lines to read |

**Internal proto:** `agent.v1.ReadToolArgs` → `ReadToolResult` containing `ReadRange` objects with `start_line`, `end_line`, `contents`, and metadata.

### 4.5 Write

Create or overwrite a file.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | **yes** | Absolute file path |
| `contents` | string | **yes** | File contents to write |

### 4.6 StrReplace

Exact string replacement in files. Fails if `old_string` is not unique (unless `replace_all` is true).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | **yes** | Absolute file path |
| `old_string` | string | **yes** | Text to find |
| `new_string` | string | **yes** | Replacement text |
| `replace_all` | boolean | no | Replace all occurrences (default false) |

### 4.7 Delete

Delete a file. Fails gracefully if file doesn't exist or is protected.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | **yes** | Absolute file path |

**Internal proto:** `agent.v1.DeleteArgs` → `DeleteResult`.

### 4.8 EditNotebook

Edit Jupyter notebook cells. Can edit existing cells or create new ones.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target_notebook` | string | **yes** | Path to .ipynb file |
| `cell_idx` | number | **yes** | Cell index (0-based) |
| `is_new_cell` | boolean | **yes** | true = create new, false = edit existing |
| `cell_language` | enum | **yes** | `python`, `markdown`, `javascript`, `typescript`, `r`, `sql`, `shell`, `raw`, `other` |
| `old_string` | string | **yes** | Text to replace (empty for new cells) |
| `new_string` | string | **yes** | New cell content |

### 4.9 TodoWrite

Create or update a structured TODO list for task management.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `todos` | array (min 2) | **yes** | Array of `{id, content, status}` objects |
| `merge` | boolean | **yes** | true = merge with existing, false = replace all |

**TodoItem fields:**
- `id` (string) — unique identifier
- `content` (string) — description
- `status` (enum) — `pending`, `in_progress`, `completed`, `cancelled`

**Internal protos:** `agent.v1.UpdateTodosToolCall` (write), `agent.v1.ReadTodosToolCall` (read). `TodoItem` has fields: `id`, `content`, `status`.

### 4.10 WebSearch

Search the web for real-time information.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `search_term` | string | **yes** | The search query |
| `explanation` | string | no | Why this search is being performed |

**Internal proto:** `agent.v1.WebSearchArgs` → `WebSearchResult` containing `WebSearchReference` objects (title, URL, snippet) or `WebSearchRejected`.

### 4.11 RecordScreen

Control screen recording of the VNC desktop display.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mode` | enum | **yes** | `START_RECORDING`, `SAVE_RECORDING`, `DISCARD_RECORDING` |
| `save_as_filename` | string | no | Custom filename (only for SAVE_RECORDING) |

**Internal proto:** `agent.v1.RecordScreenArgs` with `RecordingMode` enum. Uses `ffmpeg` to record the X11 display. Recordings saved to `/opt/cursor/artifacts/`.

### 4.12 SetupVmEnvironment

Define the startup script that runs on future VM sessions after pulling latest code.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `update_script` | string | **yes** | Dependency install commands (newline-separated) |

**Internal proto:** `agent.v1.SetupVmEnvironmentArgs` with `install_command` and deprecated `start_command`.

### 4.13 Task

Spawn a subagent for complex, multi-step tasks. See [Section 6](#6-subagent-system) for details.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `description` | string | **yes** | 3-5 word task summary |
| `prompt` | string | **yes** | Detailed task instructions |
| `subagent_type` | enum | no | See subagent types below |
| `model` | enum | no | `fast` or inherit parent |
| `resume` | string | no | Agent ID to resume from |
| `readonly` | boolean | no | Restrict write operations |
| `attachments` | string[] | no | File paths for videoReview |

**Internal proto:** `agent.v1.TaskArgs` with `subagent_type` (`SubagentType`), `model`, `resume`, `agent_id`.

### 4.14 ListMcpResources

List available resources from configured MCP (Model Context Protocol) servers.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `server` | string | no | Filter by server identifier |

### 4.15 FetchMcpResource

Read a specific resource from an MCP server.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `server` | string | **yes** | MCP server identifier |
| `uri` | string | **yes** | Resource URI |
| `downloadPath` | string | no | Save to disk instead of returning |

---

## 5. Protobuf Tool Registry (All 36 Tools)

The `agent.v1.ToolCall` protobuf message defines a `oneof tool` with 36 variants. Many are internal or not exposed to the model. Here is the complete registry:

| Field # | Name | Proto Type | Exposed to Model | Description |
|---------|------|-----------|-----------------|-------------|
| 1 | `shell_tool_call` | `ShellToolCall` | **Yes** (Shell) | Execute shell commands |
| 3 | `delete_tool_call` | `DeleteToolCall` | **Yes** (Delete) | Delete files |
| 4 | `glob_tool_call` | `GlobToolCall` | **Yes** (Glob) | File pattern search |
| 5 | `grep_tool_call` | `GrepToolCall` | **Yes** (Grep) | Ripgrep search |
| 8 | `read_tool_call` | `ReadToolCall` | **Yes** (Read) | Read files |
| 9 | `update_todos_tool_call` | `UpdateTodosToolCall` | **Yes** (TodoWrite) | Update TODO list |
| 10 | `read_todos_tool_call` | `ReadTodosToolCall` | Internal | Read TODO list (auto) |
| 12 | `edit_tool_call` | `EditToolCall` | **Yes** (StrReplace/Write) | Edit files with streaming |
| 13 | `ls_tool_call` | `LsToolCall` | Internal | Directory listing |
| 14 | `read_lints_tool_call` | `ReadLintsToolCall` | Internal | Read linter diagnostics |
| 15 | `mcp_tool_call` | `McpToolCall` | Via MCP tools | Call MCP server tools |
| 16 | `sem_search_tool_call` | `SemSearchToolCall` | Internal | Semantic code search |
| 17 | `create_plan_tool_call` | `CreatePlanToolCall` | Internal | Create execution plans |
| 18 | `web_search_tool_call` | `WebSearchToolCall` | **Yes** (WebSearch) | Web search |
| 19 | `task_tool_call` | `TaskToolCall` | **Yes** (Task) | Spawn subagents |
| 20 | `list_mcp_resources_tool_call` | `ListMcpResourcesToolCall` | **Yes** | List MCP resources |
| 21 | `read_mcp_resource_tool_call` | `ReadMcpResourceToolCall` | **Yes** | Read MCP resources |
| 22 | `apply_agent_diff_tool_call` | `ApplyAgentDiffToolCall` | Internal | Apply code diffs |
| 23 | `ask_question_tool_call` | `AskQuestionToolCall` | Internal | Ask user questions |
| 24 | `fetch_tool_call` | `FetchToolCall` | Internal | HTTP fetch |
| 25 | `switch_mode_tool_call` | `SwitchModeToolCall` | Internal | Switch agent mode |
| 28 | `generate_image_tool_call` | `GenerateImageToolCall` | Conditional | AI image generation |
| 29 | `record_screen_tool_call` | `RecordScreenToolCall` | **Yes** (RecordScreen) | Screen recording |
| 30 | `computer_use_tool_call` | `ComputerUseToolCall` | Via Task/computerUse | GUI automation |
| 31 | `write_shell_stdin_tool_call` | `WriteShellStdinToolCall` | Internal | Write to process stdin |
| 32 | `reflect_tool_call` | `ReflectToolCall` | Internal | Agent self-reflection |
| 33 | `setup_vm_environment_tool_call` | `SetupVmEnvironmentToolCall` | **Yes** | VM environment setup |
| 34 | `truncated_tool_call` | `TruncatedToolCall` | Internal | Placeholder for truncated calls |
| 35 | `start_grind_execution_tool_call` | `StartGrindExecutionToolCall` | Internal | Grind batch execution |
| 36 | `start_grind_planning_tool_call` | `StartGrindPlanningToolCall` | Internal | Grind batch planning |
| 37 | `web_fetch_tool_call` | `WebFetchToolCall` | Internal | Web content fetch + parse |
| 38 | `report_bugfix_results_tool_call` | `ReportBugfixResultsToolCall` | Internal | Bugfix result reporting |
| 39 | `ai_attribution_tool_call` | `AiAttributionToolCall` | Internal | AI code attribution |
| 40 | `pr_management_tool_call` | `PrManagementToolCall` | Internal | PR/MR management |
| 41 | `mcp_auth_tool_call` | `McpAuthToolCall` | Internal | MCP OAuth flow |
| 42 | `await_tool_call` | `AwaitToolCall` | Internal | Wait for external events |

Note: Field numbers 2, 6, 7, 11, 26, 27 are unused/reserved.

### ToolCallDelta (Streaming)

Three tool types support streaming deltas:

| Delta Type | Streaming Fields |
|-----------|-----------------|
| `ShellToolCallDelta` | `stdout` (string), `stderr` (string) |
| `TaskToolCallDelta` | Subagent output streaming |
| `EditToolCallDelta` | File content streaming |

---

## 6. Subagent System

Subagents are spawned via the `Task` tool. Each runs as a separate inference loop with its own context, but shares the same exec-daemon for tool execution.

### 6.1 Available Subagent Types

| Type | Proto Message | Description | Stateful? |
|------|--------------|-------------|-----------|
| `generalPurpose` | `SubagentTypeUnspecified` | Research, search, multi-step tasks | No |
| `explore` | `SubagentTypeExplore` | Fast codebase exploration | No |
| `debug` | `SubagentTypeDebug` | Hypothesis-driven bug investigation | **Yes** (auto-resumes) |
| `computerUse` | `SubagentTypeComputerUse` | GUI interaction via X11 | **Yes** (auto-resumes) |
| `videoReview` | `SubagentTypeMediaReview` | Analyze videos/images with vision model | No |
| `vmSetupHelper` | `SubagentTypeVmSetupHelper` | Codebase analysis for env setup | No |

Additional types defined in proto but not exposed to the model:
- `SubagentTypeBash` / `SubagentTypeShell` — shell-specific subagents
- `SubagentTypeBrowserUse` — browser automation (distinct from computerUse)
- `SubagentTypeCursorGuide` — interactive guidance
- `SubagentTypeCustom` — custom subagent type

### 6.2 Model Selection

| Alias | Cost | Intelligence | Use Case |
|-------|------|-------------|----------|
| `fast` | 1/10 | 5/10 | Quick, tightly-scoped changes |
| *(default/inherit)* | — | — | Inherits parent model |

### 6.3 Subagent Lifecycle

1. Parent agent calls `Task` tool with `prompt`, `description`, and `subagent_type`
2. Exec daemon creates a new agent session (assigned `agent_id`)
3. Subagent runs independently with its own tool access
4. On completion, returns a single result message to parent
5. Stateful agents (debug, computerUse) can be resumed via `agent_id`

---

## 7. Computer Use Subsystem

The computerUse subagent provides GUI automation through a vision-based loop. It has **no access to DOM, accessibility tree, or Chrome DevTools Protocol**.

### 7.1 Architecture

```
computerUse subagent (vision model)
  │
  ├─ Sees: Screenshots (webp, 1280x800)
  │
  └─ Emits: ComputerUseAction[]
       │
       └─ X11ComputerUseExecutor
            │
            ├─ CoordinateScaler (1280x800 ↔ 1920x1200)
            │
            └─ X11Executor
                 │
                 └─ xdotool (injects events into X11)
```

### 7.2 ComputerUseAction — 11 Primitive Actions

| # | Action | Proto Message | xdotool Command | Parameters |
|---|--------|--------------|----------------|------------|
| 1 | `mouse_move` | `MouseMoveAction` | `xdotool mousemove --sync {x} {y}` | `coordinate: {x, y}` |
| 2 | `click` | `ClickAction` | `xdotool click {button}` | `coordinate: {x, y}`, `button: MouseButton` |
| 3 | `mouse_down` | `MouseDownAction` | `xdotool mousedown {button}` | `coordinate: {x, y}`, `button: MouseButton` |
| 4 | `mouse_up` | `MouseUpAction` | `xdotool mouseup {button}` | `coordinate: {x, y}`, `button: MouseButton` |
| 5 | `drag` | `DragAction` | sequence of mousemove+mousedown+mousemove+mouseup | `start: {x, y}`, `end: {x, y}`, `button: MouseButton` |
| 6 | `scroll` | `ScrollAction` | `xdotool click {4/5/6/7}` | `coordinate: {x, y}`, `direction: ScrollDirection`, `amount: int` |
| 7 | `type` | `TypeAction` | `xdotool type --delay 12` | `text: string` (batched in groups of 50 chars) |
| 8 | `key` | `KeyAction` | `xdotool key {combo}` | `key: string` (e.g., `ctrl+c`, `Return`, `alt+F4`) |
| 9 | `wait` | `WaitAction` | `setTimeout(ms)` | `duration_ms: int` |
| 10 | `screenshot` | `ScreenshotAction` | X11 framebuffer capture → webp | *(no parameters)* |
| 11 | `cursor_position` | `CursorPositionAction` | `xdotool getmouselocation` | *(no parameters)* |

### 7.3 Mouse Button Enum

| Value | Name | xdotool Button |
|-------|------|---------------|
| 0 | UNSPECIFIED | 1 (left) |
| 1 | LEFT | 1 |
| 2 | MIDDLE | 2 |
| 3 | RIGHT | 3 |
| 4 | BACK | 8 |
| 5 | FORWARD | 9 |

### 7.4 Scroll Direction Enum

| Value | Name | xdotool Button |
|-------|------|---------------|
| 0 | UNSPECIFIED | 5 (down) |
| 1 | UP | 4 |
| 2 | DOWN | 5 |
| 3 | LEFT | 6 |
| 4 | RIGHT | 7 |

### 7.5 Coordinate Scaling

The `CoordinateScaler` converts between API resolution (what the vision model sees) and display resolution (the actual VNC framebuffer):

| | Width | Height | Aspect Ratio |
|--|-------|--------|-------------|
| **API (model sees)** | 1280 | 800 | 16:10 |
| **Display (VNC)** | 1920 | 1200 | 16:10 |
| **Scale factor** | 1.5× | 1.5× | — |

Coordinate math:
- **API → Display**: `display_x = round(api_x × 1.5)`, `display_y = round(api_y × 1.5)`
- **Display → API**: `api_x = round(display_x / 1.5)`, `api_y = round(display_y / 1.5)`

### 7.6 Timing Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `screenshotDelayMs` | 2000 | Delay before taking screenshot (let UI settle) |
| `typingDelayMs` | 12 | Delay between keystrokes |
| `typingBatchSize` | 50 | Characters per xdotool type invocation |

### 7.7 Screenshot Pipeline

1. X11Executor captures the framebuffer from display `:1`
2. Image scaled from 1920x1200 → 1280x800
3. Encoded as webp (base64)
4. Saved to `/tmp/computer-use/{5-char-hex}.webp`
5. Sent to vision model as part of the subagent's context

### 7.8 What Computer Use Does NOT Have

- ❌ DOM access
- ❌ Chrome DevTools Protocol (CDP)
- ❌ Accessibility tree (AT-SPI)
- ❌ Browser JavaScript execution
- ❌ OCR (relies on vision model to "read" pixels)
- ❌ File system tools
- ❌ Shell access (only the parent agent has these)

---

## 8. Display & Desktop Stack

### 8.1 Component Stack

| Layer | Component | Details |
|-------|-----------|---------|
| **X Server** | TigerVNC (`Xtigervnc`) | Display `:1`, localhost:5901, 1920x1200@24bpp, 96 DPI |
| **Window Manager** | xfwm4 (XFCE) | Manages window decorations, focus, positioning |
| **Desktop** | xfdesktop | Background, desktop icons |
| **Panel** | xfce4-panel | Top bar with Applications menu, clock |
| **Dock** | Plank | Bottom dock with Chrome, Thunar, Terminal |
| **File Manager** | Thunar | Running as daemon |
| **Browser** | Google Chrome | `--no-sandbox --remote-debugging-port=9222 --window-size=1840,1120` |
| **Web proxy** | noVNC + websockify | Port 26058, bridges browser WebSocket → VNC |
| **Theme** | WhiteSur-Light (Plank) | macOS-inspired appearance |

### 8.2 Chrome Launch Flags

Chrome is launched with these flags (observed from `/proc/{pid}/cmdline`):

```
/opt/google/chrome/chrome
  --no-sandbox
  --test-type
  --disable-dev-shm-usage
  --use-gl=angle
  --use-angle=swiftshader-webgl
  --password-store=basic
  --no-first-run
  --no-default-browser-check
  --remote-debugging-port=9222
  --user-data-dir=/home/ubuntu/.config/google-chrome
  --class=google-chrome
  --window-size=1840,1120
  --window-position=20,50
```

Note: `--remote-debugging-port=9222` is set but the port is not actually listening in practice.

### 8.3 Accessibility Infrastructure

| Component | Status | Notes |
|-----------|--------|-------|
| AT-SPI2 bus launcher | Running | `/usr/libexec/at-spi-bus-launcher` |
| AT-SPI2 D-Bus daemon | Running | `unix:path=/home/ubuntu/.cache/at-spi/bus_1` |
| AT-SPI2 registryd | Running | `--use-gnome-session` |
| Python bindings | Available | `gir1.2-atspi-2.0` installed |
| Chrome on AT-SPI | **Not registered** | Needs `--force-renderer-accessibility` |
| xdotool | Available | `/usr/bin/xdotool` |
| xprop | Available | `/usr/bin/xprop` |
| xwininfo | Available | `/usr/bin/xwininfo` |

---

## 9. RPC Services

The exec daemon exposes two services via ConnectRPC (protobuf over HTTP):

### 9.1 ControlService (`agent.v1.ControlService`)

Port 26053. The main management API.

| RPC Method | Type | Description |
|-----------|------|-------------|
| `Ping` | Unary | Health check |
| `Exec` | Server Streaming | Execute a tool call |
| `ListDirectory` | Unary | Browse filesystem paths |
| `ReadTextFile` | Unary | Read text file contents |
| `WriteTextFile` | Unary | Write text file contents |
| `ReadBinaryFile` | Unary | Read binary file contents |
| `WriteBinaryFile` | Unary | Write binary file contents |
| `GetDiff` | Unary | Get git diff |
| `GetWorkspaceChangesHash` | Unary | Hash of workspace changes |
| `RefreshGithubAccessToken` | Unary | Refresh GitHub OAuth token |
| `WarmRemoteAccessServer` | Unary | Start remote Cursor IDE server |
| `DownloadCursorServer` | Unary | Pre-download Cursor server binary |
| `ListArtifacts` | Unary | List uploaded artifacts |
| `UploadArtifacts` | Unary | Upload screenshots/videos |
| `GetMcpRefreshTokens` | Unary | Get MCP OAuth refresh tokens |
| `UpdateEnvironmentVariables` | Unary | Update env vars for spawned processes |

### 9.2 ExecService (`agent.v1.ExecService`)

Port 26053 (same). Bidirectional streaming for tool execution.

| RPC Method | Type | Description |
|-----------|------|-------------|
| `ExecStream` | Bidi Streaming | Stream `ExecStreamElement` (client messages + control messages) |

`ExecStreamElement` is a oneof of:
- `exec_client_message` (`ExecClientMessage`) — tool calls from the AI model
- `exec_client_control_message` (`ExecClientControlMessage`) — control signals

### 9.3 PTY Host WebSocket Server

Port 26054. Manages terminal sessions.

- Uses `node-pty` native addon (`pty.node`)
- WebSocket-based protocol for terminal I/O
- Managed by `PtyManager` class

---

## 10. Internal Package Map

The webpack bundle contains these Anysphere-authored packages (identified from `../{package}/dist/index.js` import paths):

| Package | Import Path | Purpose |
|---------|------------|---------|
| `@anysphere/agent-exec` | `../agent-exec/dist/index.js` | Core tool execution engine — dispatches Shell, Read, Write, Grep, Glob, etc. |
| `@anysphere/shell-exec` | `../shell-exec/dist/index.js` | Shell command execution, ripgrep integration, sandbox support |
| `@anysphere/context` | `../context/dist/index.js` | Request context propagation (tracing spans, cancellation signals) |
| `@anysphere/context-rpc` | `../context-rpc/dist/index.js` | ConnectRPC wrappers injecting trace context into gRPC calls |
| `@anysphere/hooks` | `../hooks/dist/index.js` | Pre/post tool-use hook system (user-defined scripts) |
| `@anysphere/metrics` | `../metrics/dist/index.js` | Metrics collection (counters, histograms) |
| `@anysphere/utils` | `../utils/dist/index.js` | Shared utility functions |
| `@anysphere/proto` | `../proto/dist/generated/**` | All protobuf message and service definitions |
| `@anysphere/cursor-config` | `../cursor-config/dist/**` | Authentication (LoginManager, PKCE flow), API URLs |
| `@anysphere/local-exec` | `../local-exec/dist/**` | Computer use executor, coordinate scaling, X11 tools |

### Key Third-Party Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@connectrpc/connect` | 1.6.1 (patched) | ConnectRPC framework |
| `@connectrpc/connect-node` | — | Node.js HTTP transport |
| `@grpc/grpc-js` | 1.13.3 | gRPC client/server |
| `@grpc/proto-loader` | 0.7.13 | Protobuf loader for gRPC |
| `@bufbuild/protobuf` | 1.10.0 | Protobuf runtime (ES) |
| `@opentelemetry/api` | 1.9.0 | OpenTelemetry API |
| `@opentelemetry/*` | 2.2.0 / 0.208.0 | Full OTel SDK (traces, metrics, logs, exporters) |
| `commander` | 14.0.0 | CLI argument parsing |
| `@commander-js/extra-typings` | 14.0.0 | TypeScript types for Commander |

---

## 11. Security & Sandboxing

### 11.1 cursorsandbox Binary

`/exec-daemon/cursorsandbox` — a static-linked, stripped ELF binary (4.5 MB). Used for filesystem sandboxing when `--sandbox-enabled` is set. Invoked via `configureSandboxPrereqs()` from `@anysphere/shell-exec`.

### 11.2 Authentication

- All HTTP requests to port 26053 require the `--auth-token` (verified per-request)
- The auth token is a 64-character hex string
- GitHub access tokens are refreshed via the `RefreshGithubAccessToken` RPC
- MCP OAuth tokens are managed via ephemeral scoped storage

### 11.3 Secret Redaction

When `--secret-redaction-enabled` is active:
- Reads `CLOUD_AGENT_INJECTED_SECRET_NAMES` from environment
- Scans tool call outputs for matching secret values
- Replaces detected secrets with `[REDACTED]`

### 11.4 Sandbox Policy

The `SandboxPolicy` protobuf message is attached to shell and grep operations, controlling filesystem access restrictions. The `cursorsandbox` binary enforces these policies.

### 11.5 Permission Service

`DaemonPermissionsService` manages tool-level permissions. In Cloud Agent mode, most tools are pre-approved (no user confirmation needed).

---

## 12. Telemetry & Tracing

### 12.1 OpenTelemetry Setup

When ghost mode is disabled and trace endpoint + token are provided:

- **Trace endpoint:** `https://api2.cursor.sh`
- **Auth:** JWT token with `exec_daemon` scope
- **Exporters:** gRPC-based OTLP (traces, metrics, logs)
- **Context propagation:** W3C `traceparent` + custom `backend-traceparent` headers

### 12.2 Metrics

Metrics are collected via `@anysphere/metrics`:
- `computer_use.session.duration` (histogram)
- `computer_use.session.action_count` (histogram)
- `computer_use.session.result` (counter, labels: `outcome`)

### 12.3 Privacy Mode (Ghost Mode)

When `--ghost-mode true`:
- All tracing is disabled
- No telemetry sent to backend
- Default is `true` (opt-in to tracing)

---

## 13. MCP Integration

### 13.1 MCP Server Loading

MCP servers are configured via `--mcp-config` (JSON) or `--http-mcp-tools-file` (file path).

- **Stdio MCP servers:** Loaded locally by the exec daemon
- **HTTP MCP servers:** Handled by the Cursor backend, tools passed via `--http-mcp-tools-file`

### 13.2 MCP OAuth

`McpOAuthStoredData` protobuf:
- `refresh_token`, `client_id`, `client_secret`, `redirect_uris`, `access_token`

Token storage is ephemeral (in-memory, per-session). Refresh tokens can be fetched via `GetMcpRefreshTokens` RPC.

### 13.3 MCP Auth Tool

The special `mcp_auth` tool (tool name constant: `MCP_AUTH_TOOL_NAME = "mcp_auth"`) handles OAuth authentication flows for MCP servers that require it.

---

## 14. Cursor Rules & Skills

### 14.1 Rules Services

Multiple rules services are merged:

| Service | Source | Description |
|---------|--------|-------------|
| `LocalCursorRulesService` | `.cursorrules`, `AGENTS.md`, etc. | Workspace-level rules, nested loading |
| `AgentSkillsCursorRulesService` | `~/.cursor/skills`, workspace skills | Agent skills/SOPs |
| `LocalCloudRulesService` | Cloud-specific | Additional rules for cloud agents |
| `MergedCursorRulesService` | All above | Combines all sources |

### 14.2 Skills

Skills are Standard Operating Procedures (SOPs) loaded from:
- `~/.cursor/skills/` (may not exist in cloud VMs)
- Workspace-level skill files
- Referenced in AGENTS.md with file paths and scenario descriptions

### 14.3 Subagents Service

`MergedSubagentsService` combines:
- `LocalSubagentsService` — workspace-defined subagents
- `CursorRulesSubagentsService` — subagents from cursor rules

### 14.4 Hooks System

The `HooksToolName` enum defines which tools support pre/post hooks:

| Hook Tool Name | Tool |
|---------------|------|
| `Shell` | Shell command execution |
| `WriteShellStdin` | Writing to process stdin |
| `ComputerUse` | GUI automation |
| `Delete` | File deletion |
| `ReadLints` | Lint diagnostics |
| `Fetch` | HTTP fetch |
| `Grep` | Code search |
| `LS` | Directory listing |
| `ListMcpResources` | MCP resource listing |
| `FetchMcpResource` | MCP resource fetching |
| `Read` | File reading |
| `RecordScreen` | Screen recording |
| `Write` | File writing |

Hooks are user-defined scripts that run before/after tool execution. Scripts are filtered by regex matchers against tool names.

---

## Appendix A: Environment Variables

| Variable | Value | Purpose |
|----------|-------|---------|
| `CURSOR_AGENT` | `1` | Identifies this as a Cursor agent environment |
| `DISPLAY` | `:1` | X11 display for GUI operations |
| `FORCE_COLOR` | `0` | Disable color output in tools |
| `NO_COLOR` | `1` | Alternative no-color flag |
| `HOME` | `/home/ubuntu` | User home directory |
| `HOSTNAME` | `cursor` | Container hostname |
| `NVM_DIR` | `/home/ubuntu/.nvm` | Node Version Manager |
| `VNC_DPI` | `96` | VNC display DPI |
| `VNC_RESOLUTION` | `1920x1200x24` | VNC display resolution |
| `GIT_LFS_SKIP_SMUDGE` | `1` | Skip Git LFS downloads |
| `GIT_DISCOVERY_ACROSS_FILESYSTEM` | `0` | Restrict git discovery |

## Appendix B: File System Layout

```
/
├── pod-daemon                    # PID 1 init (static binary)
├── exec-daemon/
│   ├── exec-daemon               # Bash wrapper
│   ├── node                      # Bundled Node.js v22
│   ├── index.js                  # 15MB webpack bundle (main app)
│   ├── {252,407,511,953,980}.index.js  # Async chunks (OTel machine-id)
│   ├── rg                        # Bundled ripgrep
│   ├── gh                        # Bundled GitHub CLI
│   ├── cursorsandbox             # Sandbox enforcement binary
│   ├── pty.node                  # Native PTY addon
│   └── package.json              # @anysphere/exec-daemon-runtime
├── opt/
│   ├── cursor/artifacts/         # Artifact upload directory
│   └── google/chrome/            # Google Chrome installation
├── usr/local/
│   ├── share/
│   │   ├── desktop-init.sh       # AnyOS desktop init script
│   │   └── anyos.conf            # Display/scaling configuration
│   └── novnc/                    # noVNC web client
├── home/ubuntu/
│   ├── .cache/
│   │   ├── ms-playwright/        # Playwright browser cache
│   │   ├── puppeteer/            # Puppeteer browser cache
│   │   └── at-spi/               # AT-SPI accessibility bus socket
│   ├── .config/google-chrome/    # Chrome user data
│   ├── .nvm/                     # Node Version Manager
│   ├── .cursor/                  # Cursor project config
│   └── go/bin/                   # Go binaries
├── workspace/                    # Repository checkout (cwd)
└── tmp/
    └── computer-use/             # Screenshots from computerUse subagent
```
