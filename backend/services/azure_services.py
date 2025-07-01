"""
Azure Services Implementation for Barclays RAG Chatbot
Following the successful Python pattern: Load env → Initialize clients → Build filters → Hybrid search → Prepare context → Generate response → Get facets
"""

import os
import asyncio
import time
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv
import logging

from openai import AzureOpenAI
from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient

# Load environment variables
load_dotenv()

logger = logging.getLogger(__name__)

class AzureServiceError(Exception):
    """Custom exception for Azure service errors"""
    def __init__(self, message: str, service: str):
        super().__init__(message)
        self.service = service

class AzureSearchService:
    """Azure Search Service using official SDK"""
    
    def __init__(self):
        # Step 1: Load environment variables
        self.search_endpoint = os.getenv("AZURE_SEARCH_ENDPOINT")
        self.search_key = os.getenv("AZURE_SEARCH_API_KEY")
        self.index_name = os.getenv("AZURE_SEARCH_INDEX_NAME", "documents")
        
        if not self.search_endpoint or not self.search_key:
            raise AzureServiceError("Azure Search configuration is incomplete", "search")
        
        # Step 2: Initialize clients
        try:
            self.search_client = SearchClient(
                endpoint=self.search_endpoint,
                index_name=self.index_name,
                credential=AzureKeyCredential(self.search_key)
            )
            logger.info("✅ Azure Search client initialized")
        except Exception as e:
            raise AzureServiceError(f"Failed to initialize Search client: {str(e)}", "search")
    
    def build_filter_string(self, filters: Optional[Dict[str, Any]] = None) -> str:
        """Step 3: Build filter string"""
        if not filters:
            return ""
        
        filter_clauses = []
        
        # Authors filter
        if filters.get("authors"):
            author_filters = [f"metadata_author eq '{author.replace(chr(39), chr(39) + chr(39))}'" for author in filters["authors"]]
            if author_filters:
                filter_clauses.append(f"({' or '.join(author_filters)})")
        
        # Categories filter
        if filters.get("categories"):
            category_filters = [f"metadata_storage_content_type eq '{cat.replace(chr(39), chr(39) + chr(39))}'" for cat in filters["categories"]]
            if category_filters:
                filter_clauses.append(f"({' or '.join(category_filters)})")
        
        # Date range filter
        if filters.get("date_range"):
            date_range = filters["date_range"]
            if date_range.get("start"):
                filter_clauses.append(f"metadata_storage_last_modified ge {date_range['start']}T00:00:00Z")
            if date_range.get("end"):
                filter_clauses.append(f"metadata_storage_last_modified le {date_range['end']}T23:59:59Z")
        
        # Document IDs filter
        if filters.get("document_ids"):
            id_filters = [f"metadata_storage_path eq '{doc_id.replace(chr(39), chr(39) + chr(39))}'" for doc_id in filters["document_ids"]]
            if id_filters:
                filter_clauses.append(f"({' or '.join(id_filters)})")
        
        result = " and ".join(filter_clauses)
        if result:
            logger.info(f"🔧 Built filter string: {result}")
        return result
    
    async def search_documents(
        self, 
        query: str, 
        filters: Optional[Dict[str, Any]] = None,
        top: int = 10,
        include_facets: bool = False
    ) -> Dict[str, Any]:
        """Step 4: Perform hybrid search"""
        try:
            filter_string = self.build_filter_string(filters)
            
            # Prepare search parameters
            search_params = {
                "search_text": query or "*",
                "top": top,
                "include_total_count": True,
                "select": [
                    "metadata_storage_path",
                    "metadata_storage_name", 
                    "metadata_storage_content_type",
                    "metadata_author",
                    "content",
                    "merged_content",
                    "metadata_storage_last_modified",
                    "metadata_storage_size"
                ],
                "search_mode": "all"
            }
            
            # Add filter if present
            if filter_string:
                search_params["filter"] = filter_string
            
            # Add facets if requested (Step 7: Get facets for each filterable field)
            if include_facets:
                search_params["facets"] = [
                    "metadata_author,count:50",
                    "metadata_storage_content_type,count:20"
                ]
            
            logger.info(f"🔍 Performing search: query='{query}', top={top}")
            
            # Execute search
            results = self.search_client.search(**search_params)
            
            documents = []
            for result in results:
                documents.append(self._map_document(result))
            
            # Process facets if available
            facets = {}
            if include_facets:
                try:
                    raw_facets = results.get_facets()
                    if raw_facets:
                        facets = self._process_facets(raw_facets)
                except Exception as e:
                    logger.warning(f"Failed to process facets: {str(e)}")
            
            logger.info(f"✅ Search completed: {len(documents)} documents found")
            
            return {
                "documents": documents,
                "total_count": len(documents),
                "facets": facets if include_facets else None
            }
            
        except Exception as e:
            logger.error(f"❌ Search failed: {str(e)}")
            raise AzureServiceError(f"Search failed: {str(e)}", "search")
    
    def _map_document(self, search_result) -> Dict[str, Any]:
        """Map Azure Search result to our document format"""
        doc = search_result
        
        # Extract title
        title = doc.get("metadata_storage_name", "Untitled Document")
        if title != "Untitled Document" and "." in title:
            title = title.rsplit(".", 1)[0].replace("_", " ").replace("%20", " ")
        
        # Extract content
        content = doc.get("merged_content") or doc.get("content") or ""
        
        # Format file size
        size = self._format_bytes(doc.get("metadata_storage_size", 0))
        
        return {
            "id": doc.get("metadata_storage_path", ""),
            "title": title,
            "content": content,
            "author": doc.get("metadata_author", "Unknown"),
            "category": doc.get("metadata_storage_content_type", "Document"),
            "type": self._get_file_type(doc.get("metadata_storage_name", "")),
            "date": doc.get("metadata_storage_last_modified", ""),
            "size": size,
            "score": search_result.get("@search.score", 0.0) if hasattr(search_result, 'get') else 0.0
        }
    
    def _get_file_type(self, filename: str) -> str:
        """Extract file type from filename"""
        if not filename or "." not in filename:
            return "FILE"
        
        extension = filename.split(".")[-1].upper()
        return extension
    
    def _format_bytes(self, bytes_size) -> str:
        """Format bytes to human readable format"""
        try:
            bytes_size = int(bytes_size) if bytes_size else 0
            if bytes_size == 0:
                return "0 Bytes"
            
            sizes = ["Bytes", "KB", "MB", "GB"]
            i = 0
            while bytes_size >= 1024 and i < len(sizes) - 1:
                bytes_size /= 1024
                i += 1
            
            return f"{bytes_size:.1f} {sizes[i]}"
        except (ValueError, TypeError):
            return "Unknown"
    
    def _process_facets(self, raw_facets) -> Dict[str, List[Dict[str, Any]]]:
        """Process facets from search results"""
        facets = {
            "authors": [],
            "categories": [],
            "document_types": []
        }
        
        # Process author facets
        if "metadata_author" in raw_facets:
            for facet in raw_facets["metadata_author"]:
                facets["authors"].append({
                    "name": facet.get("value", "Unknown"),
                    "count": facet.get("count", 0)
                })
        
        # Process category facets
        if "metadata_storage_content_type" in raw_facets:
            for facet in raw_facets["metadata_storage_content_type"]:
                facets["categories"].append({
                    "name": facet.get("value", "Unknown"),
                    "count": facet.get("count", 0)
                })
        
        return facets

