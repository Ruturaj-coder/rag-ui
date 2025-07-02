from flask import Flask, request, jsonify
from flask_cors import CORS
from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
from openai import AzureOpenAI
import os

app = Flask(__name__)
CORS(app)  # Enable CORS for React

# ENV VARIABLES
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY")
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT")
AZURE_DEPLOYMENT_NAME = os.getenv("AZURE_DEPLOYMENT_NAME")
AZURE_SEARCH_API_KEY = os.getenv("AZURE_SEARCH_API_KEY")
AZURE_SEARCH_ENDPOINT = os.getenv("AZURE_SEARCH_ENDPOINT")
AZURE_SEARCH_INDEX = os.getenv("AZURE_SEARCH_INDEX_NAME")

# Azure clients
openai_client = AzureOpenAI(
    api_key=AZURE_OPENAI_API_KEY,
    api_version="2024-02-15-preview",
    azure_endpoint=AZURE_OPENAI_ENDPOINT,
)

search_client = SearchClient(
    endpoint=AZURE_SEARCH_ENDPOINT,
    index_name=AZURE_SEARCH_INDEX,
    credential=AzureKeyCredential(AZURE_SEARCH_API_KEY)
)

@app.route("/chat", methods=["POST"])
def chat():
    data = request.json
    query = data.get("query")
    filters = data.get("filters", {})  # Example: { "author": "John", "file_type": "pdf" }

    filter_string = " and ".join(
        [f"{k} eq '{v}'" for k, v in filters.items()]
    ) if filters else None

    # Search top 3 docs from Azure Cognitive Search
    results = search_client.search(query, filter=filter_string, top=3)

    retrieved_docs = []
    for result in results:
        retrieved_docs.append(result["content"])  # assumes field `content` in index

    # Combine context
    context = "\n\n".join(retrieved_docs)

    # Generate answer using Azure OpenAI
    response = openai_client.chat.completions.create(
        messages=[
            {"role": "system", "content": "You're a helpful assistant using provided documents."},
            {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {query}"}
        ],
        model=AZURE_DEPLOYMENT_NAME,
        temperature=0.2,
    )

    answer = response.choices[0].message.content
    return jsonify({"answer": answer})

@app.route("/filters", methods=["GET"])
def get_filter_options():
    authors = set()
    file_types = set()

    results = search_client.search("*", top=1000)
    for doc in results:
        authors.add(doc.get("author", "Unknown"))
        file_types.add(doc.get("file_type", "Unknown"))

    return jsonify({
        "authors": sorted(list(authors)),
        "file_types": sorted(list(file_types)),
    })

if __name__ == "__main__":
    app.run(debug=True)
