from flask import Flask, request, jsonify
from flask_cors import CORS
from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
from openai import AzureOpenAI
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)  # Enable CORS for React

# ENV VARIABLES
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY")
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT")
AZURE_DEPLOYMENT_NAME = os.getenv("AZURE_DEPLOYMENT_NAME")
AZURE_SEARCH_API_KEY = os.getenv("AZURE_SEARCH_API_KEY")
AZURE_SEARCH_ENDPOINT = os.getenv("AZURE_SEARCH_ENDPOINT")
AZURE_SEARCH_INDEX = os.getenv("AZURE_SEARCH_INDEX")

# Validate required environment variables
required_env_vars = [
    "AZURE_OPENAI_API_KEY",
    "AZURE_OPENAI_ENDPOINT", 
    "AZURE_DEPLOYMENT_NAME",
    "AZURE_SEARCH_API_KEY",
    "AZURE_SEARCH_ENDPOINT",
    "AZURE_SEARCH_INDEX"
]

missing_vars = [var for var in required_env_vars if not os.getenv(var)]
if missing_vars:
    print(f"❌ Missing required environment variables: {', '.join(missing_vars)}")
    print("📝 Please create a .env file in the backend directory with these variables")
    
# Initialize Azure clients with error handling
openai_client = None
search_client = None

try:
    if not missing_vars:
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
        print("✅ Azure clients initialized successfully")
    else:
        print("⚠️ Azure clients not initialized due to missing environment variables")
except Exception as e:
    print(f"❌ Failed to initialize Azure clients: {str(e)}")
    openai_client = None
    search_client = None

@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint to verify service status"""
    status = {
        "status": "healthy",
        "services": {
            "openai": openai_client is not None,
            "search": search_client is not None
        },
        "missing_env_vars": missing_vars if missing_vars else []
    }
    
    if missing_vars or not openai_client or not search_client:
        status["status"] = "unhealthy"
        return jsonify(status), 503
    
    return jsonify(status)

@app.route("/chat", methods=["POST"])
def chat():
    try:
        # Check if Azure clients are available
        if not openai_client or not search_client:
            return jsonify({
                "error": "Azure services not available. Please check environment variables.",
                "missing_vars": missing_vars
            }), 503

        data = request.json
        if not data:
            return jsonify({"error": "No JSON data provided"}), 400
            
        query = data.get("query")
        if not query:
            return jsonify({"error": "Query parameter is required"}), 400
            
        filters = data.get("filters", {})  # Example: { "author": "John", "file_type": "pdf" }

        filter_string = " and ".join(
            [f"{k} eq '{v}'" for k, v in filters.items()]
        ) if filters else None

        print(f"🔍 Processing query: {query}")
        if filters:
            print(f"📊 Applied filters: {filters}")

        # Search top 3 docs from Azure Cognitive Search
        results = search_client.search(query, filter=filter_string, top=3)

        retrieved_docs = []
        for result in results:
            retrieved_docs.append(result.get("content", ""))  # assumes field `content` in index

        # Combine context
        context = "\n\n".join(retrieved_docs)
        
        if not context.strip():
            print("⚠️ No relevant documents found")
            context = "No relevant documents found for this query."

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
        print(f"✅ Generated response for query: {query}")
        return jsonify({"answer": answer})
        
    except Exception as e:
        print(f"❌ Error in chat endpoint: {str(e)}")
        return jsonify({
            "error": f"Failed to process chat request: {str(e)}"
        }), 500

@app.route("/filters", methods=["GET"])
def get_filter_options():
    try:
        # Check if Azure search client is available
        if not search_client:
            print("❌ Search client not available for filters endpoint")
            # Return mock data when Azure is not available
            return jsonify({
                "authors": ["Sample Author 1", "Sample Author 2"],
                "file_types": ["pdf", "docx", "txt"],
                "note": "Mock data - Azure Search not configured"
            })

        print("🔍 Fetching filter options from Azure Search...")
        authors = set()
        file_types = set()

        # Search for all documents to get filter options
        results = search_client.search("*", top=1000)
        doc_count = 0
        
        for doc in results:
            authors.add(doc.get("author", "Unknown"))
            file_types.add(doc.get("file_type", "Unknown"))
            doc_count += 1

        print(f"✅ Found {doc_count} documents, {len(authors)} authors, {len(file_types)} file types")
        
        return jsonify({
            "authors": sorted(list(authors)),
            "file_types": sorted(list(file_types)),
        })
        
    except Exception as e:
        print(f"❌ Error in filters endpoint: {str(e)}")
        # Return mock data when there's an error
        return jsonify({
            "authors": ["Sample Author"],
            "file_types": ["pdf", "docx"],
            "error": f"Failed to fetch from Azure Search: {str(e)}",
            "note": "Returning mock data due to error"
        })

if __name__ == "__main__":
    app.run(debug=True)
