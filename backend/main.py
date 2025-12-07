from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx
import base64
import json
from io import BytesIO
from PIL import Image
import os
from datetime import datetime
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import ConnectionFailure
from bson import ObjectId
from typing import Optional
from groq import Groq

load_dotenv()

# Get Groq API key from environment
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY environment variable is required. Please set it in your .env file.")

# Get MongoDB connection string from environment
MONGODB_URL = os.getenv("MONGODB_URL")
if not MONGODB_URL:
    raise ValueError("MONGODB_URL environment variable is required. Please set it in your .env file.")

# MongoDB connection
mongodb_client: Optional[AsyncIOMotorClient] = None
database = None

# Groq client for merging items
groq_client = Groq(api_key=GROQ_API_KEY)

app = FastAPI(title="BuJo Companion API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_db_client():
    """Initialize MongoDB connection on startup"""
    global mongodb_client, database
    try:
        mongodb_client = AsyncIOMotorClient(MONGODB_URL)
        # Test the connection
        await mongodb_client.admin.command('ping')
        database = mongodb_client.bujo_companion
        
        # Create unique index on date field to ensure one document per date
        scans_collection = database.scans
        try:
            await scans_collection.create_index("date", unique=True)
            print("✅ Created unique index on date field")
        except Exception as e:
            # Index might already exist, which is fine
            print(f"ℹ️ Index on date field: {e}")
        
        print("✅ Connected to MongoDB Atlas")
    except ConnectionFailure as e:
        print(f"❌ Failed to connect to MongoDB: {e}")
        raise


@app.on_event("shutdown")
async def shutdown_db_client():
    """Close MongoDB connection on shutdown"""
    global mongodb_client
    if mongodb_client:
        mongodb_client.close()
        print("✅ Disconnected from MongoDB")


@app.get("/")
async def root():
    return {"message": "BuJo Companion API"}


@app.get("/api/scans")
async def get_scans():
    """Get all stored scans"""
    try:
        scans_collection = database.scans
        scans = []
        async for scan in scans_collection.find().sort("created_at", -1):
            scan["_id"] = str(scan["_id"])
            scans.append(scan)
        return {"scans": scans}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch scans: {str(e)}")


@app.get("/api/scans/{scan_id}")
async def get_scan(scan_id: str):
    """Get a specific scan by ID"""
    try:
        scans_collection = database.scans
        scan = await scans_collection.find_one({"_id": ObjectId(scan_id)})
        if not scan:
            raise HTTPException(status_code=404, detail="Scan not found")
        scan["_id"] = str(scan["_id"])
        return scan
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f"Failed to fetch scan: {str(e)}")


@app.get("/api/scans/date/{date}")
async def get_scan_by_date(date: str):
    """Get a scan by date (DD-MM-YYYY format)"""
    try:
        scans_collection = database.scans
        scan = await scans_collection.find_one({"date": date})
        if not scan:
            # Return empty scan instead of 404
            return {
                "date": date,
                "items": [],
                "created_at": None,
                "updated_at": None
            }
        scan["_id"] = str(scan["_id"])
        return scan
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f"Failed to fetch scan: {str(e)}")


@app.get("/api/scans/dates/all")
async def get_all_dates():
    """Get all dates that have scans, sorted chronologically"""
    try:
        scans_collection = database.scans
        dates = []
        async for scan in scans_collection.find({}, {"date": 1, "_id": 0}).sort("date", 1):
            dates.append(scan["date"])
        return {"dates": dates}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch dates: {str(e)}")


