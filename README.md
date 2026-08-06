# AI Data Explorer

A **Generative UI** app where an AI agent responds not just with text, but with live React components — charts, cards, and greetings — rendered directly in the chat window based on what you ask.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, Vite, Tailwind CSS v4, Vercel AI SDK (`@ai-sdk/react`) |
| **Backend** | Python, FastAPI, Vercel AI SDK for Python (`ai`) |
| **Model** | OpenAI `gpt-4o-mini` (swappable to Gemini) |
| **Charts** | Recharts |
| **Streaming** | Server-Sent Events (SSE) via Vercel AI Data Stream Protocol |

---

## Prerequisites

| Tool | Required |
|---|---|
| **Python** | 3.11+ |
| **Node.js** | 18+ |
| **npm** | 8+ |

---

## Setup

### 1 — Python environment

```powershell
conda create -n genui python=3.11 -y
conda activate genui
pip install -r requirements.txt
```

### 2 — API keys

Create a `.env` file in the project root:

```env
OPENAI_API_KEY=sk-...
# Optional — only needed if switching to Gemini
GOOGLE_API_KEY=AI...
```

### 3 — Frontend dependencies

```powershell
cd frontend
npm install
```

---

## Running

You need **two terminals** open simultaneously.

**Terminal 1 — Backend**
```powershell
conda activate genui
uvicorn backend.server:app --host 0.0.0.0 --port 8003 --reload
```

**Terminal 2 — Frontend**
```powershell
cd frontend
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## Try it out

| Prompt | What renders |
|---|---|
| *"Say hello to Bhanu"* | Gradient greeting card with the name |
| *"Show me a pie chart of revenue by category"* | Queries `db.csv`, renders an interactive pie chart |
| *"Show a flight from SFO to JFK on Pacific Air at 08:30 for $249"* | Renders a flight summary card |

---

## How it works — end to end

### High-level flow

```
User types a prompt
      │
      ▼
useChat (Vercel AI SDK, React)
      │  POST /api/agent  (Vite dev proxy)
      ▼
FastAPI backend  ─────────────────────────────────┐
      │                                           │
      │  Vercel AI SDK for Python                 │
      │  streams back SSE chunks                  │
      ▼                                           │
gpt-4o-mini decides:                              │
  ├── reply as text?          → streams text      │
  └── call a tool?            → streams tool call │
            │                                     │
            ├── query_data   → reads db.csv ───────┘
            ├── pieChart     → frontend renders PieChart component
            ├── flightCard   → frontend renders FlightCard component
            └── showMyName   → frontend renders NameGreeting component
```

---

### Step-by-step breakdown

#### 1. User sends a message

The React frontend uses `useChat` from `@ai-sdk/react`. When the form is submitted, it POSTs the full conversation history to `/api/agent`.

```ts
// frontend/src/App.tsx
const { messages, sendMessage } = useChat({
  transport: new DefaultChatTransport({ api: "/api/agent" }),
});
```

Vite's dev server proxies `/api/agent` → `http://localhost:8003` (configured in `vite.config.ts`).

---

#### 2. Backend receives the request and runs the agent

`FastAPI` receives the POST, converts the Vercel AI SDK message format into native AI messages, prepends the system prompt, and runs the agent.

```python
# backend/server.py
@app.post("/")
async def chat(request: ChatRequest):
    messages, approvals = ai.ui.ai_sdk.to_messages(request.messages)
    messages.insert(0, ai.system_message(SYSTEM_PROMPT))
    async with chat_agent.run(MODEL, messages) as result:
        ...
```

The agent has access to four tools: `query_data`, `pieChart`, `flightCard`, and `showMyName`.

---

#### 3. The model decides: text or tool call?

`gpt-4o-mini` reads the conversation and system prompt and decides what to do:

- **Plain answer** → streams a text response directly.
- **Data needed first** → calls `query_data` to read `db.csv`, then uses the result to populate a UI tool.
- **UI component** → calls one of the frontend tools (`pieChart`, `flightCard`, `showMyName`) with structured arguments.