class AzureOpenAIService:
    """Azure OpenAI Service using official SDK"""
    
    def __init__(self):
        # Step 1: Load environment variables
        self.openai_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        self.openai_key = os.getenv("AZURE_OPENAI_API_KEY")
        self.deployment_name = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-4")
        self.api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-15-preview")
        
        if not self.openai_endpoint or not self.openai_key:
            raise AzureServiceError("Azure OpenAI configuration is incomplete", "openai")
        
        # Step 2: Initialize clients
        try:
            self.client = AzureOpenAI(
                azure_endpoint=self.openai_endpoint,
                api_key=self.openai_key,
                api_version=self.api_version
            )
            logger.info("✅ Azure OpenAI client initialized")
        except Exception as e:
            raise AzureServiceError(f"Failed to initialize OpenAI client: {str(e)}", "openai")
    
    async def generate_response(
        self, 
        messages: List[Dict[str, str]], 
        temperature: float = 0.7,
        max_tokens: int = 2000
    ) -> Dict[str, Any]:
        """Step 6: Generate response"""
        try:
            logger.info("🤖 Generating response with Azure OpenAI...")
            
            # Use asyncio to run the synchronous OpenAI call
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None,
                lambda: self.client.chat.completions.create(
                    model=self.deployment_name,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens
                )
            )
            
            logger.info("✅ Response generated successfully")
            
            return {
                "content": response.choices[0].message.content or "No response generated",
                "tokens": response.usage.total_tokens if response.usage else 0,
                "model": response.model or self.deployment_name
            }
            
        except Exception as e:
            logger.error(f"❌ OpenAI generation failed: {str(e)}")
            raise AzureServiceError(f"OpenAI generation failed: {str(e)}", "openai")