async def merge_items_with_llm(existing_items: list, new_items: list, date: str) -> list:
    """
    Merge existing items with new items using Groq LLM.
    Returns merged and deduplicated items.
    """
    try:
        # Prepare the prompt for merging
        prompt = f"""You are merging bullet journal items for date {date}.

Existing items in the database:
{json.dumps(existing_items, indent=2)}

Newly extracted items from a new scan:
{json.dumps(new_items, indent=2)}

Your task:
1. Merge these two lists intelligently
2. Remove duplicates (items with the same or very similar content)
3. Preserve all unique items from both lists
4. If an item exists in both lists but with different statuses, keep the more complete/updated version
5. Maintain the structure: each item should have type, status, and content fields
6. Return ONLY a valid JSON array with the merged items

Return the merged items as a JSON array matching this schema:
[
  {{ "type": "TASK"|"EVENT"|"NOTE", "status": "TODO"|"DONE"|"IN_PROGRESS"|"SCHEDULED", "content": "string" }}
]

Do not include any markdown formatting or explanations, just the JSON array."""

        # Call Groq API for merging
        completion = groq_client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            temperature=1,
            top_p=1,
            stream=False,
            stop=None
        )
        
        # Extract response content
        response_content = completion.choices[0].message.content
        
        # Parse JSON response
        try:
            # Handle potential markdown code blocks
            cleaner = response_content.replace("```json", "").replace("```", "").strip()
            merged_items = json.loads(cleaner)
            
            # Ensure it's a list
            if not isinstance(merged_items, list):
                # If response is wrapped in an object, try to extract items
                if isinstance(merged_items, dict) and "items" in merged_items:
                    merged_items = merged_items["items"]
                else:
                    raise ValueError("LLM response is not a valid array")
            
            return merged_items
            
        except json.JSONDecodeError as e:
            print(f"⚠️ Failed to parse LLM merge response: {e}")
            print(f"Response content: {response_content}")
            # Fallback: combine both lists and remove obvious duplicates
            combined = existing_items + new_items
            # Simple deduplication by content
            seen = set()
            unique_items = []
            for item in combined:
                content_key = item.get("content", "").lower().strip()
                if content_key and content_key not in seen:
                    seen.add(content_key)
                    unique_items.append(item)
            return unique_items
            
    except Exception as e:
        print(f"⚠️ Error merging items with LLM: {e}")
        # Fallback: combine both lists
        combined = existing_items + new_items
        # Simple deduplication
        seen = set()
        unique_items = []
        for item in combined:
            content_key = item.get("content", "").lower().strip()
            if content_key and content_key not in seen:
                seen.add(content_key)
                unique_items.append(item)
        return unique_items


