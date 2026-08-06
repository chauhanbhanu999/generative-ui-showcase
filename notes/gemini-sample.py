import os
from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage

# Load GOOGLE_API_KEY from .env
load_dotenv()

# gemini-3.6-flash: latest stable model (per https://ai.google.dev/gemini-api/docs/models)
# Other options:
#   "gemini-3.5-flash"       — stable, highly capable
#   "gemini-3.1-pro-preview" — preview, strongest reasoning
llm = ChatGoogleGenerativeAI(
    model="gemini-3.6-flash",
    google_api_key=os.environ.get("GOOGLE_API_KEY")
)

# Bind Google Search grounding so the model fetches live data
# instead of relying on its training cutoff — needed for "as of 2026" questions.
llm_with_search = llm.bind(tools=[{"google_search": {}}])

response = llm_with_search.invoke([
    HumanMessage(content="Who is the mayor of NYC as of 2026?")
])

print(response.content)

