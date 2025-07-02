from flask import Flask, request, jsonify
from flask_cors import CORS
from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizableTextQuery
from openai import AzureOpenAI
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)  # Enable CORS for React

# ENV VARIABLES (Updated to match your teammate's naming)
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY")
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT") 
AZURE_DEPLOYMENT_NAME = os.getenv("AZURE_DEPLOYMENT_NAME")
AZURE_SEARCH_API_KEY = os.getenv("AZURE_SEARCH_API_KEY")
AZURE_SEARCH_ENDPOINT = os.getenv("AZURE_SEARCH_ENDPOINT")
AZURE_SEARCH_INDEX = os.getenv("AZURE_SEARCH_INDEX", "my-demo-index")  # Default to teammate's index

# Validate required environment variables
required_env_vars = [
    "AZURE_OPENAI_API_KEY",
    "AZURE_OPENAI_ENDPOINT", 
    "AZURE_DEPLOYMENT_NAME",
    "AZURE_SEARCH_API_KEY",
    "AZURE_SEARCH_ENDPOINT"
]

missing_vars = [var for var in required_env_vars if not os.getenv(var)]
if missing_vars:
    print(f"❌ Missing required environment variables: {', '.join(missing_vars)}")
    print("📝 Please create a .env file in the backend directory with these variables")
    
# Initialize Azure clients with error handling (using teammate's approach)
openai_client = None
search_client = None

try:
    if not missing_vars:
        openai_client = AzureOpenAI(
            azure_endpoint=AZURE_OPENAI_ENDPOINT,
            api_key=AZURE_OPENAI_API_KEY,
            api_version="2024-02-01"  # Use teammate's working API version
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
            
        filters = data.get("filters", {})

        print(f"🔍 Processing query: {query}")
        if filters:
            print(f"📊 Applied filters: {filters}")

        # Build filter string (using teammate's approach)
        filter_conditions = []
        for key, value in filters.items():
            if value and str(value).strip():
                filter_conditions.append(f"{key} eq '{value}'")
        filter_string = ' and '.join(filter_conditions) if filter_conditions else None

        # Perform hybrid search (teammate's approach)
        try:
            vector_query = VectorizableTextQuery(text=query, k_nearest_neighbors=5, fields="vector")
            search_args = {
                "search_text": query,
                "vector_queries": [vector_query],
                "select": [
                    "title", "chunk", "parent_id", "document_id", "document_title",
                    "chunk_id", "author", "language", "topic", "summary", "keywords",
                    "element", "entities", "user_group", "extension", "data_product_id",
                    "data_product_name", "data_product_type", "data_product_description",
                    "owner_business", "storage_location", "version", "creation_date", "update_date"
                ],
                "top": 5
            }
            if filter_string:
                search_args["filter"] = filter_string

            results = search_client.search(**search_args)
        except Exception as search_error:
            print(f"⚠️ Vector search failed, falling back to basic search: {search_error}")
            # Fallback to basic search if vector search fails
            search_args = {
                "search_text": query,
                "top": 5
            }
            if filter_string:
                search_args["filter"] = filter_string
            results = search_client.search(**search_args)

        # Prepare context and sources (teammate's approach)
        retrieved_context = ""
        sources = []
        result_count = 0

        for result in results:
            # Use 'chunk' field instead of 'content' (this was the main issue!)
            chunk = result.get('chunk', result.get('content', ''))
            retrieved_context += chunk + "\n"
            sources.append({
                'title': result.get('title', 'N/A'),
                'author': result.get('author', 'N/A'),
                'document_title': result.get('document_title', 'N/A'),
                'topic': result.get('topic', 'N/A'),
                'data_product_type': result.get('data_product_type', 'N/A'),
            })
            result_count += 1

        if not retrieved_context.strip():
            print("⚠️ No relevant documents found")
            return jsonify({
                "answer": "I couldn't find any relevant information in the documents with the applied filters. Please try adjusting your query or filters.",
                "sources": [],
                "result_count": 0
            })

        # Generate response (teammate's approach)
        system_prompt = (
            "You are a helpful AI assistant. Answer the user's question based ONLY on the context "
            "provided below. If the answer is not in the context, say 'I don't have enough information "
            "in the provided documents to answer that.' Do not make up information. Provide clear, concise answers."
        )
        augmented_prompt = f"CONTEXT FROM DOCUMENTS:\n{retrieved_context}\n\nQUESTION:\n{query}"

        response = openai_client.chat.completions.create(
            model=AZURE_DEPLOYMENT_NAME,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": augmented_prompt}
            ],
            temperature=0.2
        )

        answer = response.choices[0].message.content
        print(f"✅ Generated response for query: {query}")
        
        return jsonify({
            "answer": answer,
            "sources": sources,
            "result_count": result_count,
            "filters_applied": filter_string
        })
        
    except Exception as e:
        print(f"❌ Error in chat endpoint: {str(e)}")
        return jsonify({
            "error": f"Failed to process chat request: {str(e)}"
        }), 500

@app.route("/filters", methods=["GET"])
def get_filter_options():
    """Get available filter options from the search index (teammate's approach)"""
    try:
        # Check if Azure search client is available
        if not search_client:
            print("❌ Search client not available for filters endpoint")
            return jsonify({
                "authors": ["Sample Author 1", "Sample Author 2"],
                "file_types": ["pdf", "docx", "txt"],
                "note": "Mock data - Azure Search not configured"
            })

        print("🔍 Fetching filter options from Azure Search...")
        
        # Use teammate's field names
        filter_options = {
            'author': [],
            'language': [],
            'topic': [],
            'data_product_type': [],
            'owner_business': [],
            'user_group': [],
            'extension': []
        }

        try:
            for field in filter_options.keys():
                search_results = search_client.search(
                    search_text="*",
                    facets=[field],
                    top=0
                )
                if hasattr(search_results, 'get_facets') and search_results.get_facets():
                    facets = search_results.get_facets().get(field, [])
                    filter_options[field] = [facet['value'] for facet in facets if facet['count'] > 0]

            print(f"✅ Found filter options: {len(filter_options)} categories")
            
            # Convert to your frontend's expected format
            return jsonify({
                "authors": filter_options.get('author', []),
                "file_types": filter_options.get('data_product_type', []) + filter_options.get('extension', []),
                "languages": filter_options.get('language', []),
                "topics": filter_options.get('topic', []),
                "business_units": filter_options.get('owner_business', []),
                "user_groups": filter_options.get('user_group', [])
            })
            
        except Exception as facet_error:
            print(f"⚠️ Faceted search failed, using basic search: {facet_error}")
            # Fallback to basic search if facets fail
            authors = set()
            topics = set()
            
            results = search_client.search("*", top=100)
            for doc in results:
                if doc.get("author"):
                    authors.add(doc.get("author"))
                if doc.get("topic"):
                    topics.add(doc.get("topic"))
            
            return jsonify({
                "authors": sorted(list(authors)),
                "file_types": ["pdf", "docx", "txt"],
                "topics": sorted(list(topics))
            })
        
    except Exception as e:
        print(f"❌ Error in filters endpoint: {str(e)}")
        return jsonify({
            "authors": ["Sample Author"],
            "file_types": ["pdf", "docx"],
            "error": f"Failed to fetch from Azure Search: {str(e)}",
            "note": "Returning mock data due to error"
        })

if __name__ == "__main__":
    app.run(debug=True, host='127.0.0.1', port=5000)
