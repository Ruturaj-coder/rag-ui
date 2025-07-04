import azure.functions as func
import logging
import json
import os
from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
from openai import AzureOpenAI

# Create the main function app
app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

# ENV VARIABLES
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY")
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT") 
AZURE_DEPLOYMENT_NAME = os.getenv("AZURE_DEPLOYMENT_NAME")
AZURE_SEARCH_API_KEY = os.getenv("AZURE_SEARCH_API_KEY")
AZURE_SEARCH_ENDPOINT = os.getenv("AZURE_SEARCH_ENDPOINT")
AZURE_SEARCH_INDEX = os.getenv("AZURE_SEARCH_INDEX", "my-demo-index")

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
    logging.warning(f"Missing required environment variables: {', '.join(missing_vars)}")

# Initialize Azure clients
openai_client = None
search_client = None

try:
    if not missing_vars:
        openai_client = AzureOpenAI(
            azure_endpoint=AZURE_OPENAI_ENDPOINT,
            api_key=AZURE_OPENAI_API_KEY,
            api_version="2024-02-01"
        )
        
        search_client = SearchClient(
            endpoint=AZURE_SEARCH_ENDPOINT,
            index_name=AZURE_SEARCH_INDEX,
            credential=AzureKeyCredential(AZURE_SEARCH_API_KEY)
        )
        logging.info("Azure clients initialized successfully")
    else:
        logging.warning("Azure clients not initialized due to missing environment variables")
except Exception as e:
    logging.error(f"Failed to initialize Azure clients: {str(e)}")
    openai_client = None
    search_client = None

# FUNCTION 1: Health Check
@app.route(route="health", methods=["GET"])
def health_check(req: func.HttpRequest) -> func.HttpResponse:
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
        return func.HttpResponse(
            json.dumps(status),
            status_code=503,
            mimetype="application/json"
        )
    
    return func.HttpResponse(
        json.dumps(status),
        status_code=200,
        mimetype="application/json"
    )

