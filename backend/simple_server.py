"""
Simple Python HTTP Server for Barclays RAG Chatbot
Uses only built-in Python libraries for maximum corporate environment compatibility
"""

import json
import os
import asyncio
import time
import sys
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import logging

# Add services to path
sys.path.append('.')
from services.azure_services import RAGService, AzureServiceError

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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

class RequestHandler(BaseHTTPRequestHandler):
    """HTTP request handler for the RAG API"""
    
    def do_OPTIONS(self):
        """Handle CORS preflight requests"""
        self._set_cors_headers()
        self.end_headers()
    
    def do_GET(self):
        """Handle GET requests"""
        try:
            parsed_url = urlparse(self.path)
            path = parsed_url.path
            
            if path == "/":
                self._handle_root()
            elif path == "/health":
                self._handle_health()
            elif path == "/api/facets":
                self._handle_get_facets()
            elif path == "/api/config":
                self._handle_config()
            else:
                self._send_404()
                
        except Exception as e:
            logger.error(f"❌ GET request failed: {str(e)}")
            self._send_error(500, f"Server error: {str(e)}")
    
    def do_POST(self):
        """Handle POST requests"""
        try:
            parsed_url = urlparse(self.path)
            path = parsed_url.path
            
            if path == "/api/search":
                self._handle_search()
            elif path == "/api/rag":
                self._handle_rag()
            else:
                self._send_404()
                
        except Exception as e:
            logger.error(f"❌ POST request failed: {str(e)}")
            self._send_error(500, f"Server error: {str(e)}")
    
    def _set_cors_headers(self):
        """Set CORS headers"""
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    
    def _send_json_response(self, data, status=200):
        """Send JSON response"""
        response_json = json.dumps(data, indent=2)
        
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self._set_cors_headers()
        self.end_headers()
        self.wfile.write(response_json.encode('utf-8'))
    
    def _send_error(self, status, message):
        """Send error response"""
        self._send_json_response({"detail": message}, status)
    
    def _send_404(self):
        """Send 404 response"""
        self._send_error(404, "Endpoint not found")
    
    def _get_request_data(self):
        """Get JSON data from request body"""
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0:
            return {}
        
        post_data = self.rfile.read(content_length)
        return json.loads(post_data.decode('utf-8'))
    
    def _handle_root(self):
        """Handle root endpoint"""
        self._send_json_response({
            "message": "Barclays RAG API is running",
            "version": "1.0.0",
            "docs": "Simple Python HTTP Server",
            "endpoints": ["/health", "/api/rag", "/api/search", "/api/facets", "/api/config"]
        })
    
    def _handle_health(self):
        """Handle health check endpoint"""
        try:
            if not rag_service:
                self._send_json_response({
                    "status": "unhealthy",
                    "timestamp": datetime.utcnow().isoformat(),
                    "services": {"search": False, "openai": False},
                    "errors": ["RAG service not initialized"]
                }, 503)
                return
            
            # Test Azure services connection
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            health_status = loop.run_until_complete(rag_service.test_connection())
            loop.close()
            
            self._send_json_response({
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
            self._send_json_response({
                "status": "unhealthy",
                "timestamp": datetime.utcnow().isoformat(),
                "services": {"search": False, "openai": False},
                "errors": [f"Health check failed: {str(e)}"]
            }, 500)
    
    def _handle_search(self):
        """Handle search endpoint"""
        try:
            if not rag_service:
                self._send_error(503, "RAG service not initialized")
                return
            
            data = self._get_request_data()
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
            self._send_json_response(result)
            
        except Exception as e:
            logger.error(f"❌ Search failed: {str(e)}")
            self._send_error(500, f"Search failed: {str(e)}")
    
    def _handle_rag(self):
        """Handle RAG endpoint"""
        try:
            if not rag_service:
                self._send_error(503, "RAG service not initialized")
                return
            
            data = self._get_request_data()
            query = data.get("query", "")
            filters = data.get("filters", {})
            temperature = data.get("temperature", 0.7)
            max_tokens = data.get("max_tokens", 2000)
            top_documents = data.get("top_documents", 10)
            
            if not query.strip():
                self._send_error(400, "Query cannot be empty")
                return
            
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
            self._send_json_response(result)
            
        except Exception as e:
            logger.error(f"❌ RAG processing failed: {str(e)}")
            self._send_error(500, f"RAG processing failed: {str(e)}")
    
    def _handle_get_facets(self):
        """Handle get facets endpoint"""
        try:
            if not rag_service:
                self._send_error(503, "RAG service not initialized")
                return
            
            logger.info("📊 Loading available facets...")
            
            # Run async function in event loop
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            facets = loop.run_until_complete(rag_service.get_available_facets())
            loop.close()
            
            logger.info(f"✅ Facets loaded: {len(facets.get('authors', []))} authors, {len(facets.get('categories', []))} categories")
            self._send_json_response(facets)
            
        except Exception as e:
            logger.error(f"❌ Failed to load facets: {str(e)}")
            self._send_error(500, f"Failed to load facets: {str(e)}")
    
    def _handle_config(self):
        """Handle config endpoint"""
        try:
            config_status = {
                "openai_endpoint": bool(os.getenv("AZURE_OPENAI_ENDPOINT")),
                "openai_key": bool(os.getenv("AZURE_OPENAI_API_KEY")),
                "search_endpoint": bool(os.getenv("AZURE_SEARCH_ENDPOINT")),
                "search_key": bool(os.getenv("AZURE_SEARCH_API_KEY")),
                "index_name": os.getenv("AZURE_SEARCH_INDEX_NAME", "documents"),
                "deployment_name": os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-4")
            }
            
            self._send_json_response({"configuration": config_status})
            
        except Exception as e:
            logger.error(f"❌ Failed to get config: {str(e)}")
            self._send_error(500, f"Failed to get config: {str(e)}")

def run_server(port=8000):
    """Run the HTTP server"""
    server_address = ('', port)
    httpd = HTTPServer(server_address, RequestHandler)
    
    print(f"🚀 Starting Simple Python RAG API Server on port {port}...")
    print("📚 Available endpoints:")
    print(f"   • http://localhost:{port}/")
    print(f"   • http://localhost:{port}/health")
    print(f"   • http://localhost:{port}/api/search")
    print(f"   • http://localhost:{port}/api/rag")
    print(f"   • http://localhost:{port}/api/facets")
    print(f"   • http://localhost:{port}/api/config")
    print("\n🔧 Make sure you have created the .env file with your Azure credentials!")
    print(f"🌐 Server running at http://localhost:{port}")
    
    # Initialize services
    init_azure_services()
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Server shutting down...")
        httpd.shutdown()

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Simple RAG API Server')
    parser.add_argument('--port', type=int, default=8000, help='Port to run the server on')
    args = parser.parse_args()
    
    run_server(args.port) 