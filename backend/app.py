from flask import Flask, request, jsonify
from flask_cors import CORS
from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
from openai import AzureOpenAI
from azure.core.pipeline.transport import RequestsTransport
from azure.core.pipeline.policies import RetryPolicy
import os
import requests
import urllib3
from dotenv import load_dotenv

# Disable SSL warnings for corporate networks
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

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

# Corporate network configuration
HTTP_PROXY = os.getenv("HTTP_PROXY")
HTTPS_PROXY = os.getenv("HTTPS_PROXY")

# Configure proxies for requests
proxies = {}
if HTTP_PROXY:
    proxies['http'] = HTTP_PROXY
if HTTPS_PROXY:
    proxies['https'] = HTTPS_PROXY

if proxies:
    print(f"🌐 Using proxy configuration: {proxies}")

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

# Corporate-friendly transport configuration
def create_corporate_transport():
    """Create a requests transport configured for corporate networks"""
    session = requests.Session()
    
    # Configure proxy
    if proxies:
        session.proxies.update(proxies)
    
    # Corporate network friendly settings
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Connection': 'keep-alive'
    })
    
    # Increase timeouts for corporate networks
    return RequestsTransport(
        session=session,
        connection_timeout=60,  # Increased from default 10
        read_timeout=120        # Increased from default 30
    )

# Initialize Azure clients with corporate network configuration
openai_client = None
search_client = None

try:
    if not missing_vars:
        print("🔧 Initializing Azure clients with corporate network settings...")
        
        # Create corporate-friendly transport
        transport = create_corporate_transport()
        
        # Initialize OpenAI client with proxy support
        openai_kwargs = {
            "api_key": AZURE_OPENAI_API_KEY,
            "api_version": "2024-02-15-preview",
            "azure_endpoint": AZURE_OPENAI_ENDPOINT,
            "timeout": 120  # Increased timeout
        }
        
        # Add proxy support for OpenAI client
        if proxies:
            openai_kwargs["http_client"] = requests.Session()
            openai_kwargs["http_client"].proxies.update(proxies)
        
        openai_client = AzureOpenAI(**openai_kwargs)
        
        # Initialize Search client with corporate transport
        search_client = SearchClient(
            endpoint=AZURE_SEARCH_ENDPOINT,
            index_name=AZURE_SEARCH_INDEX,
            credential=AzureKeyCredential(AZURE_SEARCH_API_KEY),
            transport=transport
        )
        
        print("✅ Azure clients initialized with corporate network configuration")
        
        # Test the search client
        print("🧪 Testing search client connectivity...")
        try:
            # Simple test query with timeout
            test_results = search_client.search("*", top=1)
            test_count = sum(1 for _ in test_results)
            print(f"✅ Search client test successful - found {test_count} documents")
        except Exception as test_error:
            print(f"⚠️ Search client test failed: {str(test_error)}")
            
    else:
        print("⚠️ Azure clients not initialized due to missing environment variables")
        
except Exception as e:
    print(f"❌ Failed to initialize Azure clients: {str(e)}")
    print(f"🔍 Error type: {type(e).__name__}")
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
        "network": {
            "proxy_configured": len(proxies) > 0,
            "proxy_settings": proxies if proxies else None
        },
        "missing_env_vars": missing_vars if missing_vars else []
    }
    
    # Test search client if available
    if search_client:
        try:
            # Quick connectivity test
            test_results = search_client.search("*", top=1)
            list(test_results)  # Force execution
            status["services"]["search_test"] = "success"
        except Exception as e:
            status["services"]["search_test"] = f"failed: {str(e)}"
            status["status"] = "degraded"
    
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

        filter_string = " and ".join(
            [f"{k} eq '{v}'" for k, v in filters.items()]
        ) if filters else None

        print(f"🔍 Processing query: {query}")
        if filters:
            print(f"📊 Applied filters: {filters}")

        # Search with corporate network friendly settings
        print("🔍 Searching Azure Cognitive Search...")
        try:
            results = search_client.search(
                query, 
                filter=filter_string, 
                top=3,
                timeout=60  # Add explicit timeout
            )
            
            retrieved_docs = []
            doc_count = 0
            for result in results:
                retrieved_docs.append(result.get("content", ""))
                doc_count += 1
                
            print(f"✅ Retrieved {doc_count} documents from search")
            
        except Exception as search_error:
            print(f"❌ Search failed: {str(search_error)}")
            return jsonify({
                "error": f"Search failed: {str(search_error)}",
                "suggestion": "Check network connectivity and Azure Search configuration"
            }), 500

        # Combine context
        context = "\n\n".join(retrieved_docs)
        
        if not context.strip():
            print("⚠️ No relevant documents found")
            context = "No relevant documents found for this query."

        # Generate answer using Azure OpenAI
        print("🤖 Generating response with Azure OpenAI...")
        try:
            response = openai_client.chat.completions.create(
                messages=[
                    {"role": "system", "content": "You're a helpful assistant using provided documents."},
                    {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {query}"}
                ],
                model=AZURE_DEPLOYMENT_NAME,
                temperature=0.2,
                timeout=120  # Increased timeout for corporate networks
            )

            answer = response.choices[0].message.content
            print(f"✅ Generated response for query: {query}")
            return jsonify({"answer": answer})
            
        except Exception as openai_error:
            print(f"❌ OpenAI generation failed: {str(openai_error)}")
            return jsonify({
                "error": f"AI response generation failed: {str(openai_error)}"
            }), 500
        
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
            return jsonify({
                "authors": ["Sample Author 1", "Sample Author 2"],
                "file_types": ["pdf", "docx", "txt"],
                "note": "Mock data - Azure Search not configured"
            })

        print("🔍 Fetching filter options from Azure Search...")
        authors = set()
        file_types = set()

        # Search with increased timeout and error handling
        try:
            results = search_client.search(
                "*", 
                top=1000,
                timeout=60  # Explicit timeout for corporate networks
            )
            
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
            
        except Exception as search_error:
            print(f"❌ Search operation failed: {str(search_error)}")
            raise search_error
        
    except Exception as e:
        print(f"❌ Error in filters endpoint: {str(e)}")
        print(f"🔍 Error type: {type(e).__name__}")
        
        # Return mock data when there's an error
        return jsonify({
            "authors": ["Sample Author"],
            "file_types": ["pdf", "docx"],
            "error": f"Failed to fetch from Azure Search: {str(e)}",
            "note": "Returning mock data due to error"
        })

@app.route("/test-connectivity", methods=["GET"])
def test_connectivity():
    """Test endpoint to debug connectivity issues"""
    tests = {}
    
    # Test 1: Basic HTTP connectivity
    try:
        response = requests.get(f"{AZURE_SEARCH_ENDPOINT}/", timeout=30, proxies=proxies)
        tests["basic_http"] = f"Success - Status: {response.status_code}"
    except Exception as e:
        tests["basic_http"] = f"Failed: {str(e)}"
    
    # Test 2: Search service info
    if search_client:
        try:
            # Try to get service statistics
            stats = search_client.get_service_statistics()
            tests["search_service"] = "Success - Service accessible"
        except Exception as e:
            tests["search_service"] = f"Failed: {str(e)}"
    
    return jsonify(tests)

if __name__ == "__main__":
    print("🚀 Starting Flask server with corporate network support...")
    app.run(debug=True, host='127.0.0.1', port=5000)
