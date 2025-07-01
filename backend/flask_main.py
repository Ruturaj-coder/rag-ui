"""
Flask Backend for Barclays RAG Chatbot
Enterprise-friendly alternative to FastAPI using Flask
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import asyncio
import time
from datetime import datetime
from dotenv import load_dotenv
import logging

# Import our Azure services
import sys
sys.path.append('.')
from services.azure_services import RAGService, AzureServiceError

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)

# Configure CORS for React dev servers
CORS(app, origins=["http://localhost:3000", "http://localhost:5173"])

# Initialize Azure services
rag_service = None

def init_azure_services():
    """Initialize Azure services on startup"""
    global rag_service
    try:
        logger.info("🚀 Initializing Azure services...")
        rag_service = RAGService()
        logger.info("✅ Azure services initialized successfully")
        return True
    except Exception as e:
        logger.error(f"❌ Failed to initialize Azure services: {str(e)}")
        return False

@app.route("/", methods=["GET"])
def root():
    """Root endpoint"""
    return jsonify({
        "message": "Barclays RAG API is running",
        "version": "1.0.0",
        "docs": "Flask-based API",
        "endpoints": ["/health", "/api/rag", "/api/search", "/api/facets", "/api/config"]
    })

@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint"""
    try:
        if not rag_service:
            return jsonify({
                "status": "unhealthy",
                "timestamp": datetime.utcnow().isoformat(),
                "services": {"search": False, "openai": False},
                "errors": ["RAG service not initialized"]
            }), 503
        
        # Test Azure services connection
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        health_status = loop.run_until_complete(rag_service.test_connection())
        loop.close()
        
        return jsonify({
            "status": "healthy" if health_status["search"] and health_status["openai"] else "unhealthy",
            "timestamp": datetime.utcnow().isoformat(),
            "services": {
                "search": health_status["search"],
                "openai": health_status["openai"]
            },
            "errors": health_status.get("errors", [])
        })
        
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return jsonify({
            "status": "unhealthy",
            "timestamp": datetime.utcnow().isoformat(),
            "services": {"search": False, "openai": False},
            "errors": [f"Health check failed: {str(e)}"]
        }), 500

@app.route("/api/search", methods=["POST"])
def search_documents():
    """Search documents using Azure Search"""
    try:
        if not rag_service:
            return jsonify({"detail": "RAG service not initialized"}), 503
        
        data = request.get_json()
        if not data:
            return jsonify({"detail": "No JSON data provided"}), 400
            
        query = data.get("query", "")
        filters = data.get("filters", {})
        top = data.get("top", 10)
        include_facets = data.get("include_facets", False)
        
        logger.info(f"🔍 Search request: query='{query}', filters={filters}")
        
        # Run async function in event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        result = loop.run_until_complete(rag_service.search_documents(
            query=query,
            filters=filters,
            top=top,
            include_facets=include_facets
        ))
        loop.close()
        
        logger.info(f"✅ Search completed: {len(result['documents'])} documents found")
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"❌ Search failed: {str(e)}")
        return jsonify({"detail": f"Search failed: {str(e)}"}), 500

@app.route("/api/rag", methods=["POST"])
def process_rag_query():
    """Process RAG query with document retrieval and AI response generation"""
    try:
        if not rag_service:
            return jsonify({"detail": "RAG service not initialized"}), 503
        
        data = request.get_json()
        if not data:
            return jsonify({"detail": "No JSON data provided"}), 400
            
        query = data.get("query", "")
        filters = data.get("filters", {})
        temperature = data.get("temperature", 0.7)
        max_tokens = data.get("max_tokens", 2000)
        top_documents = data.get("top_documents", 10)
        
        if not query.strip():
            return jsonify({"detail": "Query cannot be empty"}), 400
        
        logger.info(f"🤖 RAG request: query='{query}', filters={filters}")
        
        # Run async function in event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        result = loop.run_until_complete(rag_service.process_query(
            query=query,
            filters=filters,
            temperature=temperature,
            max_tokens=max_tokens,
            top_documents=top_documents
        ))
        loop.close()
        
        logger.info(f"✅ RAG completed: {len(result['sources'])} sources, {result['tokens']} tokens")
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"❌ RAG processing failed: {str(e)}")
        return jsonify({"detail": f"RAG processing failed: {str(e)}"}), 500

@app.route("/api/facets", methods=["GET"])
def get_available_facets():
    """Get available facets for filtering"""
    try:
        if not rag_service:
            return jsonify({"detail": "RAG service not initialized"}), 503
        
        logger.info("📊 Loading available facets...")
        
        # Run async function in event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        facets = loop.run_until_complete(rag_service.get_available_facets())
        loop.close()
        
        logger.info(f"✅ Facets loaded: {len(facets.get('authors', []))} authors, {len(facets.get('categories', []))} categories")
        
        return jsonify(facets)
        
    except Exception as e:
        logger.error(f"❌ Failed to load facets: {str(e)}")
        return jsonify({"detail": f"Failed to load facets: {str(e)}"}), 500

@app.route("/api/config", methods=["GET"])
def get_config():
    """Get configuration status (for debugging)"""
    try:
        config_status = {
            "openai_endpoint": bool(os.getenv("AZURE_OPENAI_ENDPOINT")),
            "openai_key": bool(os.getenv("AZURE_OPENAI_API_KEY")),
            "search_endpoint": bool(os.getenv("AZURE_SEARCH_ENDPOINT")),
            "search_key": bool(os.getenv("AZURE_SEARCH_API_KEY")),
            "index_name": os.getenv("AZURE_SEARCH_INDEX_NAME", "documents"),
            "deployment_name": os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-4")
        }
        
        return jsonify({"configuration": config_status})
        
    except Exception as e:
        logger.error(f"❌ Failed to get config: {str(e)}")
        return jsonify({"detail": f"Failed to get config: {str(e)}"}), 500

# Handle CORS preflight requests
@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        response = jsonify({})
        response.headers.add("Access-Control-Allow-Origin", "*")
        response.headers.add('Access-Control-Allow-Headers', "*")
        response.headers.add('Access-Control-Allow-Methods', "*")
        return response

# Initialize Azure services on startup
def create_app():
    """Application factory"""
    with app.app_context():
        init_azure_services()
    return app

if __name__ == "__main__":
    print("🚀 Starting Barclays RAG Flask API...")
    print("📚 Available endpoints:")
    print("   • http://localhost:8000/")
    print("   • http://localhost:8000/health")
    print("   • http://localhost:8000/api/search")
    print("   • http://localhost:8000/api/rag")
    print("   • http://localhost:8000/api/facets")
    print("   • http://localhost:8000/api/config")
    print("\n🔧 Make sure you have created the .env file with your Azure credentials!")
    
    # Initialize services
    init_azure_services()
    
    # Run Flask development server
    app.run(host="0.0.0.0", port=8000, debug=True) 