# FUNCTION 2: Chat Endpoint
@app.route(route="chat", methods=["POST"])
def chat(req: func.HttpRequest) -> func.HttpResponse:
    """Chat endpoint with Azure OpenAI and Search"""
    
    try:
        # Check if Azure clients are available
        if not openai_client or not search_client:
            return func.HttpResponse(
                json.dumps({
                    "error": "Azure services not available. Please check environment variables.",
                    "missing_vars": missing_vars
                }),
                status_code=503,
                mimetype="application/json"
            )

        # Get request data
        try:
            req_body = req.get_json()
        except ValueError:
            return func.HttpResponse(
                json.dumps({"error": "No JSON data provided"}),
                status_code=400,
                mimetype="application/json"
            )
            
        query = req_body.get("query")
        if not query:
            return func.HttpResponse(
                json.dumps({"error": "Query parameter is required"}),
                status_code=400,
                mimetype="application/json"
            )
            
        filters = req_body.get("filters", {})

        logging.info(f"Processing query: {query}")
        if filters:
            logging.info(f"Applied filters: {filters}")

        # Map frontend filter names to Azure AI Search field names
        field_mapping = {
            'authors': 'author',
            'file_type': 'documentType',
            'file_types': 'data_product_type',
            'content_type': 'documentType',
            'extension': 'extension',
            'language': 'language',
            'topic': 'topic',
            'business_unit': 'owner_business_unit',
            'owner_business': 'owner_business',
            'user_group': 'user_group'
        }

        # Build filter string
        filter_conditions = []
        for key, value in filters.items():
            if value and str(value).strip():
                azure_field = field_mapping.get(key, key)
                filter_conditions.append(f"{azure_field} eq '{value}'")
        filter_string = ' and '.join(filter_conditions) if filter_conditions else None
        
        logging.info(f"Filter string: {filter_string}")

        # Search Azure AI Search
        try:
            search_args = {
                "search_text": query,
                "select": [
                    "parent_id", "title", "chunk_id", "chunk", "documentType", "author",
                    "Documentid", "document_title", "language", "topic", "summary", "keywords",
                    "element", "entities", "user_group", "extension", "data_product_id",
                    "data_product_name", "data_product_type", "data_product_description",
                    "owner_business_unit", "owner_business", "owner_technical", "owner_group",
                    "storage_location", "version", "creation_date", "update_date"
                ],
                "top": 5
            }
            if filter_string:
                search_args["filter"] = filter_string

            results = search_client.search(**search_args)
            logging.info("Search successful")
            
        except Exception as search_error:
            logging.error(f"Search failed: {str(search_error)}")
            # Try with minimal fields
            try:
                logging.info("Trying search with minimal fields...")
                minimal_search_args = {
                    "search_text": query,
                    "top": 5
                }
                if filter_string:
                    minimal_search_args["filter"] = filter_string
                
                results = search_client.search(**minimal_search_args)
                logging.info("Minimal field search successful")
                
            except Exception as minimal_error:
                logging.error(f"Minimal search also failed: {str(minimal_error)}")
                return func.HttpResponse(
                    json.dumps({
                        "error": f"Search failed: {str(minimal_error)}",
                        "original_error": str(search_error),
                        "filter_applied": filter_string
                    }),
                    status_code=500,
                    mimetype="application/json"
                )

        # Process results
        try:
            logging.info("Processing search results...")
            retrieved_context = ""
            sources = []
            result_count = 0

            for result in results:
                logging.info(f"Processing result: {list(dict(result).keys())}")
                
                # Use 'chunk' field for content, fallback to other possible field names
                chunk = result.get('chunk', result.get('content', result.get('text', '')))
                if not chunk:
                    # Try to get any text-like field if chunk is empty
                    chunk = result.get('summary', result.get('title', ''))
                
                retrieved_context += chunk + "\n"
                sources.append({
                    'title': result.get('title', result.get('document_title', 'N/A')),
                    'author': result.get('author', 'N/A'),
                    'document_title': result.get('document_title', result.get('title', 'N/A')),
                    'document_type': result.get('documentType', 'N/A'),
                    'language': result.get('language', 'N/A'),
                    'topic': result.get('topic', 'N/A'),
                    'data_product_type': result.get('data_product_type', 'N/A'),
                    'owner_business': result.get('owner_business', 'N/A'),
                    'user_group': result.get('user_group', 'N/A'),
                    'extension': result.get('extension', 'N/A'),
                    'document_id': result.get('Documentid', result.get('parent_id', 'N/A')),
                    'chunk_id': result.get('chunk_id', 'N/A'),
                    'creation_date': str(result.get('creation_date', 'N/A')),
                    'update_date': str(result.get('update_date', 'N/A'))
                })
                result_count += 1

            logging.info(f"Processed {result_count} results")
            logging.info(f"Retrieved context length: {len(retrieved_context)}")

            if not retrieved_context.strip():
                logging.warning("No relevant documents found")
                return func.HttpResponse(
                    json.dumps({
                        "answer": "I couldn't find any relevant information in the documents with the applied filters. Please try adjusting your query or filters.",
                        "sources": [],
                        "result_count": 0
                    }),
                    status_code=200,
                    mimetype="application/json"
                )

        except Exception as process_error:
            logging.error(f"Error processing results: {str(process_error)}")
            return func.HttpResponse(
                json.dumps({
                    "error": f"Error processing search results: {str(process_error)}"
                }),
                status_code=500,
                mimetype="application/json"
            )

        # Generate response with OpenAI
        try:
            logging.info("Generating OpenAI response...")
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
            logging.info(f"Generated response for query: {query}")
            
            return func.HttpResponse(
                json.dumps({
                    "answer": answer,
                    "sources": sources,
                    "result_count": result_count,
                    "filters_applied": filter_string
                }),
                status_code=200,
                mimetype="application/json"
            )
            
        except Exception as openai_error:
            logging.error(f"OpenAI error: {str(openai_error)}")
            return func.HttpResponse(
                json.dumps({
                    "error": f"Error generating response: {str(openai_error)}",
                    "sources": sources,
                    "result_count": result_count
                }),
                status_code=500,
                mimetype="application/json"
            )
        
    except Exception as e:
        logging.error(f"Unexpected error in chat endpoint: {str(e)}")
        import traceback
        logging.error(f"Traceback: {traceback.format_exc()}")
        return func.HttpResponse(
            json.dumps({
                "error": f"Failed to process chat request: {str(e)}"
            }),
            status_code=500,
            mimetype="application/json"
        )