The system prompt guides this decision:

```python
SYSTEM_PROMPT = (
    "You are a helpful AI assistant. "
    "When a user asks for charts based on the dataset, always call query_data first..."
    "Use pieChart for category distributions, "
    "flightCard for a single flight summary, "
    "and showMyName to greet a user by name. ..."
)
```

---

#### 4. Backend streams the response as SSE

Whether it's text or a tool call, the backend streams it back as **Server-Sent Events** using the Vercel AI Data Stream Protocol. Each chunk is a small piece of the response (a token, a tool invocation, a tool result).

```python
async for chunk in ai.ui.ai_sdk.to_sse(process()):
    yield chunk
```

The `StreamingResponse` has special headers so the frontend SDK knows how to parse it:

```python
return fastapi.responses.StreamingResponse(
    stream_response(),
    headers=ai.ui.ai_sdk.UI_MESSAGE_STREAM_HEADERS,
)
```

---

#### 5. Frontend receives and parses the stream

`useChat` on the frontend continuously reads the SSE stream and builds up a list of **message parts**. Each part has a type:

| Part type | Meaning |
|---|---|
| `"text"` | A plain text response from the model |
| `"tool-pieChart"` / `"tool-flightCard"` etc. | A tool invocation with its input arguments and state |

---

#### 6. Frontend renders each part

`App.tsx` maps over `message.parts` and switches on the type:

```tsx
// Text → rendered as Markdown
if (part.type === "text") {
  return <ReactMarkdown>{part.text}</ReactMarkdown>;
}

// Tool call → render the matching component
if (toolName === "pieChart")    return <PieChart   {...toolPart.input} />;
if (toolName === "flightCard")  return <FlightCard {...toolPart.input} />;
if (toolName === "showMyName")  return <NameGreeting {...toolPart.input} />;
```

While a tool is still running (`state !== "output-available"`), a bouncing dots loader is shown in its place. Once the tool result arrives, the component swaps in.

The `query_data` tool (which just fetches raw data) renders as a **collapsible JSON block** — collapsed by default so it doesn't clutter the chat.

---

#### 7. The UI component renders with the model's data

The model's tool call arguments become the React component's props directly. For example, when the model calls `pieChart`:

```json
{
  "title": "Revenue by Category",
  "description": "Breakdown from db.csv",
  "data": [
    { "label": "Electronics", "value": 4200 },
    { "label": "Clothing",    "value": 2100 }
  ]
}
```

The `<PieChart>` component receives this object as props and renders an interactive Recharts pie chart — no extra mapping or transformation needed.

---

## Adding a new UI component

1. **Define the tool in `backend/server.py`** with `@ai.tool`, specifying its arguments and docstring (the docstring is what the model reads).
2. **Add it to `TOOLS`** and mention it in `SYSTEM_PROMPT`.
3. **Create the React component** in `frontend/src/components/`.
4. **Import and add a render case** in `App.tsx` matching on `toolName`.

---

## Project structure

```
generative-ui-showcase/
├── backend/
│   └── server.py              # FastAPI app, tools, agent, system prompt
├── frontend/
│   ├── src/
│   │   ├── main.tsx            # React root, ErrorBoundary
│   │   ├── App.tsx             # Chat UI, message rendering, tool dispatch
│   │   ├── globals.css         # Tailwind, typography plugin, scrollbar
│   │   ├── error-boundary.tsx  # React error boundary
│   │   └── components/
│   │       ├── pie-chart.tsx       # Recharts pie chart component
│   │       ├── flight-card.tsx     # Flight summary card component
│   │       ├── name-greeting.tsx   # Name greeting card component
│   │       └── config.ts           # Shared chart colours and styles
│   ├── vite.config.ts          # Dev server + /api/agent proxy
│   └── package.json
├── db.csv                      # Dataset queried by the agent
├── helper.py                   # Server startup utility
├── requirements.txt            # Python dependencies
└── .env                        # API keys (not committed)
```