class RAGService:
    """Main RAG Service combining search and generation"""
    
    def __init__(self):
        logger.info("🚀 Initializing RAG Service...")
        self.search_service = AzureSearchService()
        self.openai_service = AzureOpenAIService()
        logger.info("✅ RAG Service ready")
    
    async def search_documents(
        self, 
        query: str, 
        filters: Optional[Dict[str, Any]] = None,
        top: int = 10,
        include_facets: bool = False
    ) -> Dict[str, Any]:
        """Search documents using Azure Search"""
        return await self.search_service.search_documents(query, filters, top, include_facets)
    
    async def process_query(
        self,
        query: str,
        filters: Optional[Dict[str, Any]] = None,
        temperature: float = 0.7,
        max_tokens: int = 2000,
        top_documents: int = 10
    ) -> Dict[str, Any]:
        """Step 5: Prepare context and sources, then Step 6: Generate response"""
        start_time = time.time()
        
        try:
            logger.info(f"🔍 Processing RAG query: '{query}'")
            
            # Step 4: Perform hybrid search
            search_result = await self.search_service.search_documents(
                query=query,
                filters=filters,
                top=top_documents
            )
            
            if not search_result["documents"]:
                return {
                    "response": "I couldn't find any relevant documents for your query. Please try rephrasing your question or adjusting your filters.",
                    "sources": [],
                    "confidence": 0.1,
                    "tokens": 0,
                    "processing_time": time.time() - start_time,
                    "model": "none"
                }
            
            # Step 5: Prepare context and sources
            documents_with_content = [
                doc for doc in search_result["documents"] 
                if doc["content"] and len(doc["content"].strip()) > 50
            ]
            
            logger.info(f"📚 Found {len(search_result['documents'])} documents, {len(documents_with_content)} with sufficient content")
            
            if documents_with_content:
                # Prepare rich context with document metadata
                context_content = []
                for i, doc in enumerate(documents_with_content, 1):
                    preview = doc["content"][:1500] + ("..." if len(doc["content"]) > 1500 else "")
                    context_content.append(
                        f'[Document {i}: "{doc["title"]}"]\n'
                        f'Author: {doc["author"]}\n'
                        f'Type: {doc["type"]}\n'
                        f'Category: {doc["category"]}\n'
                        f'Content: {preview}\n'
                    )
                
                context = "\n---\n\n".join(context_content)
                confidence = 0.8
            else:
                # Fallback: List documents without content
                context_content = []
                for i, doc in enumerate(search_result["documents"], 1):
                    context_content.append(
                        f'[Document {i}: "{doc["title"]}"]\n'
                        f'Author: {doc["author"]}\n'
                        f'Type: {doc["type"]}\n'
                        f'Category: {doc["category"]}\n'
                        f'Note: Text content not accessible for this {doc["type"]} file.\n'
                    )
                
                context = "\n---\n\n".join(context_content)
                confidence = 0.4
            
            # Create enhanced system prompt
            system_prompt = f"""You are an expert AI assistant for Barclays. Analyze the provided documents and answer the user's question comprehensively.

Guidelines:
- Use specific information from the documents
- Cite documents when referencing information (e.g., "According to Document 1...")
- Provide detailed, professional responses appropriate for a banking environment
- If information is incomplete, mention what additional details might be helpful
- Structure your response clearly with headings when appropriate
- Focus on actionable insights and practical implications

Available Documents:
{context}"""
            
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": query}
            ]
            
            # Step 6: Generate response
            ai_response = await self.openai_service.generate_response(
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens
            )
            
            # Format sources for frontend
            sources = []
            for doc in search_result["documents"]:
                sources.append({
                    "name": doc["title"],
                    "author": doc["author"],
                    "relevance": doc["score"],
                    "type": doc["type"],
                    "category": doc["category"],
                    "id": doc["id"]
                })
            
            processing_time = time.time() - start_time
            
            logger.info(f"✅ RAG processing completed in {processing_time:.2f}s")
            logger.info(f"📊 Result: {len(sources)} sources, {ai_response['tokens']} tokens, {confidence} confidence")
            
            return {
                "response": ai_response["content"],
                "sources": sources,
                "confidence": confidence,
                "tokens": ai_response["tokens"],
                "processing_time": processing_time,
                "model": ai_response["model"]
            }
            
        except Exception as e:
            logger.error(f"💥 RAG processing error: {str(e)}")
            raise AzureServiceError(f"RAG processing failed: {str(e)}", "rag")
    
    async def get_available_facets(self) -> Dict[str, Any]:
        """Get available facets for filtering"""
        try:
            result = await self.search_service.search_documents(
                query="*",
                top=1,
                include_facets=True
            )
            return result.get("facets", {
                "authors": [],
                "categories": [],
                "document_types": []
            })
        except Exception as e:
            logger.error(f"❌ Failed to load facets: {str(e)}")
            return {
                "authors": [],
                "categories": [],
                "document_types": []
            }
    
    async def test_connection(self) -> Dict[str, Any]:
        """Test connection to all Azure services"""
        result = {
            "search": False,
            "openai": False,
            "errors": []
        }
        
        # Test search service
        try:
            await self.search_service.search_documents("test", top=1)
            result["search"] = True
            logger.info("✅ Search service connection successful")
        except Exception as e:
            result["errors"].append(f"Search: {str(e)}")
            logger.error(f"❌ Search service connection failed: {str(e)}")
        
        # Test OpenAI service
        try:
            await self.openai_service.generate_response(
                messages=[{"role": "user", "content": "Hello"}],
                max_tokens=10
            )
            result["openai"] = True
            logger.info("✅ OpenAI service connection successful")
        except Exception as e:
            result["errors"].append(f"OpenAI: {str(e)}")
            logger.error(f"❌ OpenAI service connection failed: {str(e)}")
        
        return result 