# FUNCTION 3: Filters Endpoint
@app.route(route="filters", methods=["GET"])
def get_filter_options(req: func.HttpRequest) -> func.HttpResponse:
    """Get available filter options from the search index"""
    
    try:
        # Check if Azure search client is available
        if not search_client:
            logging.warning("Search client not available for filters endpoint")
            return func.HttpResponse(
                json.dumps({
                    "authors": ["Sample Author 1", "Sample Author 2"],
                    "file_types": ["pdf", "docx", "txt"],
                    "note": "Mock data - Azure Search not configured"
                }),
                status_code=200,
                mimetype="application/json"
            )

        logging.info("Fetching filter options from Azure Search...")
        
        # Use actual field names from the index
        filter_options = {
            'author': [],
            'documentType': [],
            'language': [],
            'topic': [],
            'data_product_type': [],
            'owner_business_unit': [],
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

            logging.info(f"Found filter options: {len(filter_options)} categories")
            
            # Convert to frontend's expected format
            return func.HttpResponse(
                json.dumps({
                    "authors": filter_options.get('author', []),
                    "file_types": filter_options.get('documentType', []) + filter_options.get('data_product_type', []),
                    "document_types": filter_options.get('documentType', []),
                    "languages": filter_options.get('language', []),
                    "topics": filter_options.get('topic', []),
                    "business_units": filter_options.get('owner_business_unit', []),
                    "owner_business": filter_options.get('owner_business', []),
                    "user_groups": filter_options.get('user_group', []),
                    "extensions": filter_options.get('extension', []),
                    "data_product_types": filter_options.get('data_product_type', [])
                }),
                status_code=200,
                mimetype="application/json"
            )
            
        except Exception as facet_error:
            logging.warning(f"Faceted search failed, using basic search: {facet_error}")
            # Fallback to basic search if facets fail
            authors = set()
            topics = set()
            languages = set()
            
            results = search_client.search("*", top=100)
            for doc in results:
                if doc.get("author"):
                    authors.add(doc.get("author"))
                if doc.get("topic"):
                    topics.add(doc.get("topic"))
                if doc.get("language"):
                    languages.add(doc.get("language"))
            
            return func.HttpResponse(
                json.dumps({
                    "authors": sorted(list(authors)),
                    "topics": sorted(list(topics)),
                    "languages": sorted(list(languages)),
                    "file_types": ["pdf", "docx", "txt"]
                }),
                status_code=200,
                mimetype="application/json"
            )
        
    except Exception as e:
        logging.error(f"Error in filters endpoint: {str(e)}")
        return func.HttpResponse(
            json.dumps({
                "authors": ["Sample Author"],
                "file_types": ["pdf", "docx"],
                "error": f"Failed to fetch from Azure Search: {str(e)}",
                "note": "Returning mock data due to error"
            }),
            status_code=200,
            mimetype="application/json"
        )

# FUNCTION 4: Debug Fields Endpoint
@app.route(route="debug/fields", methods=["GET"])
def debug_fields(req: func.HttpRequest) -> func.HttpResponse:
    """Debug endpoint to discover available fields in the search index"""
    
    try:
        if not search_client:
            return func.HttpResponse(
                json.dumps({"error": "Search client not available"}),
                status_code=503,
                mimetype="application/json"
            )
        
        # Get a sample document to see what fields are available
        results = search_client.search("*", top=1)
        
        sample_doc = None
        available_fields = []
        
        for result in results:
            sample_doc = dict(result)
            available_fields = list(sample_doc.keys())
            break
        
        if not sample_doc:
            return func.HttpResponse(
                json.dumps({
                    "message": "No documents found in index",
                    "available_fields": [],
                    "sample_document": None
                }),
                status_code=200,
                mimetype="application/json"
            )
        
        return func.HttpResponse(
            json.dumps({
                "message": "Available fields in your Azure AI Search index",
                "available_fields": sorted(available_fields),
                "sample_document": sample_doc,
                "field_count": len(available_fields)
            }),
            status_code=200,
            mimetype="application/json"
        )
        
    except Exception as e:
        return func.HttpResponse(
            json.dumps({
                "error": f"Failed to fetch field information: {str(e)}"
            }),
            status_code=500,
            mimetype="application/json"
        )
