from fastapi import FastAPI, File, UploadFile, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
import httpx
import base64
import json
import re
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


@app.get("/api/analytics")
async def get_analytics():
    """Get analytics data for dashboard"""
    try:
        scans_collection = database.scans
        
        # Get all documents
        all_items = []
        all_dates = []
        async for scan in scans_collection.find().sort("date", 1):
            all_dates.append(scan.get("date", ""))
            items = scan.get("items", [])
            for item in items:
                item["date"] = scan.get("date", "")
                all_items.append(item)
        
        if not all_items:
            return {
                "completion_rate": 0,
                "total_items": 0,
                "total_tasks": 0,
                "completed_tasks": 0,
                "type_distribution": {"TASK": 0, "EVENT": 0, "NOTE": 0},
                "status_distribution": {"TODO": 0, "IN_PROGRESS": 0, "DONE": 0, "SCHEDULED": 0},
                "productivity_trend": [],
                "active_days": 0,
                "current_streak": 0,
                "longest_streak": 0,
                "items_by_day_of_week": {}
            }
        
        # Calculate completion rate (for tasks only)
        tasks = [item for item in all_items if item.get("type") == "TASK"]
        total_tasks = len(tasks)
        completed_tasks = len([t for t in tasks if t.get("status") == "DONE"])
        completion_rate = (completed_tasks / total_tasks * 100) if total_tasks > 0 else 0
        
        # Type distribution
        type_distribution = {"TASK": 0, "EVENT": 0, "NOTE": 0}
        for item in all_items:
            item_type = item.get("type", "NOTE")
            if item_type in type_distribution:
                type_distribution[item_type] += 1
        
        # Status distribution
        status_distribution = {"TODO": 0, "IN_PROGRESS": 0, "DONE": 0, "SCHEDULED": 0}
        for item in all_items:
            status = item.get("status")
            if status and status in status_distribution:
                status_distribution[status] += 1
        
        # Productivity trend (items per date)
        date_counts = {}
        for item in all_items:
            date = item.get("date", "")
            date_counts[date] = date_counts.get(date, 0) + 1
        
        productivity_trend = [
            {"date": date, "count": date_counts.get(date, 0)}
            for date in sorted(set(all_dates))[-30:]  # Last 30 days
        ]
        
        # Active days and streaks
        unique_dates = sorted(set(all_dates))
        active_days = len(unique_dates)
        
        # Calculate current streak (consecutive days from today backwards)
        today = datetime.now().strftime("%d-%m-%Y")
        current_streak = 0
        if unique_dates:
            # Check if today or recent dates are in the list
            date_set = set(unique_dates)
            check_date = datetime.now()
            while True:
                date_str = check_date.strftime("%d-%m-%Y")
                if date_str in date_set:
                    current_streak += 1
                    check_date = datetime(check_date.year, check_date.month, check_date.day - 1)
                else:
                    break
        
        # Calculate longest streak
        longest_streak = 0
        if unique_dates:
            current_streak_calc = 1
            for i in range(1, len(unique_dates)):
                # Parse dates and check if consecutive
                try:
                    prev_date = datetime.strptime(unique_dates[i-1], "%d-%m-%Y")
                    curr_date = datetime.strptime(unique_dates[i], "%d-%m-%Y")
                    diff = (curr_date - prev_date).days
                    if diff == 1:
                        current_streak_calc += 1
                    else:
                        longest_streak = max(longest_streak, current_streak_calc)
                        current_streak_calc = 1
                except:
                    pass
            longest_streak = max(longest_streak, current_streak_calc)
        
        # Items by day of week
        items_by_day = {"Monday": 0, "Tuesday": 0, "Wednesday": 0, "Thursday": 0, "Friday": 0, "Saturday": 0, "Sunday": 0}
        day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        for date_str in unique_dates:
            try:
                date_obj = datetime.strptime(date_str, "%d-%m-%Y")
                day_name = day_names[date_obj.weekday()]
                items_by_day[day_name] += date_counts.get(date_str, 0)
            except:
                pass
        
        return {
            "completion_rate": round(completion_rate, 1),
            "total_items": len(all_items),
            "total_tasks": total_tasks,
            "completed_tasks": completed_tasks,
            "type_distribution": type_distribution,
            "status_distribution": status_distribution,
            "productivity_trend": productivity_trend,
            "active_days": active_days,
            "current_streak": current_streak,
            "longest_streak": longest_streak,
            "items_by_day_of_week": items_by_day
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch analytics: {str(e)}")


async def merge_items_with_llm(existing_items: list, new_items: list, date: str) -> list:
    """
    Merge existing items with new items using Groq LLM.
    Returns merged and deduplicated items.
    """
    try:
        # Get today's date for context
        today_date = datetime.now().strftime("%d-%m-%Y")
        
        # Prepare the prompt for merging
        prompt = f"""Today's date is {today_date}. You are merging bullet journal items for the specific journal date {date}.

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
  {{ 
    "type": "TASK"|"EVENT"|"NOTE", 
    "status": "TODO"|"DONE"|"IN_PROGRESS"|"SCHEDULED", 
    "content": "string",
    "subtasks": [
      {{ "type": "...", "status": "...", "content": "string" }}
    ]
  }}
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
    {{ 
      "type": "TASK"|"EVENT"|"NOTE", 
      "status": "TODO"|"DONE"|"IN_PROGRESS"|"SCHEDULED", 
      "content": "string"
    }}
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


@app.post("/api/query")
async def query_documents(query: dict = Body(...)):
    """
    Query all documents from the database using GPT OSS model.
    Takes all documents, formats them, appends user question, and returns AI response.
    """
    try:
        user_question = query.get("question", "")
        if not user_question:
            raise HTTPException(status_code=400, detail="Question is required")
        
        # Get all documents from database
        scans_collection = database.scans
        all_documents = []
        async for scan in scans_collection.find().sort("date", 1):
            all_documents.append({
                "date": scan.get("date", ""),
                "items": scan.get("items", [])
            })
        
        # Format all documents into a readable text format
        formatted_documents = "All Bullet Journal Entries:\n\n"
        for doc in all_documents:
            formatted_documents += f"Date: {doc['date']}\n"
            formatted_documents += "Items:\n"
            for item in doc.get("items", []):
                item_type = item.get("type", "UNKNOWN")
                item_status = item.get("status", "")
                item_content = item.get("content", "")
                status_text = f" ({item_status})" if item_status else ""
                formatted_documents += f"  - [{item_type}]{status_text}: {item_content}\n"
            formatted_documents += "\n"
        
        # Get today's date for context
        today_date = datetime.now().strftime("%d-%m-%Y")
        
        # Create prompt with all documents and user question
        prompt = f"""Today's date is {today_date}.

{formatted_documents}

User Question: {user_question}

Please provide a helpful answer based on the bullet journal entries above. 
IMPORTANT INSTRUCTIONS:
- Be very concise and relevant and respond in natural, conversational language as the response will be read out aloud
- Do NOT use markdown formatting (no #, **, *, `, etc.)
- You may use HTML tags like <p>, <strong>, <em>, <ul>, <li>, <br> for structure if needed
- Use SINGLE line breaks for items within a list or category
- Only use DOUBLE line breaks to separate major sections
- Keep the response tightly spaced and avoid unnecessary gaps between related lines"""

        # Call Groq API with same configuration as merge function
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
        
        # Clean up any markdown formatting and convert to HTML
        # Collapse multiple newlines (more than 2) into just 2
        response_content = re.sub(r'\n{2,}', '\n', response_content.strip())
        # Remove markdown headers (keep text, remove #)
        response_content = re.sub(r'^#{1,6}\s+', '', response_content, flags=re.MULTILINE)
        # Convert markdown bold to HTML strong
        response_content = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', response_content)
        # Convert markdown italic to HTML em (single asterisk, not double)
        response_content = re.sub(r'(?<!\*)\*([^*\n]+?)\*(?!\*)', r'<em>\1</em>', response_content)
        # Remove markdown code blocks but keep content
        response_content = re.sub(r'```[\w]*\n?([\s\S]*?)```', r'\1', response_content)
        response_content = re.sub(r'`([^`\n]+)`', r'<code>\1</code>', response_content)
        # Convert markdown links to plain text
        response_content = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', response_content)
        # Split into paragraphs (double newlines)
        paragraphs = [p.strip() for p in re.split(r'\n\s*\n', response_content) if p.strip()]
        # Wrap each paragraph in <p> tags and convert single newlines to <br>
        html_paragraphs = []
        for para in paragraphs:
            # Convert single line breaks to <br> within paragraphs
            para = para.replace('\n', '<br>')
            html_paragraphs.append(f'<p>{para}</p>')
        
        response_content = ''.join(html_paragraphs) if html_paragraphs else f'<p>{response_content}</p>'
        
        return {
            "response": response_content,
            "documents_count": len(all_documents)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error querying documents: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