@app.post("/api/process-image")
async def process_image(file: UploadFile = File(...)):
    """
    Process an image using Groq VLM to extract bullet journal items and date.
    """
    try:
        # Get today's date in DD-MM-YYYY format
        today_date = datetime.now().strftime("%d-%m-%Y")
        
        # Read and validate image
        contents = await file.read()
        image = Image.open(BytesIO(contents))
        
        # Convert to base64
        buffered = BytesIO()
        image.save(buffered, format="PNG")
        img_base64 = base64.b64encode(buffered.getvalue()).decode()
        base64_image = f"data:image/png;base64,{img_base64}"
        
        # Call Groq VLM API
        groq_url = "https://api.groq.com/openai/v1/chat/completions"
        
        headers = {
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json"
        }
        
        # Updated prompt to include date extraction
        prompt_text = f"""Extract tasks, events, and notes from this bullet journal page. Also extract the date from the page in DD-MM-YYYY format. If no date is visible on the page, use today's date: {today_date}.

Return ONLY a valid JSON object with this structure:
{{
  "date": "DD-MM-YYYY",
  "items": [
    {{ "type": "TASK"|"EVENT"|"NOTE", "status": "TODO"|"DONE"|"IN_PROGRESS"|"SCHEDULED", "content": "string" }}
  ]
}}

Map symbols carefully: '•', '.' or 'Dot' = TASK(TODO); 'X' = TASK(DONE); '/' = TASK(IN_PROGRESS); 'O' = EVENT(SCHEDULED); 'Filled O', 'Solid Circle' or 'ø' = EVENT(DONE).

Do not include any markdown formatting or explanations, just the JSON."""
        
        payload = {
            "model": "meta-llama/llama-4-maverick-17b-128e-instruct",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": prompt_text
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": base64_image}
                        }
                    ]
                }
            ],
            "temperature": 0.1,
            "max_tokens": 1024,
            "response_format": {"type": "json_object"}
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(groq_url, headers=headers, json=payload, timeout=60.0)
            
            if not response.is_success:
                error_data = response.json()
                raise HTTPException(
                    status_code=response.status_code,
                    detail=error_data.get("error", {}).get("message", "Groq API Failed")
                )
            
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            
            # Log Groq VLM response
            print("=" * 80)
            print("GROQ VLM RESPONSE:")
            print("=" * 80)
            print(f"Full response data: {json.dumps(data, indent=2)}")
            print(f"Content: {content}")
            print("=" * 80)
            
            # Parse JSON response
            try:
                # Handle potential wrapper keys or markdown code blocks
                cleaner = content.replace("```json", "").replace("```", "").strip()
                parsed = json.loads(cleaner)
                
                # Extract date and items from response
                extracted_date = today_date  # Default to today's date
                items = []
                
                if isinstance(parsed, dict):
                    # Get date from response, fallback to today if not found
                    if "date" in parsed:
                        extracted_date = parsed["date"]
                    elif "date" not in parsed:
                        # If date is not in response, use today's date
                        extracted_date = today_date
                    
                    # Get items from response
                    if "items" in parsed and isinstance(parsed["items"], list):
                        items = parsed["items"]
                    else:
                        # Try to find items in other keys
                        for key, value in parsed.items():
                            if key != "date" and isinstance(value, list):
                                items = value
                                break
                elif isinstance(parsed, list):
                    # If response is just a list, use today's date
                    items = parsed
                    extracted_date = today_date
                else:
                    items = []
                    extracted_date = today_date
                
                # Validate date format (DD-MM-YYYY)
                try:
                    datetime.strptime(extracted_date, "%d-%m-%Y")
                except ValueError:
                    # If date format is invalid, use today's date
                    extracted_date = today_date
                
                # Automatically save to MongoDB using date as unique identifier
                scan_id = None
                final_items = items
                saved_to_db = False
                
                try:
                    scans_collection = database.scans
                    
                    # Check if document exists for this date
                    existing_doc = await scans_collection.find_one({"date": extracted_date})
                    
                    if existing_doc:
                        # Document exists - merge with existing items using LLM
                        print(f"📝 Document exists for date {extracted_date}, merging items...")
                        existing_items = existing_doc.get("items", [])
                        
                        # Merge items using Groq LLM
                        merged_items = await merge_items_with_llm(existing_items, items, extracted_date)
                        final_items = merged_items
                        
                        # Update the existing document
                        update_result = await scans_collection.update_one(
                            {"date": extracted_date},
                            {
                                "$set": {
                                    "items": final_items,
                                    "updated_at": datetime.utcnow()
                                }
                            }
                        )
                        if update_result.modified_count > 0 or update_result.matched_count > 0:
                            saved_to_db = True
                            scan_id = str(existing_doc["_id"])
                            print(f"✅ Updated existing document for date {extracted_date} with merged items")
                        else:
                            print(f"⚠️ Warning: Update operation did not modify any documents")
                    else:
                        # Document doesn't exist - insert new document
                        scan_document = {
                            "date": extracted_date,
                            "items": items,
                            "created_at": datetime.utcnow(),
                            "updated_at": datetime.utcnow()
                        }
                        result = await scans_collection.insert_one(scan_document)
                        if result.inserted_id:
                            saved_to_db = True
                            scan_id = str(result.inserted_id)
                            print(f"✅ Created new document for date {extracted_date} with ID: {scan_id}")
                        else:
                            print(f"⚠️ Warning: Insert operation did not return an ID")
                        
                except Exception as e:
                    print(f"❌ Error: Failed to save to MongoDB: {e}")
                    import traceback
                    traceback.print_exc()
                    # Still return the data even if save fails, but log the error
                
                return {
                    "date": extracted_date, 
                    "items": final_items, 
                    "scan_id": scan_id,
                    "saved_to_db": saved_to_db
                }
                
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Failed to parse VLM response: {str(e)}")
                
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing image: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

